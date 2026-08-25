import { type Sha256Hex, sha256Canonical } from "./canonical.js";
import type { Finding } from "./findings.js";
import { authorizeMission } from "./policy.js";
import { checkProvenance, checkQueryPlan, type Provenance, type QueryPlan } from "./queryPlan.js";
import { checkColumns, checkRows, GROUP_SIZE_FIELD, MIN_GROUP_SIZE } from "./rows.js";
import { snapshotArray, snapshotRecord } from "./snapshot.js";

export type AggregateRow = Readonly<Record<string, string | number>>;

export type ReleaseCandidate = {
  readonly purpose: string;
  readonly audience: string;
  readonly columns: readonly string[];
  readonly rows: readonly AggregateRow[];
  readonly minGroupSize: number;
  readonly datasetVersion: string;
  readonly policyVersion: string;
  readonly queryPlan: QueryPlan;
  readonly provenance: Provenance;
};

export type ValidationResult =
  | {
      readonly status: "approved";
      readonly contractHash: Sha256Hex;
      readonly outputHash: Sha256Hex;
    }
  | { readonly status: "denied"; readonly findings: readonly Finding[] }
  | { readonly status: "needs_review"; readonly findings: readonly Finding[] };

// The contract hash covers everything the approver authorizes; the output hash
// covers exactly the rows that would be released. Both recompute from the
// candidate itself, so any post-validation mutation changes the hash.
export function contractHashOf(candidate: ReleaseCandidate): Sha256Hex {
  const { rows, ...contract } = candidate;
  // Group sizes are enforcement evidence: never released, but part of what the
  // approver authorized — regrouping the same output after approval (e.g. 12
  // per cell down to 3) must break execution-time verification.
  const groupSizes = rows.map((row) => row[GROUP_SIZE_FIELD] ?? null);
  return sha256Canonical({ ...contract, groupSizes });
}

// The output hash covers the rows projected to the declared columns — the
// exact released content. group_size is enforcement metadata, never released,
// so it must not shift the hash the approver signs off on.
export function outputHashOf(candidate: ReleaseCandidate): Sha256Hex {
  return sha256Canonical(
    candidate.rows.map((row) => {
      const projected: Record<string, string | number> = {};
      for (const column of candidate.columns) {
        const value = row[column];
        if (value !== undefined) projected[column] = value;
      }
      return projected;
    }),
  );
}

// Trust boundary: validateRelease proves the evidence is internally
// consistent (group sizes, provenance, plan), not where it came from. A
// caller who fabricates group_size can only be caught by the party that owns
// the data — the vault server constructs candidates from its own queries and
// keeps the prepared-analysis snapshot keyed by provenance.queryId, so
// release-time verification compares against vault-owned evidence rather
// than caller assertions.
export function validateRelease(candidate: unknown): ValidationResult {
  // Everything — including parsing, whose type guards read properties — is
  // guarded: accessors on hostile objects (getters, proxies) can throw from
  // any property read, and an escaped exception is not a fail-closed verdict.
  try {
    const parsed = parseCandidate(candidate);
    if (parsed === null) {
      // Malformed input is not a policy verdict — it is an unclassifiable
      // request, so it fails closed as needs_review rather than denied.
      return { status: "needs_review", findings: [{ code: "candidate_malformed" }] };
    }

    const findings: Finding[] = [];
    const mission = authorizeMission(parsed.purpose, parsed.audience);
    if (!mission.authorized) findings.push(...mission.reasons.map((code) => ({ code })));
    if (parsed.minGroupSize !== MIN_GROUP_SIZE) {
      findings.push({ code: "min_group_size_mismatch", detail: String(parsed.minGroupSize) });
    }
    findings.push(...checkColumns(parsed.columns));
    findings.push(...checkRows(parsed.rows, parsed.columns));
    findings.push(...checkQueryPlan(parsed.queryPlan));
    // The released columns must be exactly what the validated plan computes —
    // otherwise one analysis's provenance could authorize a different payload.
    const planColumns = new Set([...parsed.queryPlan.dimensions, parsed.queryPlan.metric]);
    const declaredColumns = new Set(parsed.columns);
    if (
      planColumns.size !== declaredColumns.size ||
      [...declaredColumns].some((column) => !planColumns.has(column))
    ) {
      const shown = parsed.columns.slice(0, 8).join(",");
      findings.push({
        code: "columns_plan_mismatch",
        detail: parsed.columns.length > 8 ? `${shown},…` : shown,
      });
    }
    findings.push(
      ...checkProvenance(
        parsed.provenance,
        parsed.queryPlan,
        parsed.datasetVersion,
        parsed.policyVersion,
      ),
    );

    if (findings.length > 0) return { status: "denied", findings: Object.freeze(findings) };
    return {
      status: "approved",
      contractHash: contractHashOf(parsed),
      outputHash: outputHashOf(parsed),
    };
  } catch {
    return { status: "needs_review", findings: [{ code: "candidate_malformed" }] };
  }
}

// Execution-time revalidation: release only when the full contract still
// validates AND both supplied hashes match a fresh recomputation.
export function verifyRelease(
  candidate: unknown,
  contractHash: string,
  outputHash: string,
): ValidationResult {
  const result = validateRelease(candidate);
  if (result.status !== "approved") return result;
  const findings: Finding[] = [];
  if (result.contractHash !== contractHash) findings.push({ code: "contract_hash_mismatch" });
  if (result.outputHash !== outputHash) findings.push({ code: "output_hash_mismatch" });
  if (findings.length > 0) return { status: "denied", findings: Object.freeze(findings) };
  return result;
}

const CANDIDATE_KEYS = Object.freeze([
  "purpose",
  "audience",
  "columns",
  "rows",
  "minGroupSize",
  "datasetVersion",
  "policyVersion",
  "queryPlan",
  "provenance",
] as const);
const PLAN_KEYS = Object.freeze(["sourceDataset", "dimensions", "metric", "filters", "joins"]);
const PROVENANCE_KEYS = Object.freeze(["sourceDataset", "datasetVersion", "queryId"]);

// Unknown keys are rejected, not ignored: the contract hash must cover exactly
// what the rules inspected, so a field no rule looked at can never be part of
// what the approver ends up authorizing.
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

// Parsing returns a frozen single-read snapshot, never the caller's object:
// every later check and hash reads the snapshot, so a stateful getter or proxy
// cannot show one value to authorization and another to the hash.
function parseCandidate(value: unknown): ReleaseCandidate | null {
  const record = snapshotRecord(value);
  if (record === null || !hasExactKeys(record, CANDIDATE_KEYS)) return null;

  const columns = snapshotStringArray(record.columns);
  const rows = snapshotRows(record.rows);
  const queryPlan = parseQueryPlan(record.queryPlan);
  const provenance = parseProvenance(record.provenance);
  if (
    columns === null ||
    rows === null ||
    queryPlan === null ||
    provenance === null ||
    typeof record.purpose !== "string" ||
    typeof record.audience !== "string" ||
    typeof record.minGroupSize !== "number" ||
    typeof record.datasetVersion !== "string" ||
    typeof record.policyVersion !== "string"
  ) {
    return null;
  }
  // Row values are still unknown at this point; checkRows validates every one
  // before the approved path can be reached.
  return Object.freeze({
    purpose: record.purpose,
    audience: record.audience,
    columns,
    rows: rows as readonly AggregateRow[],
    minGroupSize: record.minGroupSize,
    datasetVersion: record.datasetVersion,
    policyVersion: record.policyVersion,
    queryPlan,
    provenance,
  });
}

function snapshotStringArray(value: unknown): readonly string[] | null {
  const items = snapshotArray(value);
  if (items === null || !items.every((item) => typeof item === "string")) return null;
  return Object.freeze(items as string[]);
}

function snapshotRows(value: unknown): ReadonlyArray<Record<string, unknown>> | null {
  const items = snapshotArray(value);
  if (items === null) return null;
  const rows: Record<string, unknown>[] = [];
  for (const item of items) {
    const row = snapshotRecord(item);
    if (row === null) return null;
    rows.push(Object.freeze(row));
  }
  return Object.freeze(rows);
}

function parseQueryPlan(value: unknown): QueryPlan | null {
  const plan = snapshotRecord(value);
  if (plan === null || !hasExactKeys(plan, PLAN_KEYS)) return null;
  const dimensions = snapshotStringArray(plan.dimensions);
  const filters = snapshotArray(plan.filters);
  const joins = snapshotArray(plan.joins);
  if (
    dimensions === null ||
    filters === null ||
    joins === null ||
    typeof plan.sourceDataset !== "string" ||
    typeof plan.metric !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    sourceDataset: plan.sourceDataset,
    dimensions,
    metric: plan.metric,
    filters: Object.freeze(filters),
    joins: Object.freeze(joins),
  });
}

function parseProvenance(value: unknown): Provenance | null {
  const provenance = snapshotRecord(value);
  if (provenance === null || !hasExactKeys(provenance, PROVENANCE_KEYS)) return null;
  if (
    typeof provenance.sourceDataset !== "string" ||
    typeof provenance.datasetVersion !== "string" ||
    typeof provenance.queryId !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    sourceDataset: provenance.sourceDataset,
    datasetVersion: provenance.datasetVersion,
    queryId: provenance.queryId,
  });
}

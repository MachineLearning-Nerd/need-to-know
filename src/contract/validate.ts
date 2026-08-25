import { type Sha256Hex, sha256Canonical } from "./canonical.js";
import type { Finding } from "./findings.js";
import { authorizeMission } from "./policy.js";
import { checkProvenance, checkQueryPlan, type Provenance, type QueryPlan } from "./queryPlan.js";
import { checkColumns, checkRows, MIN_GROUP_SIZE } from "./rows.js";

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
  const { rows: _rows, ...contract } = candidate;
  return sha256Canonical(contract);
}

export function outputHashOf(candidate: ReleaseCandidate): Sha256Hex {
  return sha256Canonical(candidate.rows);
}

export function validateRelease(candidate: unknown): ValidationResult {
  const parsed = parseCandidate(candidate);
  if (parsed === null) {
    // Malformed input is not a policy verdict — it is an unclassifiable
    // request, so it fails closed as needs_review rather than denied.
    return { status: "needs_review", findings: [{ code: "candidate_malformed" }] };
  }

  // The whole check-and-hash phase is guarded: property accessors on hostile
  // objects (getters, proxies) can throw from inside any check, and an escaped
  // exception is not a fail-closed verdict.
  try {
    const findings: Finding[] = [];
    const mission = authorizeMission(parsed.purpose, parsed.audience);
    if (!mission.authorized) findings.push(...mission.reasons.map((code) => ({ code })));
    if (parsed.minGroupSize !== MIN_GROUP_SIZE) {
      findings.push({ code: "min_group_size_mismatch", detail: String(parsed.minGroupSize) });
    }
    findings.push(...checkColumns(parsed.columns));
    findings.push(...checkRows(parsed.rows, parsed.columns));
    findings.push(...checkQueryPlan(parsed.queryPlan));
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

function parseCandidate(value: unknown): ReleaseCandidate | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const plan = record.queryPlan;
  const provenance = record.provenance;
  if (
    !hasExactKeys(record, CANDIDATE_KEYS) ||
    typeof record.purpose !== "string" ||
    typeof record.audience !== "string" ||
    !isStringArray(record.columns) ||
    !isRowArray(record.rows) ||
    typeof record.minGroupSize !== "number" ||
    typeof record.datasetVersion !== "string" ||
    typeof record.policyVersion !== "string" ||
    !isQueryPlan(plan) ||
    !isProvenance(provenance)
  ) {
    return null;
  }
  return value as ReleaseCandidate;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRowArray(value: unknown): value is readonly AggregateRow[] {
  return (
    Array.isArray(value) &&
    value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))
  );
}

function isQueryPlan(value: unknown): value is QueryPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Record<string, unknown>;
  return (
    hasExactKeys(plan, PLAN_KEYS) &&
    typeof plan.sourceDataset === "string" &&
    isStringArray(plan.dimensions) &&
    typeof plan.metric === "string" &&
    Array.isArray(plan.filters) &&
    Array.isArray(plan.joins)
  );
}

function isProvenance(value: unknown): value is Provenance {
  if (typeof value !== "object" || value === null) return false;
  const provenance = value as Record<string, unknown>;
  return (
    hasExactKeys(provenance, PROVENANCE_KEYS) &&
    typeof provenance.sourceDataset === "string" &&
    typeof provenance.datasetVersion === "string" &&
    typeof provenance.queryId === "string"
  );
}

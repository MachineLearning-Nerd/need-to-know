import { canonicalize } from "../contract/canonical.js";
import {
  ALLOWED_AUDIENCE,
  ALLOWED_PURPOSE,
  authorizeMission,
  POLICY_VERSION,
} from "../contract/policy.js";
import { ALLOWED_METRICS } from "../contract/queryPlan.js";
import { GROUP_SIZE_FIELD, MAX_RELEASE_ROWS, MIN_GROUP_SIZE } from "../contract/rows.js";
import { validateRelease, verifyRelease } from "../contract/validate.js";
import { renderDecisionCard, renderReceiptCard } from "../render/cards.js";
import { renderChartBlock } from "../render/chart.js";
import type { AggregateMetric, VaultDatabase } from "../vault/database.js";
import { COLUMN_SENSITIVITY, DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import { errorResult, jsonResult, type ReleaseResultInput, type VaultToolHandlers } from "./mcp.js";
import type { VaultStore } from "./store.js";

// prepare_analysis and release_result must build rows identically: release
// recomputes this from the live database and any difference from the stored
// candidate — regrouped cells, drifted values, smuggled rows — is denied.
//
// Suppression is applied ONCE at the finest granularity, then coarser
// aggregates are rolled up from the survivors. Suppressing per-request at the
// requested granularity is reversible: a coarse total would still contain the
// rows a finer query hid, so subtracting one from the other reconstructs the
// suppressed cell. Rolling up from a single suppressed base keeps every
// granularity mutually consistent, so differencing yields nothing.
function aggregateCandidateRows(
  db: VaultDatabase,
  dimensions: readonly string[],
  metric: AggregateMetric,
): { rows: ReadonlyArray<Record<string, string | number>>; suppressedCells: number } {
  const fine = db.aggregate(metric);
  const survivors = fine.filter((cell) => cell.groupSize >= MIN_GROUP_SIZE);

  const groups = new Map<string, { dims: Record<string, string>; sum: number; count: number }>();
  for (const cell of survivors) {
    const key = dimensions.map((dimension) => cell.dimensions[dimension]).join("|");
    let group = groups.get(key);
    if (group === undefined) {
      const dims: Record<string, string> = {};
      for (const dimension of dimensions) dims[dimension] = cell.dimensions[dimension] as string;
      group = { dims, sum: 0, count: 0 };
      groups.set(key, group);
    }
    // ticket_count sums directly; avg rolls up as a count-weighted mean.
    group.sum += metric === "ticket_count" ? cell.value : cell.value * cell.groupSize;
    group.count += cell.groupSize;
  }

  return {
    rows: [...groups.values()].map((group) =>
      Object.freeze({
        ...group.dims,
        [metric]:
          metric === "ticket_count" ? group.sum : Math.round((group.sum / group.count) * 100) / 100,
        [GROUP_SIZE_FIELD]: group.count,
      }),
    ),
    suppressedCells: fine.length - survivors.length,
  };
}

// The projection decides which fields leave the vault (group_size never
// does), so release and chart must share one copy. The contract library's
// outputHashOf applies the same rule independently on purpose: the hash
// definition must not depend on server code.
function projectReleasedRows(candidate: {
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<Readonly<Record<string, string | number>>>;
}): Array<Record<string, string | number>> {
  return candidate.rows.map((row) => {
    const projected: Record<string, string | number> = {};
    for (const column of candidate.columns) {
      const value = row[column];
      if (value !== undefined) projected[column] = value;
    }
    return projected;
  });
}

function releaseResultInner(db: VaultDatabase, store: VaultStore, input: ReleaseResultInput) {
  const entry = store.getPrepared(input.queryId);
  if (entry === undefined) {
    store.recordAudit(input.queryId, "unknown_query_id");
    return errorResult("unknown_query_id");
  }
  if (store.getReceipt(input.queryId) !== undefined) {
    store.recordAudit(input.queryId, "already_released");
    return errorResult("already_released");
  }

  if (
    input.purpose !== entry.candidate.purpose ||
    input.audience !== entry.candidate.audience ||
    canonicalize(input.columns) !== canonicalize(entry.candidate.columns) ||
    input.suppressedCells !== entry.suppressedCells
  ) {
    store.recordAudit(input.queryId, "denied", [{ code: "approval_tuple_mismatch" }]);
    return errorResult("release_denied", "approval_tuple_mismatch");
  }

  const verdict = verifyRelease(entry.candidate, input.contractHash, input.outputHash);
  if (verdict.status !== "approved") {
    store.recordAudit(input.queryId, verdict.status, verdict.findings);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "release_denied",
            status: verdict.status,
            findings: verdict.findings,
          }),
        },
      ],
      isError: true,
    };
  }

  // Execution-time evidence revalidation: the stored candidate must match
  // what the vault can reproduce from its own data right now. A candidate
  // that lies about group sizes passes every contract rule — only the data
  // owner recomputing its own aggregation can catch it.
  const recomputed = aggregateCandidateRows(
    db,
    entry.candidate.queryPlan.dimensions,
    // Approval already proved metric membership in ALLOWED_METRICS, which is
    // the same closed set AggregateMetric names.
    entry.candidate.queryPlan.metric as AggregateMetric,
  );
  if (
    canonicalize(recomputed.rows) !== canonicalize(entry.candidate.rows) ||
    recomputed.suppressedCells !== entry.suppressedCells
  ) {
    store.recordAudit(input.queryId, "denied", [{ code: "evidence_mismatch" }]);
    return errorResult("release_denied", "evidence_mismatch");
  }

  const receipt = store.saveReceipt({
    queryId: input.queryId,
    contractHash: verdict.contractHash,
    outputHash: verdict.outputHash,
    datasetVersion: entry.candidate.datasetVersion,
    policyVersion: entry.candidate.policyVersion,
  });
  store.recordAudit(input.queryId, "released");

  return jsonResult({
    receipt,
    columns: entry.candidate.columns,
    rows: projectReleasedRows(entry.candidate),
    openui: renderReceiptCard(receipt),
  });
}

export function createVaultHandlers(db: VaultDatabase, store: VaultStore): VaultToolHandlers {
  return {
    // Metadata only: column names, sensitivity labels, policy constants, and
    // one aggregate count. No code path here touches a row value.
    describeDataset: () =>
      jsonResult({
        datasetVersion: DATASET_VERSION,
        policyVersion: POLICY_VERSION,
        mission: { purpose: ALLOWED_PURPOSE, audience: ALLOWED_AUDIENCE },
        columns: Object.entries(COLUMN_SENSITIVITY).map(([name, sensitivity]) => ({
          name,
          sensitivity,
        })),
        safeDimensions: SAFE_DIMENSIONS,
        metrics: ALLOWED_METRICS,
        // The raw dataset total, deliberately. Together with suppressedCells
        // it lets a caller solve the global size histogram of withheld cells
        // (how many are size 1, how many size 2) — but not which cells they
        // are, so no individual is isolated. That any missing cell is under k
        // is inherent to cell suppression; the approver's need to know the
        // real dataset size outweighs the residual.
        rowCount: db.rowCount(),
        minGroupSize: MIN_GROUP_SIZE,
        maxReleaseRows: MAX_RELEASE_ROWS,
      }),
    prepareAnalysis: (input) => {
      // Authorization strictly precedes data access: a denied mission must
      // leave with zero SQLite queries executed, not merely zero rows shown.
      const mission = authorizeMission(input.purpose, input.audience);
      if (!mission.authorized) {
        // The most significant enforcement event the vault sees: someone asked
        // it for something outside the authorized mission.
        store.recordAudit("-", "mission_not_authorized");
        const findings = mission.reasons.map((code) => ({ code }));
        return errorResult("mission_not_authorized", undefined, {
          findingCodes: mission.reasons.join(", "),
          openui: renderDecisionCard("-", 0, { status: "denied", findings }),
        });
      }
      const dimensions = input.dimensions;
      // Allowlists first, structural checks after: reversed, one padding
      // element would make a malformed-plan denial fire ahead of the
      // allowlist and swallow the audit record, so a caller could name every
      // sensitive column and leave no trace. Both reaches are auditable even
      // though no queryId exists yet — for every request that reaches this
      // handler. One the tool schema rejects never gets here and is not
      // audited; that error is identical whichever column was named, so it
      // touches no data and carries no oracle.
      for (const dimension of dimensions) {
        if (!(SAFE_DIMENSIONS as readonly string[]).includes(dimension)) {
          store.recordAudit("-", "dimension_not_allowed");
          return errorResult("dimension_not_allowed", dimension.slice(0, 120));
        }
      }
      if (!(ALLOWED_METRICS as readonly string[]).includes(input.metric)) {
        store.recordAudit("-", "metric_not_allowed");
        return errorResult("metric_not_allowed", input.metric.slice(0, 120));
      }
      // Only reachable once every named column is allowlisted, so these two
      // denials cannot carry a sensitive column name. They stay unaudited on
      // purpose: malformed plans are client bugs, not reaches for sensitive
      // data, and auditing them would grow the uncapped log for nothing.
      if (dimensions.length > SAFE_DIMENSIONS.length) {
        return errorResult("too_many_dimensions", String(dimensions.length));
      }
      if (new Set(dimensions).size !== dimensions.length) {
        return errorResult("duplicate_dimension");
      }

      // Suppression happens inside the vault: a small cell never appears in
      // any candidate, so no downstream mistake can release it.
      const { rows, suppressedCells } = aggregateCandidateRows(
        db,
        dimensions,
        input.metric as AggregateMetric,
      );

      const entry = store.savePrepared(
        {
          purpose: input.purpose,
          audience: input.audience,
          columns: [...dimensions, input.metric],
          rows,
          minGroupSize: MIN_GROUP_SIZE,
          datasetVersion: DATASET_VERSION,
          policyVersion: POLICY_VERSION,
          queryPlan: {
            sourceDataset: "support",
            dimensions,
            metric: input.metric,
            filters: [],
            joins: [],
          },
        },
        suppressedCells,
      );
      return jsonResult(entry);
    },
    validateRelease: (input) => {
      // The candidate comes from the vault store, never the caller: what gets
      // validated and hashed is exactly what prepare_analysis produced.
      const entry = store.getPrepared(input.queryId);
      if (entry === undefined) return errorResult("unknown_query_id");
      const verdict = validateRelease(entry.candidate);
      const findingCodes =
        verdict.status === "approved" ? "" : verdict.findings.map(({ code }) => code).join(", ");
      return jsonResult({
        queryId: entry.queryId,
        ...verdict,
        findingCodes,
        openui: renderDecisionCard(entry.queryId, entry.suppressedCells, verdict),
      });
    },
    releaseResult: (input) => {
      // The transport already converts a throw into a generic error; this
      // catch exists so the denial still reaches the audit log.
      try {
        return releaseResultInner(db, store, input);
      } catch {
        store.recordAudit(input.queryId, "denied", [{ code: "candidate_malformed" }]);
        return errorResult("internal_error");
      }
    },
    renderSafeChart: (input) => {
      const entry = store.getPrepared(input.queryId);
      if (entry === undefined) return errorResult("unknown_query_id");
      // Charts render released data only: before a receipt exists the
      // aggregate is still a candidate, not something to show around.
      const receipt = store.getReceipt(input.queryId);
      if (receipt === undefined) {
        // Reading an unapproved aggregate is an attempted disclosure.
        store.recordAudit(input.queryId, "not_released");
        return errorResult("not_released");
      }
      const { candidate } = entry;
      const rows = projectReleasedRows(candidate);
      return jsonResult({
        queryId: entry.queryId,
        receiptId: receipt.receiptId,
        title: `${candidate.queryPlan.metric} by ${candidate.queryPlan.dimensions.join(", ")}`,
        dimensions: candidate.queryPlan.dimensions,
        metric: candidate.queryPlan.metric,
        columns: candidate.columns,
        rows,
        // Vault-authored card: the complete OpenUI block, rendered
        // deterministically from the released aggregate. The agent pastes it
        // verbatim; Gate A detects any later model-authored mismatch.
        openui: renderChartBlock({
          receiptId: receipt.receiptId,
          dimensions: candidate.queryPlan.dimensions,
          metric: candidate.queryPlan.metric,
          rows,
          suppressedCells: entry.suppressedCells,
        }),
      });
    },
  };
}

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
import type { AggregateMetric, VaultDatabase } from "../vault/database.js";
import { COLUMN_SENSITIVITY, DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import { errorResult, jsonResult, type VaultToolHandlers } from "./mcp.js";
import type { VaultStore } from "./store.js";

// prepare_analysis and release_result must build rows identically: release
// recomputes this from the live database and any difference from the stored
// candidate — regrouped cells, drifted values, smuggled rows — is denied.
function aggregateCandidateRows(
  db: VaultDatabase,
  dimensions: readonly string[],
  metric: AggregateMetric,
): { rows: ReadonlyArray<Record<string, string | number>>; suppressedCells: number } {
  const cells = db.aggregate(dimensions, metric);
  const releasable = cells.filter((cell) => cell.groupSize >= MIN_GROUP_SIZE);
  return {
    rows: releasable.map((cell) =>
      Object.freeze({
        ...cell.dimensions,
        [metric]: cell.value,
        [GROUP_SIZE_FIELD]: cell.groupSize,
      }),
    ),
    suppressedCells: cells.length - releasable.length,
  };
}

function releaseResultInner(
  db: VaultDatabase,
  store: VaultStore,
  input: { queryId: string; contractHash: string; outputHash: string },
) {
  const entry = store.getPrepared(input.queryId);
  if (entry === undefined) {
    store.recordAudit(input.queryId, "unknown_query_id");
    return errorResult("unknown_query_id");
  }
  if (store.getReceipt(input.queryId) !== undefined) {
    store.recordAudit(input.queryId, "already_released");
    return errorResult("already_released");
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
  if (canonicalize(recomputed.rows) !== canonicalize(entry.candidate.rows)) {
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

  const releasedRows = entry.candidate.rows.map((row) => {
    const projected: Record<string, string | number> = {};
    for (const column of entry.candidate.columns) {
      const value = row[column];
      if (value !== undefined) projected[column] = value;
    }
    return projected;
  });
  return jsonResult({ receipt, columns: entry.candidate.columns, rows: releasedRows });
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
        rowCount: db.rowCount(),
        minGroupSize: MIN_GROUP_SIZE,
        maxReleaseRows: MAX_RELEASE_ROWS,
      }),
    prepareAnalysis: (input) => {
      // Authorization strictly precedes data access: a denied mission must
      // leave with zero SQLite queries executed, not merely zero rows shown.
      const mission = authorizeMission(input.purpose, input.audience);
      if (!mission.authorized) {
        return errorResult("mission_not_authorized", mission.reasons.join(","));
      }
      const dimensions = input.dimensions;
      if (dimensions.length > SAFE_DIMENSIONS.length) {
        return errorResult("too_many_dimensions", String(dimensions.length));
      }
      if (new Set(dimensions).size !== dimensions.length) {
        return errorResult("duplicate_dimension");
      }
      for (const dimension of dimensions) {
        if (!(SAFE_DIMENSIONS as readonly string[]).includes(dimension)) {
          return errorResult("dimension_not_allowed", dimension.slice(0, 120));
        }
      }
      if (!(ALLOWED_METRICS as readonly string[]).includes(input.metric)) {
        return errorResult("metric_not_allowed", input.metric.slice(0, 120));
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
      return jsonResult({ queryId: entry.queryId, ...validateRelease(entry.candidate) });
    },
    releaseResult: (input) => {
      // Any escaped exception would be a denial with no audit record and an
      // internal error message echoed to the caller — neither is fail-closed.
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
      if (receipt === undefined) return errorResult("not_released");
      const { candidate } = entry;
      const rows = candidate.rows.map((row) => {
        const projected: Record<string, string | number> = {};
        for (const column of candidate.columns) {
          const value = row[column];
          if (value !== undefined) projected[column] = value;
        }
        return projected;
      });
      return jsonResult({
        queryId: entry.queryId,
        receiptId: receipt.receiptId,
        title: `${candidate.queryPlan.metric} by ${candidate.queryPlan.dimensions.join(", ")}`,
        dimensions: candidate.queryPlan.dimensions,
        metric: candidate.queryPlan.metric,
        columns: candidate.columns,
        rows,
      });
    },
  };
}

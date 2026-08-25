import {
  ALLOWED_AUDIENCE,
  ALLOWED_PURPOSE,
  authorizeMission,
  POLICY_VERSION,
} from "../contract/policy.js";
import { ALLOWED_METRICS } from "../contract/queryPlan.js";
import { GROUP_SIZE_FIELD, MAX_RELEASE_ROWS, MIN_GROUP_SIZE } from "../contract/rows.js";
import { validateRelease } from "../contract/validate.js";
import type { AggregateMetric, VaultDatabase } from "../vault/database.js";
import { COLUMN_SENSITIVITY, DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import { errorResult, jsonResult, type ToolResult, type VaultToolHandlers } from "./mcp.js";
import type { VaultStore } from "./store.js";

const notImplemented = (): ToolResult => errorResult("not_implemented");

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

      const cells = db.aggregate(dimensions, input.metric as AggregateMetric);
      // Suppression happens inside the vault: a small cell never appears in
      // any candidate, so no downstream mistake can release it.
      const releasable = cells.filter((cell) => cell.groupSize >= MIN_GROUP_SIZE);
      const suppressedCells = cells.length - releasable.length;

      const entry = store.savePrepared(
        {
          purpose: input.purpose,
          audience: input.audience,
          columns: [...dimensions, input.metric],
          rows: releasable.map((cell) =>
            Object.freeze({
              ...cell.dimensions,
              [input.metric]: cell.value,
              [GROUP_SIZE_FIELD]: cell.groupSize,
            }),
          ),
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
    releaseResult: notImplemented,
    renderSafeChart: notImplemented,
  };
}

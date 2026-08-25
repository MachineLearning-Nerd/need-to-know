import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE, POLICY_VERSION } from "../contract/policy.js";
import { ALLOWED_METRICS } from "../contract/queryPlan.js";
import { MAX_RELEASE_ROWS, MIN_GROUP_SIZE } from "../contract/rows.js";
import type { VaultDatabase } from "../vault/database.js";
import { COLUMN_SENSITIVITY, DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import { errorResult, jsonResult, type ToolResult, type VaultToolHandlers } from "./mcp.js";

const notImplemented = (): ToolResult => errorResult("not_implemented");

export function createVaultHandlers(db: VaultDatabase): VaultToolHandlers {
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
    prepareAnalysis: notImplemented,
    validateRelease: notImplemented,
    releaseResult: notImplemented,
    renderSafeChart: notImplemented,
  };
}

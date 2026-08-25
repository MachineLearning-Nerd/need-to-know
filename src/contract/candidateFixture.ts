import { DATASET_VERSION } from "../vault/schema.js";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE, POLICY_VERSION } from "./policy.js";
import { MIN_GROUP_SIZE } from "./rows.js";
import type { ReleaseCandidate } from "./validate.js";

export function makeCandidate(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    purpose: ALLOWED_PURPOSE,
    audience: ALLOWED_AUDIENCE,
    columns: ["week", "region", "ticket_count"],
    rows: [
      { week: "2026-W32", region: "NA", ticket_count: 12, group_size: 12 },
      { week: "2026-W32", region: "EU", ticket_count: 9, group_size: 9 },
    ],
    minGroupSize: MIN_GROUP_SIZE,
    datasetVersion: DATASET_VERSION,
    policyVersion: POLICY_VERSION,
    queryPlan: {
      sourceDataset: "support",
      dimensions: ["week", "region"],
      metric: "ticket_count",
      filters: [],
      joins: [],
    },
    provenance: { sourceDataset: "support", datasetVersion: DATASET_VERSION, queryId: "query-1" },
    ...overrides,
  };
}

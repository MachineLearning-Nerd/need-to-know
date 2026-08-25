import { DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import type { Finding } from "./findings.js";
import { POLICY_VERSION } from "./policy.js";

export const ALLOWED_SOURCE_DATASET = "support";
export const ALLOWED_METRICS = Object.freeze(["ticket_count", "avg_resolution_hours"] as const);

export type QueryPlan = {
  readonly sourceDataset: string;
  readonly dimensions: readonly string[];
  readonly metric: string;
  // Present so a proposed plan carrying either is visible and deniable —
  // the MVP mission approves no filters and no joins at all.
  readonly filters: readonly unknown[];
  readonly joins: readonly unknown[];
};

export type Provenance = {
  readonly sourceDataset: string;
  readonly datasetVersion: string;
  readonly queryId: string;
};

export function checkQueryPlan(plan: QueryPlan): Finding[] {
  const findings: Finding[] = [];
  if (plan.sourceDataset !== ALLOWED_SOURCE_DATASET) {
    findings.push({ code: "plan_source_not_allowed", detail: plan.sourceDataset });
  }
  for (const dimension of plan.dimensions) {
    if (!(SAFE_DIMENSIONS as readonly string[]).includes(dimension)) {
      findings.push({ code: "plan_dimension_not_allowed", detail: dimension });
    }
  }
  if (!(ALLOWED_METRICS as readonly string[]).includes(plan.metric)) {
    findings.push({ code: "plan_metric_not_allowed", detail: plan.metric });
  }
  if (plan.filters.length > 0) {
    findings.push({ code: "plan_filter_not_allowed", detail: String(plan.filters.length) });
  }
  if (plan.joins.length > 0) {
    findings.push({ code: "plan_join_not_allowed", detail: String(plan.joins.length) });
  }
  return findings;
}

export function checkProvenance(
  provenance: Provenance,
  plan: QueryPlan,
  datasetVersion: string,
  policyVersion: string,
): Finding[] {
  const findings: Finding[] = [];
  if (provenance.sourceDataset !== plan.sourceDataset) {
    findings.push({ code: "provenance_source_mismatch", detail: provenance.sourceDataset });
  }
  if (provenance.datasetVersion !== DATASET_VERSION) {
    findings.push({
      code: "dataset_version_mismatch",
      detail: `provenance: ${provenance.datasetVersion}`,
    });
  }
  if (datasetVersion !== DATASET_VERSION) {
    findings.push({ code: "dataset_version_mismatch", detail: `candidate: ${datasetVersion}` });
  }
  if (policyVersion !== POLICY_VERSION) {
    findings.push({ code: "policy_version_mismatch", detail: policyVersion });
  }
  return findings;
}

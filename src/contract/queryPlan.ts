import { DATASET_VERSION, SAFE_DIMENSIONS } from "../vault/schema.js";
import { clipDetail, type Finding } from "./findings.js";
import { POLICY_VERSION } from "./policy.js";

export const ALLOWED_SOURCE_DATASET = "support";
export const ALLOWED_METRICS = Object.freeze(["ticket_count", "avg_resolution_hours"] as const);

// Every other caller string is compared against an exact literal or a closed
// domain before anything is hashed; queryId is vault-issued, so it gets a
// shape bound too — otherwise it is the one unconstrained string that could
// ride an approved candidate into canonical serialization and SHA-256.
// Module-private and frozen: an exported mutable RegExp would let an importer
// shadow .test at runtime and reopen the unbounded-queryId path.
const QUERY_ID_PATTERN = Object.freeze(/^[A-Za-z0-9_-]{1,64}$/);

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
    findings.push({ code: "plan_source_not_allowed", detail: clipDetail(plan.sourceDataset) });
  }
  if (plan.dimensions.length > SAFE_DIMENSIONS.length) {
    // Same cap rationale as too_many_columns: no valid plan exceeds the safe
    // set, and one finding per bogus dimension would let a huge plan exhaust
    // the validator instead of being judged by it.
    findings.push({ code: "too_many_dimensions", detail: String(plan.dimensions.length) });
  } else {
    // A plan no real query produced must not be approved and hash-bound:
    // duplicates survive the engine's set comparison against columns.
    if (new Set(plan.dimensions).size !== plan.dimensions.length) {
      findings.push({ code: "duplicate_dimension" });
    }
    for (const dimension of plan.dimensions) {
      if (!(SAFE_DIMENSIONS as readonly string[]).includes(dimension)) {
        findings.push({ code: "plan_dimension_not_allowed", detail: clipDetail(dimension) });
      }
    }
  }
  if (!(ALLOWED_METRICS as readonly string[]).includes(plan.metric)) {
    findings.push({ code: "plan_metric_not_allowed", detail: clipDetail(plan.metric) });
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
    findings.push({
      code: "provenance_source_mismatch",
      detail: clipDetail(provenance.sourceDataset),
    });
  }
  if (provenance.datasetVersion !== DATASET_VERSION) {
    findings.push({
      code: "dataset_version_mismatch",
      detail: clipDetail(`provenance: ${provenance.datasetVersion}`),
    });
  }
  if (datasetVersion !== DATASET_VERSION) {
    findings.push({
      code: "dataset_version_mismatch",
      detail: clipDetail(`candidate: ${datasetVersion}`),
    });
  }
  if (policyVersion !== POLICY_VERSION) {
    findings.push({ code: "policy_version_mismatch", detail: clipDetail(policyVersion) });
  }
  if (!QUERY_ID_PATTERN.test(provenance.queryId)) {
    findings.push({ code: "value_out_of_domain", detail: "provenance.queryId" });
  }
  return findings;
}

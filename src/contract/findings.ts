export type Finding = { readonly code: FindingCode; readonly detail?: string };

// Details echo caller-controlled strings into findings that end up in the
// audit trail; unclipped, one megabyte-sized column name amplifies into
// several megabytes of persisted detail across the findings it triggers.
const MAX_DETAIL_LENGTH = 120;

export function clipDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}…` : detail;
}

export type FindingCode =
  // mission
  | "purpose_not_authorized"
  | "audience_not_authorized"
  // columns and rows
  | "no_columns"
  | "too_many_columns"
  | "duplicate_column"
  | "column_not_allowlisted"
  | "no_rows"
  | "too_many_rows"
  | "row_field_undeclared"
  | "row_field_missing"
  | "group_size_missing"
  | "group_size_below_minimum"
  | "value_not_releasable"
  | "value_contains_contact_pattern"
  // query plan and provenance
  | "plan_source_not_allowed"
  | "too_many_dimensions"
  | "duplicate_dimension"
  | "plan_dimension_not_allowed"
  | "plan_metric_not_allowed"
  | "plan_filter_not_allowed"
  | "plan_join_not_allowed"
  | "provenance_source_mismatch"
  | "dataset_version_mismatch"
  | "policy_version_mismatch"
  // engine
  | "min_group_size_mismatch"
  | "columns_plan_mismatch"
  | "value_out_of_domain"
  | "candidate_malformed"
  | "contract_hash_mismatch"
  | "output_hash_mismatch"
  // vault execution-time revalidation: the stored candidate no longer matches
  // what the vault can reproduce from its own data
  | "evidence_mismatch";

import type { Finding } from "./findings.js";

export const MIN_GROUP_SIZE = 3;
export const MAX_RELEASE_ROWS = 50;

// Positive construction: a release names its columns from this list; anything
// else is impossible to request, not merely filtered out.
export const ALLOWED_RELEASE_COLUMNS = Object.freeze([
  "week",
  "region",
  "category",
  "ticket_count",
  "avg_resolution_hours",
] as const);

// Per-row aggregation metadata: present on every candidate row, never released.
export const GROUP_SIZE_FIELD = "group_size";

export type AllowedReleaseColumn = (typeof ALLOWED_RELEASE_COLUMNS)[number];

// Every releasable column has a closed value domain. A safe-dimension column
// is not a free string slot: without this, raw identifiers or free text could
// cross the boundary relabeled as "week" or "region".
const COLUMN_DOMAINS: Readonly<Record<AllowedReleaseColumn, (value: unknown) => boolean>> =
  Object.freeze({
    week: (value) => typeof value === "string" && /^\d{4}-W\d{2}$/.test(value),
    region: (value) => typeof value === "string" && /^[A-Z]{2,8}$/.test(value),
    category: (value) => typeof value === "string" && /^[a-z][a-z_]{0,31}$/.test(value),
    ticket_count: (value) =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000,
    avg_resolution_hours: (value) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000,
  });

export function checkColumns(columns: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  if (columns.length === 0) findings.push({ code: "no_columns" });
  if (new Set(columns).size !== columns.length) findings.push({ code: "duplicate_column" });
  for (const column of columns) {
    if (!(ALLOWED_RELEASE_COLUMNS as readonly string[]).includes(column)) {
      findings.push({ code: "column_not_allowlisted", detail: column });
    }
  }
  return findings;
}

export function checkRows(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  columns: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  if (rows.length === 0) findings.push({ code: "no_rows" });
  if (rows.length > MAX_RELEASE_ROWS) {
    findings.push({ code: "too_many_rows", detail: String(rows.length) });
  }
  const declared = new Set([...columns, GROUP_SIZE_FIELD]);
  rows.forEach((row, index) => {
    const at = (field: string) => `row ${index}: ${field}`;
    for (const field of Object.keys(row)) {
      if (!declared.has(field)) findings.push({ code: "row_field_undeclared", detail: at(field) });
    }
    for (const column of columns) {
      // Own-property check: a value inherited via the prototype chain would
      // skip the own-enumerable value checks above, so it does not count.
      if (!Object.hasOwn(row, column)) {
        findings.push({ code: "row_field_missing", detail: at(column) });
      }
    }
    const groupSize = row[GROUP_SIZE_FIELD];
    if (typeof groupSize !== "number" || !Number.isInteger(groupSize)) {
      findings.push({ code: "group_size_missing", detail: `row ${index}` });
    } else if (groupSize < MIN_GROUP_SIZE) {
      findings.push({ code: "group_size_below_minimum", detail: `row ${index}: ${groupSize}` });
    }
    for (const [field, value] of Object.entries(row)) {
      if (Object.hasOwn(COLUMN_DOMAINS, field)) {
        const inDomain = COLUMN_DOMAINS[field as AllowedReleaseColumn](value);
        if (!inDomain) findings.push({ code: "value_out_of_domain", detail: at(field) });
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value))
          findings.push({ code: "value_not_releasable", detail: at(field) });
      } else if (typeof value === "string") {
        // Released values are safe dimensions and metrics; contact-shaped
        // strings (email/phone patterns) can only mean a boundary failure.
        if (/@|\+?\d[\d\s\-()]{6,}/.test(value)) {
          findings.push({ code: "value_contains_contact_pattern", detail: at(field) });
        }
      } else {
        findings.push({ code: "value_not_releasable", detail: at(field) });
      }
    }
  });
  return findings;
}

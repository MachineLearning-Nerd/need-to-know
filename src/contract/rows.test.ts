import { describe, expect, it } from "vitest";

import { checkColumns, checkRows, MAX_RELEASE_ROWS, MIN_GROUP_SIZE } from "./rows.js";

const COLUMNS = ["week", "region", "ticket_count"];
const goodRow = { week: "2026-W33", region: "NA", ticket_count: 12, group_size: 12 };

function codes(findings: ReadonlyArray<{ code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

describe("checkColumns", () => {
  it("accepts allowlisted, unique columns", () => {
    expect(checkColumns(COLUMNS)).toEqual([]);
  });

  it("rejects empty, duplicate, and non-allowlisted columns", () => {
    expect(codes(checkColumns([]))).toContain("no_columns");
    expect(codes(checkColumns(["week", "week"]))).toContain("duplicate_column");
    for (const column of ["email", "phone", "free_text", "customer_id", "id"]) {
      expect(checkColumns(["week", column])).toEqual([
        { code: "column_not_allowlisted", detail: column },
      ]);
    }
  });
});

describe("checkRows", () => {
  it("accepts bounded rows with declared fields and k >= minimum", () => {
    expect(checkRows([goodRow], COLUMNS)).toEqual([]);
    expect(MIN_GROUP_SIZE).toBe(3);
  });

  it("rejects empty and oversized row sets", () => {
    expect(codes(checkRows([], COLUMNS))).toContain("no_rows");
    const many = Array.from({ length: MAX_RELEASE_ROWS + 1 }, () => goodRow);
    expect(codes(checkRows(many, COLUMNS))).toContain("too_many_rows");
  });

  it("rejects undeclared and missing row fields", () => {
    expect(codes(checkRows([{ ...goodRow, email: "x" }], COLUMNS))).toContain(
      "row_field_undeclared",
    );
    const { ticket_count: _dropped, ...missing } = goodRow;
    expect(codes(checkRows([missing], COLUMNS))).toContain("row_field_missing");
  });

  it("rejects small cells and absent group sizes", () => {
    expect(codes(checkRows([{ ...goodRow, group_size: MIN_GROUP_SIZE - 1 }], COLUMNS))).toContain(
      "group_size_below_minimum",
    );
    const { group_size: _dropped, ...noGroup } = goodRow;
    expect(codes(checkRows([noGroup], COLUMNS))).toContain("group_size_missing");
    expect(codes(checkRows([{ ...goodRow, group_size: 2.5 }], COLUMNS))).toContain(
      "group_size_missing",
    );
  });

  it("rejects contact-shaped and non-releasable values", () => {
    expect(
      codes(checkRows([{ ...goodRow, region: "canary-customer@example.invalid" }], COLUMNS)),
    ).toContain("value_contains_contact_pattern");
    expect(codes(checkRows([{ ...goodRow, region: "+1-555-123-4567" }], COLUMNS))).toContain(
      "value_contains_contact_pattern",
    );
    expect(codes(checkRows([{ ...goodRow, ticket_count: Number.NaN }], COLUMNS))).toContain(
      "value_not_releasable",
    );
    expect(codes(checkRows([{ ...goodRow, region: true }], COLUMNS))).toContain(
      "value_not_releasable",
    );
  });
});

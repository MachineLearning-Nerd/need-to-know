import { describe, expect, it } from "vitest";

import { makeCandidate } from "./candidateFixture.js";
import { validateRelease, verifyRelease } from "./validate.js";

describe("validateRelease", () => {
  it("approves a fully conforming candidate with both hashes", () => {
    const result = validateRelease(makeCandidate());
    expect(result.status).toBe("approved");
    if (result.status === "approved") {
      expect(result.contractHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.outputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.contractHash).not.toBe(result.outputHash);
    }
  });

  it("is deterministic: same candidate, same hashes", () => {
    expect(validateRelease(makeCandidate())).toEqual(validateRelease(makeCandidate()));
  });

  it("keeps group_size out of the output hash but bound into the contract hash", () => {
    const base = makeCandidate();
    const regrouped = makeCandidate({
      rows: base.rows.map((row) => ({ ...row, group_size: 50 })),
    });
    const first = validateRelease(base);
    const second = validateRelease(regrouped);
    if (first.status !== "approved" || second.status !== "approved") {
      throw new Error("fixtures must validate");
    }
    expect(second.outputHash).toBe(first.outputHash);
    expect(second.contractHash).not.toBe(first.contractHash);
  });

  it("denies a plan with duplicate dimensions even when the column sets match", () => {
    const result = validateRelease(
      makeCandidate({
        queryPlan: {
          sourceDataset: "support",
          dimensions: ["week", "region", "region"],
          metric: "ticket_count",
          filters: [],
          joins: [],
        },
      }),
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toContainEqual({ code: "duplicate_dimension" });
    }
  });

  it("denies columns that are not exactly what the plan computes", () => {
    const result = validateRelease(
      makeCandidate({
        columns: ["week", "region", "avg_resolution_hours"],
        rows: [{ week: "2026-W32", region: "NA", avg_resolution_hours: 5.5, group_size: 12 }],
      }),
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toContainEqual({
        code: "columns_plan_mismatch",
        detail: "week,region,avg_resolution_hours",
      });
    }
  });

  it("approves when columns match a plan computing avg_resolution_hours", () => {
    const result = validateRelease(
      makeCandidate({
        columns: ["week", "region", "avg_resolution_hours"],
        rows: [{ week: "2026-W32", region: "NA", avg_resolution_hours: 5.5, group_size: 12 }],
        queryPlan: {
          sourceDataset: "support",
          dimensions: ["week", "region"],
          metric: "avg_resolution_hours",
          filters: [],
          joins: [],
        },
      }),
    );
    expect(result.status).toBe("approved");
  });

  it("denies with every violated rule reported, not just the first", () => {
    const result = validateRelease(
      makeCandidate({
        purpose: "export customer emails",
        columns: ["week", "email"],
        rows: [{ week: "2026-W33", email: "a@b.c", group_size: 1 }],
      }),
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      const codes = result.findings.map((finding) => finding.code);
      expect(codes).toContain("purpose_not_authorized");
      expect(codes).toContain("column_not_allowlisted");
      expect(codes).toContain("group_size_below_minimum");
      expect(codes).toContain("value_contains_contact_pattern");
    }
  });

  it("denies a lowered minimum group size", () => {
    const result = validateRelease(makeCandidate({ minGroupSize: 1 }));
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toContainEqual({ code: "min_group_size_mismatch", detail: "1" });
    }
  });

  it("denies an oversized candidate with bounded findings instead of exhausting", () => {
    const columns = Array.from({ length: 9_999 }, (_, i) => `col_${i}`);
    const rows = Array.from({ length: 60 }, () => ({
      week: "2026-W32",
      region: "NA",
      ticket_count: 12,
      group_size: 12,
    }));
    const result = validateRelease(makeCandidate({ columns, rows }));
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      const codes = result.findings.map((finding) => finding.code);
      expect(codes).toContain("too_many_columns");
      expect(codes).toContain("too_many_rows");
      expect(result.findings.length).toBeLessThan(10);
    }
  });

  it("returns needs_review for malformed input instead of throwing", () => {
    for (const malformed of [null, 42, "release", {}, { purpose: "weekly support trend" }, []]) {
      const result = validateRelease(malformed);
      expect(result.status, JSON.stringify(malformed)).toBe("needs_review");
    }
  });
});

describe("verifyRelease", () => {
  it("approves when both hashes match a fresh recomputation", () => {
    const first = validateRelease(makeCandidate());
    if (first.status !== "approved") throw new Error("fixture must validate");
    const result = verifyRelease(makeCandidate(), first.contractHash, first.outputHash);
    expect(result).toEqual(first);
  });

  it("denies a tampered hash", () => {
    const first = validateRelease(makeCandidate());
    if (first.status !== "approved") throw new Error("fixture must validate");
    const wrong = first.outputHash.replace(/^./, first.outputHash.startsWith("0") ? "1" : "0");
    const result = verifyRelease(makeCandidate(), first.contractHash, wrong);
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toEqual([{ code: "output_hash_mismatch" }]);
    }
  });
});

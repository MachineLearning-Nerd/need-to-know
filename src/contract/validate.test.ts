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

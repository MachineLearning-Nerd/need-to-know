import { describe, expect, it } from "vitest";

import { CANARY } from "../vault/seed.js";
import { makeCandidate } from "./candidateFixture.js";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "./policy.js";
import { type ReleaseCandidate, validateRelease, verifyRelease } from "./validate.js";

function approvedHashes(candidate: ReleaseCandidate): { contractHash: string; outputHash: string } {
  const result = validateRelease(candidate);
  if (result.status !== "approved") throw new Error("fixture must validate");
  return { contractHash: result.contractHash, outputHash: result.outputHash };
}

describe("post-approval tampering", () => {
  // Every mutation of an approved candidate must fail execution-time
  // verification against the originally approved hashes.
  const tampers: ReadonlyArray<[string, Partial<ReleaseCandidate>]> = [
    [
      "changed metric value",
      { rows: [{ week: "2026-W32", region: "NA", ticket_count: 9999, group_size: 12 }] },
    ],
    [
      "extra row appended",
      {
        rows: [
          ...makeCandidate().rows,
          { week: "2026-W31", region: "NA", ticket_count: 5, group_size: 5 },
        ],
      },
    ],
    ["row removed", { rows: makeCandidate().rows.slice(0, 1) }],
    ["column list changed", { columns: ["week", "region", "avg_resolution_hours"] }],
    ["purpose swapped", { purpose: "incident postmortem" }],
    ["dataset version rolled back", { datasetVersion: "support-tickets-v0" }],
    [
      "provenance query swapped",
      {
        provenance: {
          sourceDataset: "support",
          datasetVersion: "support-tickets-v1",
          queryId: "query-2",
        },
      },
    ],
  ];

  for (const [name, tamper] of tampers) {
    it(`denies release after tampering: ${name}`, () => {
      const { contractHash, outputHash } = approvedHashes(makeCandidate());
      const result = verifyRelease(makeCandidate(tamper), contractHash, outputHash);
      expect(result.status).toBe("denied");
    });
  }

  it("denies swapped hashes even when both candidates individually validate", () => {
    const original = approvedHashes(makeCandidate());
    const other = makeCandidate({
      rows: [{ week: "2026-W31", region: "EU", ticket_count: 4, group_size: 4 }],
    });
    const result = verifyRelease(other, original.contractHash, original.outputHash);
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toEqual([{ code: "output_hash_mismatch" }]);
    }
  });
});

describe("canary containment", () => {
  it("denies the canary email wherever it appears as a released value", () => {
    for (const column of ["week", "region"]) {
      const rows = [
        { ...makeCandidate().rows[0], [column]: CANARY.email } as Record<string, string | number>,
      ];
      const result = validateRelease(makeCandidate({ rows }));
      expect(result.status, column).toBe("denied");
    }
  });

  it("denies canary free text because free_text can never be declared", () => {
    const result = validateRelease(
      makeCandidate({
        columns: ["week", "region", "free_text"],
        rows: [{ week: "2026-W32", region: "NA", free_text: CANARY.freeText, group_size: 12 }],
      }),
    );
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings.map((finding) => finding.code)).toContain("column_not_allowlisted");
    }
  });
});

describe("hostile object shapes fail closed", () => {
  it("returns needs_review when a row property accessor throws", () => {
    const trap: Record<string, unknown> = { region: "NA", ticket_count: 1, group_size: 12 };
    Object.defineProperty(trap, "week", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });
    const result = validateRelease(makeCandidate({ rows: [trap as never] }));
    expect(result.status).toBe("needs_review");
  });

  it("rejects unknown top-level, plan, and provenance keys", () => {
    const base = makeCandidate();
    const cases = [
      { ...base, extra: "smuggled" },
      { ...base, queryPlan: { ...base.queryPlan, hint: "x" } },
      { ...base, provenance: { ...base.provenance, note: "x" } },
    ];
    for (const candidate of cases) {
      const result = validateRelease(candidate);
      expect(result.status).toBe("needs_review");
      if (result.status === "needs_review") {
        expect(result.findings).toEqual([{ code: "candidate_malformed" }]);
      }
    }
  });

  it("treats prototype-inherited columns as missing", () => {
    const inherited = Object.assign(Object.create({ week: "2026-W32" }), {
      region: "NA",
      ticket_count: 1,
      group_size: 12,
    }) as Record<string, string | number>;
    const result = validateRelease(makeCandidate({ rows: [inherited] }));
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings.map((finding) => finding.code)).toContain("row_field_missing");
    }
  });
});

describe("mission mismatch matrix", () => {
  const purposes = [ALLOWED_PURPOSE, "weekly support trends", "export customer emails"];
  const audiences = [ALLOWED_AUDIENCE, "Support Leadership", "the public"];

  for (const purpose of purposes) {
    for (const audience of audiences) {
      const shouldPass = purpose === ALLOWED_PURPOSE && audience === ALLOWED_AUDIENCE;
      it(`${shouldPass ? "approves" : "denies"} purpose="${purpose}" audience="${audience}"`, () => {
        const result = validateRelease(makeCandidate({ purpose, audience }));
        expect(result.status).toBe(shouldPass ? "approved" : "denied");
      });
    }
  }
});

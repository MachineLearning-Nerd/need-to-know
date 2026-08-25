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
    // Same group sizes as the original so the contract hash matches: only the
    // released content differs, and the output hash alone must catch it.
    const other = makeCandidate({
      rows: [
        { week: "2026-W31", region: "NA", ticket_count: 4, group_size: 12 },
        { week: "2026-W31", region: "EU", ticket_count: 7, group_size: 9 },
      ],
    });
    const result = verifyRelease(other, original.contractHash, original.outputHash);
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toEqual([{ code: "output_hash_mismatch" }]);
    }
  });

  it("denies regrouping after approval: identical output, weaker group sizes", () => {
    const { contractHash, outputHash } = approvedHashes(makeCandidate());
    const regrouped = makeCandidate({
      rows: makeCandidate().rows.map((row) => ({ ...row, group_size: 3 })),
    });
    // The regrouped candidate validates on its own (3 meets the minimum) and
    // releases byte-identical rows — only the group-size evidence bound into
    // the contract hash reveals it is not what the approver authorized.
    const result = verifyRelease(regrouped, contractHash, outputHash);
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.findings).toEqual([{ code: "contract_hash_mismatch" }]);
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

  it("denies relabeled free text and identifiers via column value domains", () => {
    const smuggles: ReadonlyArray<Record<string, string | number>> = [
      { week: CANARY.freeText, region: "NA", ticket_count: 1, group_size: 12 },
      {
        week: "2026-W32",
        region: "NA" /* domain ok */,
        ticket_count: 1,
        group_size: 12,
        category: "CUST-1000",
      } as never,
      { week: "2026-W32", region: "CUST-1000", ticket_count: 1, group_size: 12 },
    ];
    for (const [index, row] of smuggles.entries()) {
      const columns = Object.keys(row).filter((key) => key !== "group_size");
      const result = validateRelease(makeCandidate({ rows: [row], columns }));
      expect(result.status, `smuggle ${index}`).toBe("denied");
    }
    const stringMetric = validateRelease(
      makeCandidate({
        rows: [{ week: "2026-W32", region: "NA", ticket_count: "12" as never, group_size: 12 }],
      }),
    );
    expect(stringMetric.status).toBe("denied");
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

  it("returns needs_review when a top-level property accessor throws", () => {
    const trap = { ...makeCandidate() } as Record<string, unknown>;
    Object.defineProperty(trap, "purpose", {
      enumerable: true,
      get() {
        throw new Error("hostile top-level getter");
      },
    });
    expect(validateRelease(trap).status).toBe("needs_review");
  });

  it("rejects symbol and non-enumerable own keys", () => {
    const withSymbol = { ...makeCandidate() } as Record<string | symbol, unknown>;
    withSymbol[Symbol("smuggled")] = "payload";
    expect(validateRelease(withSymbol).status).toBe("needs_review");

    const withHidden = { ...makeCandidate() } as Record<string, unknown>;
    Object.defineProperty(withHidden, "hidden", { enumerable: false, value: "payload" });
    expect(validateRelease(withHidden).status).toBe("needs_review");
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

  it("rejects rows with a non-plain prototype outright", () => {
    const inherited = Object.assign(Object.create({ week: "2026-W32" }), {
      region: "NA",
      ticket_count: 1,
      group_size: 12,
    }) as Record<string, string | number>;
    const result = validateRelease(makeCandidate({ rows: [inherited] }));
    expect(result.status).toBe("needs_review");
  });

  it("rejects sparse rows arrays and own array-method overrides", () => {
    const sparse: unknown[] = [makeCandidate().rows[0]];
    sparse.length = 3;
    expect(validateRelease(makeCandidate({ rows: sparse as never })).status).toBe("needs_review");

    const canaryRow = { week: "2026-W32", region: "NA", ticket_count: 1, group_size: 1 };
    const lyingRows = [canaryRow];
    Object.defineProperty(lyingRows, "forEach", { value: () => undefined, enumerable: false });
    Object.defineProperty(lyingRows, "map", { value: () => [], enumerable: false });
    Object.defineProperty(lyingRows, "every", { value: () => true, enumerable: false });
    expect(validateRelease(makeCandidate({ rows: lyingRows as never })).status).toBe(
      "needs_review",
    );
  });

  it("snapshots once: a stateful purpose getter cannot show different values to checks and hash", () => {
    let reads = 0;
    const shifty = { ...makeCandidate() } as Record<string, unknown>;
    Object.defineProperty(shifty, "purpose", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "weekly support trend" : "export customer emails";
      },
    });
    // Accessor properties are rejected outright — the snapshot refuses to read
    // anything whose value could differ between reads.
    expect(validateRelease(shifty).status).toBe("needs_review");
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

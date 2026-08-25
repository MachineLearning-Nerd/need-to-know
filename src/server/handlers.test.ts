import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sha256Hex } from "../contract/canonical.js";
import { validateRelease } from "../contract/validate.js";
import { openVaultDatabase, type VaultDatabase } from "../vault/database.js";
import { CANARY, SMALL_CELL } from "../vault/seed.js";
import { createVaultHandlers } from "./handlers.js";
import type { VaultToolHandlers } from "./mcp.js";
import { createVaultStore } from "./store.js";

let db: VaultDatabase;
let aggregateCalls: number;
let store: ReturnType<typeof createVaultStore>;
let handlers: VaultToolHandlers;

beforeAll(() => {
  db = openVaultDatabase();
  const counted: VaultDatabase = {
    ...db,
    aggregate: (metric) => {
      aggregateCalls += 1;
      return db.aggregate(metric);
    },
  };
  store = createVaultStore();
  handlers = createVaultHandlers(counted, store);
});

afterAll(() => {
  db.close();
});

function payload(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("describe_dataset", () => {
  it("returns schema, sensitivity labels, policy constants, and safe counts", () => {
    const result = handlers.describeDataset();
    expect(result.isError).toBeUndefined();
    const described = payload(result);
    expect(described.datasetVersion).toBe("support-tickets-v1");
    expect(described.mission).toEqual({
      purpose: "weekly support trend",
      audience: "support leadership",
    });
    expect(described.columns).toContainEqual({ name: "email", sensitivity: "sensitive" });
    expect(described.columns).toContainEqual({ name: "week", sensitivity: "safe_dimension" });
    expect(described.rowCount).toBe(db.rowCount());
    expect(described.minGroupSize).toBe(3);
  });

  it("never carries a row value, sensitive or otherwise", () => {
    const text = JSON.stringify(payload(handlers.describeDataset()));
    expect(text).not.toContain(CANARY.email);
    expect(text).not.toContain(CANARY.freeText);
    expect(text).not.toContain("CUST-");
    expect(text).not.toContain("2026-W");
  });
});

const goodMission = { purpose: "weekly support trend", audience: "support leadership" };

describe("prepare_analysis", () => {
  it("denies an unauthorized mission before any query executes", () => {
    aggregateCalls = 0;
    const denials = [
      { ...goodMission, purpose: "export customer emails" },
      { ...goodMission, audience: "the public" },
      { ...goodMission, purpose: "Weekly Support Trend" },
    ];
    for (const mission of denials) {
      const result = handlers.prepareAnalysis({
        ...mission,
        dimensions: ["week", "region"],
        metric: "ticket_count",
      });
      expect(result.isError).toBe(true);
    }
    expect(aggregateCalls).toBe(0);
  });

  it("denies bad dimensions and metrics before any query executes", () => {
    aggregateCalls = 0;
    const bads = [
      { dimensions: ["week", "email"], metric: "ticket_count" },
      { dimensions: ["week", "week"], metric: "ticket_count" },
      { dimensions: ["week"], metric: "resolution_hours" },
      { dimensions: ["week", "region", "category", "week"], metric: "ticket_count" },
    ];
    for (const bad of bads) {
      const result = handlers.prepareAnalysis({ ...goodMission, ...bad });
      expect(result.isError).toBe(true);
    }
    expect(aggregateCalls).toBe(0);
  });

  it("suppresses the small cell inside the vault and yields a valid candidate", () => {
    aggregateCalls = 0;
    const result = handlers.prepareAnalysis({
      ...goodMission,
      dimensions: ["week", "region"],
      metric: "ticket_count",
    });
    expect(result.isError).toBeUndefined();
    expect(aggregateCalls).toBe(1);
    const entry = payload(result) as unknown as {
      queryId: string;
      suppressedCells: number;
      candidate: {
        rows: Array<Record<string, string | number>>;
      };
    };
    expect(entry.queryId).toMatch(/^q-\d+$/);
    // Suppression runs once at the finest granularity, so the count reports
    // the fine cells withheld regardless of the granularity requested — the
    // same number for any dimension subset, which is what makes differencing
    // across granularities yield nothing.
    expect(entry.suppressedCells).toBe(14);
    const coarser = payload(
      handlers.prepareAnalysis({ ...goodMission, dimensions: ["week"], metric: "ticket_count" }),
    ) as unknown as { suppressedCells: number };
    expect(coarser.suppressedCells).toBe(entry.suppressedCells);
    for (const row of entry.candidate.rows) {
      expect(row.group_size).toBeGreaterThanOrEqual(3);
      expect(row.region).not.toBe(SMALL_CELL.region);
    }
    expect(validateRelease(entry.candidate).status).toBe("approved");
  });

  it("computes bounded rounded averages for the second metric", () => {
    const result = handlers.prepareAnalysis({
      ...goodMission,
      dimensions: ["week", "region"],
      metric: "avg_resolution_hours",
    });
    const entry = payload(result) as unknown as {
      candidate: { rows: Array<Record<string, number>> };
    };
    for (const row of entry.candidate.rows) {
      const value = row.avg_resolution_hours as number;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(Math.round(value * 100) / 100);
    }
    expect(validateRelease(entry.candidate).status).toBe("approved");
  });

  it("validates the vault-stored candidate by queryId, not a caller body", () => {
    const prepared = payload(
      handlers.prepareAnalysis({
        ...goodMission,
        dimensions: ["week", "region"],
        metric: "ticket_count",
      }),
    ) as unknown as { queryId: string };

    const unknown = handlers.validateRelease({ queryId: "q-does-not-exist" });
    expect(unknown.isError).toBe(true);

    const verdict = payload(handlers.validateRelease({ queryId: prepared.queryId })) as unknown as {
      status: string;
      contractHash: string;
      outputHash: string;
    };
    expect(verdict.status).toBe("approved");
    expect(verdict.contractHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verdict.outputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("denies a stored candidate that violates the contract — storage is not trust", () => {
    const smuggled = store.savePrepared(
      {
        purpose: "export customer emails",
        audience: "support leadership",
        columns: ["week", "region", "ticket_count"],
        rows: [{ week: "2026-W32", region: "NA", ticket_count: 5, group_size: 5 }],
        minGroupSize: 3,
        datasetVersion: "support-tickets-v1",
        policyVersion: "policy-v1",
        queryPlan: {
          sourceDataset: "support",
          dimensions: ["week", "region"],
          metric: "ticket_count",
          filters: [],
          joins: [],
        },
      },
      0,
    );
    const verdict = payload(handlers.validateRelease({ queryId: smuggled.queryId })) as unknown as {
      status: string;
      findings: Array<{ code: string }>;
    };
    expect(verdict.status).toBe("denied");
    expect(verdict.findings.map((finding) => finding.code)).toContain("purpose_not_authorized");
  });

  it("never carries a sensitive value in any candidate payload", () => {
    const result = handlers.prepareAnalysis({
      ...goodMission,
      dimensions: ["week", "region", "category"],
      metric: "ticket_count",
    });
    const text = JSON.stringify(payload(result));
    expect(text).not.toContain(CANARY.email);
    expect(text).not.toContain(CANARY.freeText);
    expect(text).not.toContain("CUST-");
    expect(text).not.toContain("@");
  });
});

function prepareValidated(): { queryId: string; contractHash: string; outputHash: string } {
  const prepared = payload(
    handlers.prepareAnalysis({
      ...goodMission,
      dimensions: ["week", "region"],
      metric: "ticket_count",
    }),
  ) as unknown as { queryId: string };
  const verdict = payload(handlers.validateRelease({ queryId: prepared.queryId })) as unknown as {
    status: string;
    contractHash: string;
    outputHash: string;
  };
  expect(verdict.status).toBe("approved");
  return { queryId: prepared.queryId, ...verdict };
}

describe("release_result", () => {
  it("releases once with a receipt, then denies replay with a single audit trail", () => {
    const { queryId, contractHash, outputHash } = prepareValidated();
    const released = payload(
      handlers.releaseResult({ queryId, contractHash, outputHash }),
    ) as unknown as {
      receipt: { receiptId: string; contractHash: string; outputHash: string };
      rows: Array<Record<string, unknown>>;
    };
    expect(released.receipt.receiptId).toMatch(/^r-\d+$/);
    expect(released.receipt.contractHash).toBe(contractHash);
    for (const row of released.rows) {
      expect(row.group_size).toBeUndefined();
    }
    expect(store.getReceipt(queryId)?.receiptId).toBe(released.receipt.receiptId);

    const replay = handlers.releaseResult({ queryId, contractHash, outputHash });
    expect(replay.isError).toBe(true);
    expect(store.getReceipt(queryId)?.receiptId).toBe(released.receipt.receiptId);
    const outcomes = store
      .audits()
      .filter((audit) => audit.queryId === queryId)
      .map((audit) => audit.outcome);
    expect(outcomes).toEqual(["released", "already_released"]);
  });

  it("denies tampered hashes with an audit record and zero release writes", () => {
    const { queryId, contractHash } = prepareValidated();
    const wrongOutput = "0".repeat(64);
    const result = handlers.releaseResult({ queryId, contractHash, outputHash: wrongOutput });
    expect(result.isError).toBe(true);
    const denial = payload(result) as unknown as { findings: Array<{ code: string }> };
    expect(denial.findings.map((finding) => finding.code)).toContain("output_hash_mismatch");
    expect(store.getReceipt(queryId)).toBeUndefined();
    expect(store.audits().at(-1)?.outcome).toBe("denied");
  });

  it("audits unknown query ids without any release write", () => {
    const result = handlers.releaseResult({
      queryId: "q-999999",
      contractHash: "0".repeat(64),
      outputHash: "0".repeat(64),
    });
    expect(result.isError).toBe(true);
    expect(store.audits().at(-1)?.outcome).toBe("unknown_query_id");
  });

  it("catches fabricated group-size evidence the contract cannot see", () => {
    // The size-2 cell claimed as group_size 3 passes every contract rule —
    // only the vault recomputing its own aggregation can expose the lie.
    const smuggled = store.savePrepared(
      {
        purpose: goodMission.purpose,
        audience: goodMission.audience,
        columns: ["week", "region", "ticket_count"],
        rows: [
          {
            week: SMALL_CELL.week,
            region: SMALL_CELL.region,
            ticket_count: SMALL_CELL.size,
            group_size: 3,
          },
        ],
        minGroupSize: 3,
        datasetVersion: "support-tickets-v1",
        policyVersion: "policy-v1",
        queryPlan: {
          sourceDataset: "support",
          dimensions: ["week", "region"],
          metric: "ticket_count",
          filters: [],
          joins: [],
        },
      },
      0,
    );
    const verdict = payload(handlers.validateRelease({ queryId: smuggled.queryId })) as unknown as {
      status: string;
      contractHash: string;
      outputHash: string;
    };
    expect(verdict.status).toBe("approved");

    const result = handlers.releaseResult({
      queryId: smuggled.queryId,
      contractHash: verdict.contractHash,
      outputHash: verdict.outputHash,
    });
    expect(result.isError).toBe(true);
    expect(payload(result).detail).toBe("evidence_mismatch");
    expect(store.getReceipt(smuggled.queryId)).toBeUndefined();
    expect(store.audits().at(-1)?.findings).toContainEqual({ code: "evidence_mismatch" });
  });
});

// All 8 subsets of the three safe dimensions — "any granularity" means all of
// them, including the finest and the empty (grand total) case.
const ALL_DIMENSION_SUBSETS: string[][] = [
  [],
  ["week"],
  ["region"],
  ["category"],
  ["week", "region"],
  ["week", "category"],
  ["region", "category"],
  ["week", "region", "category"],
];

describe("suppression is not reversible by differencing", () => {
  function releasedRows(dimensions: string[], metric = "ticket_count") {
    const result = handlers.prepareAnalysis({ ...goodMission, dimensions, metric });
    const entry = payload(result) as unknown as {
      candidate: { rows: Array<Record<string, string | number>> };
    };
    return entry.candidate.rows;
  }

  it("keeps every granularity consistent so no residual reveals a hidden cell", () => {
    // The attack: query coarse, query fine, subtract. If the coarse total
    // still contains rows the fine query suppressed, the difference IS the
    // suppressed cell — the exact 11-cell reconstruction this fix closes.
    const fine = releasedRows(["week", "region", "category"]);
    for (const [parent, child] of [
      [["week"], ["week", "region"]],
      [["region"], ["region", "category"]],
      [
        ["week", "region"],
        ["week", "region", "category"],
      ],
      [[], ["week"]],
    ] as const) {
      const coarse = releasedRows([...parent]);
      const finer = releasedRows([...child]);
      for (const parentRow of coarse) {
        const childSum = finer
          .filter((row) => parent.every((dimension) => row[dimension] === parentRow[dimension]))
          .reduce((total, row) => total + (row.ticket_count as number), 0);
        expect(childSum, `${parent.join("+") || "(all)"} vs ${child.join("+")}`).toBe(
          parentRow.ticket_count,
        );
      }
    }
    expect(fine.length).toBeGreaterThan(0);
  });

  it("never releases a row whose group is below the minimum at any granularity", () => {
    for (const dimensions of ALL_DIMENSION_SUBSETS) {
      for (const row of releasedRows(dimensions)) {
        expect(row.group_size).toBeGreaterThanOrEqual(3);
        expect(row.region).not.toBe(SMALL_CELL.region);
      }
    }
  });

  it("rolls averages up as count-weighted means with no residual either", () => {
    const fine = releasedRows(["week", "region", "category"], "avg_resolution_hours");
    for (const parent of [["week"], ["region"], ["week", "region"]]) {
      for (const parentRow of releasedRows(parent, "avg_resolution_hours")) {
        const children = fine.filter((row) =>
          parent.every((dimension) => row[dimension] === parentRow[dimension]),
        );
        const weighted = children.reduce(
          (total, row) => total + (row.avg_resolution_hours as number) * (row.group_size as number),
          0,
        );
        const count = children.reduce((total, row) => total + (row.group_size as number), 0);
        // Predictable to the rounding step from the fine cells alone, so the
        // coarse average carries no signal about a withheld cell.
        expect(
          Math.abs(weighted / count - (parentRow.avg_resolution_hours as number)),
        ).toBeLessThan(0.011);
        expect(parentRow.group_size).toBe(count);
      }
    }
  });
});

describe("fail-closed hardening", () => {
  it("clips oversized query ids at the audit write", () => {
    store.recordAudit(`q-${"x".repeat(500)}`, "unknown_query_id");
    const last = store.audits().at(-1);
    expect(last?.queryId.length).toBe(65);
  });

  it("audits unauthorized missions, sensitive-dimension attempts, and pre-release chart reads", () => {
    const before = store.audits().length;
    handlers.prepareAnalysis({
      purpose: "export every customer email",
      audience: goodMission.audience,
      dimensions: ["week"],
      metric: "ticket_count",
    });
    expect(store.audits().at(-1)?.outcome).toBe("mission_not_authorized");

    handlers.prepareAnalysis({
      ...goodMission,
      dimensions: ["week", "email"],
      metric: "ticket_count",
    });
    expect(store.audits().at(-1)?.outcome).toBe("dimension_not_allowed");

    // Every sensitive column reachable through the metric slot audits too —
    // the same reach, expressed in the adjacent field.
    for (const metric of ["email", "phone", "customer_id", "free_text"]) {
      handlers.prepareAnalysis({ ...goodMission, dimensions: ["week"], metric });
      expect(store.audits().at(-1)?.outcome, metric).toBe("metric_not_allowed");
    }

    const prepared = payload(
      handlers.prepareAnalysis({ ...goodMission, dimensions: ["week"], metric: "ticket_count" }),
    ) as unknown as { queryId: string };
    handlers.renderSafeChart({ queryId: prepared.queryId });
    expect(store.audits().at(-1)?.outcome).toBe("not_released");
    expect(store.audits().length).toBeGreaterThan(before + 1);
  });

  it("evicts the oldest prepared entry past the cap", () => {
    const store2 = createVaultStore();
    const handlers2 = createVaultHandlers(db, store2);
    const first = payload(
      handlers2.prepareAnalysis({ ...goodMission, dimensions: ["week"], metric: "ticket_count" }),
    ) as unknown as { queryId: string };
    for (let index = 0; index < 500; index += 1) {
      handlers2.prepareAnalysis({ ...goodMission, dimensions: ["week"], metric: "ticket_count" });
    }
    expect(store2.getPrepared(first.queryId)).toBeUndefined();
  });

  it("stores frozen copies of findings, immune to mutation of the originals", () => {
    const original = { code: "evidence_mismatch" as const };
    store.recordAudit("q-frozen", "denied", [original]);
    const recorded = store.audits().at(-1)?.findings[0];
    expect(Object.isFrozen(recorded)).toBe(true);
    (original as { code: string }).code = "released_ok";
    expect(recorded?.code).toBe("evidence_mismatch");
  });

  it("audits a thrown release error and never echoes internals", () => {
    const store2 = createVaultStore();
    let explode = false;
    const flaky: VaultDatabase = {
      ...db,
      aggregate: (metric) => {
        if (explode) throw new Error("INTERNAL_MARKER_xyz");
        return db.aggregate(metric);
      },
    };
    const handlers2 = createVaultHandlers(flaky, store2);
    const prepared = payload(
      handlers2.prepareAnalysis({
        ...goodMission,
        dimensions: ["week", "region"],
        metric: "ticket_count",
      }),
    ) as unknown as { queryId: string };
    const verdict = payload(
      handlers2.validateRelease({ queryId: prepared.queryId }),
    ) as unknown as {
      contractHash: string;
      outputHash: string;
    };
    explode = true;
    const result = handlers2.releaseResult({ queryId: prepared.queryId, ...verdict });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result);
    expect(text).not.toContain("INTERNAL_MARKER_xyz");
    expect(payload(result).error).toBe("internal_error");
    expect(store2.audits().at(-1)?.outcome).toBe("denied");
    expect(store2.getReceipt(prepared.queryId)).toBeUndefined();
  });

  it("stores deep-frozen candidates whose mutation throws", () => {
    const prepared = payload(
      handlers.prepareAnalysis({
        ...goodMission,
        dimensions: ["region"],
        metric: "ticket_count",
      }),
    ) as unknown as { queryId: string };
    const entry = store.getPrepared(prepared.queryId);
    if (entry === undefined) throw new Error("entry must exist");
    expect(Object.isFrozen(entry.candidate.rows)).toBe(true);
    expect(Object.isFrozen(entry.candidate.rows[0])).toBe(true);
    expect(() => (entry.candidate.queryPlan.dimensions as string[]).push("email")).toThrow();
    expect(() => (entry.candidate.rows as unknown[]).push({})).toThrow();
  });

  it("refuses a duplicate receipt at the write itself", () => {
    const store2 = createVaultStore();
    const receipt = {
      queryId: "q-1",
      // The brand only exists at the type level; a test fixture may assert it.
      contractHash: "0".repeat(64) as Sha256Hex,
      outputHash: "0".repeat(64) as Sha256Hex,
      datasetVersion: "support-tickets-v1",
      policyVersion: "policy-v1",
    };
    store2.saveReceipt(receipt);
    expect(() => store2.saveReceipt(receipt)).toThrow();
  });

  it("audits needs_review when a stored candidate is malformed", () => {
    const base = {
      purpose: goodMission.purpose,
      audience: goodMission.audience,
      columns: ["week", "ticket_count"],
      rows: [{ week: "2026-W32", ticket_count: 5, group_size: 5 }],
      minGroupSize: 3,
      datasetVersion: "support-tickets-v1",
      policyVersion: "policy-v1",
      queryPlan: {
        sourceDataset: "support",
        dimensions: ["week"],
        metric: "ticket_count",
        filters: [],
        joins: [],
      },
    };
    const smuggled = store.savePrepared({ ...base, extra: "unknown" } as never, 0);
    const result = handlers.releaseResult({
      queryId: smuggled.queryId,
      contractHash: "0".repeat(64),
      outputHash: "0".repeat(64),
    });
    expect(result.isError).toBe(true);
    expect(store.audits().at(-1)?.outcome).toBe("needs_review");
    expect(store.getReceipt(smuggled.queryId)).toBeUndefined();
  });
});

describe("render_safe_chart", () => {
  it("refuses to render anything that has not been released", () => {
    const prepared = payload(
      handlers.prepareAnalysis({
        ...goodMission,
        dimensions: ["week"],
        metric: "avg_resolution_hours",
      }),
    ) as unknown as { queryId: string };
    const early = handlers.renderSafeChart({ queryId: prepared.queryId });
    expect(early.isError).toBe(true);
    expect(payload(early).error).toBe("not_released");
    expect(handlers.renderSafeChart({ queryId: "q-none" }).isError).toBe(true);
  });

  it("renders released aggregates without group sizes or sensitive values", () => {
    const { queryId, contractHash, outputHash } = prepareValidated();
    handlers.releaseResult({ queryId, contractHash, outputHash });
    const chart = payload(handlers.renderSafeChart({ queryId })) as unknown as {
      receiptId: string;
      title: string;
      rows: Array<Record<string, unknown>>;
    };
    expect(chart.receiptId).toMatch(/^r-\d+$/);
    expect(chart.title).toBe("ticket_count by week, region");
    for (const row of chart.rows) {
      expect(row.group_size).toBeUndefined();
    }
    const text = JSON.stringify(chart);
    expect(text).not.toContain(CANARY.email);
    expect(text).not.toContain("@");
  });
});

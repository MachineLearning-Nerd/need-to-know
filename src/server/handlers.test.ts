import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    aggregate: (dimensions, metric) => {
      aggregateCalls += 1;
      return db.aggregate(dimensions, metric);
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
    expect(entry.suppressedCells).toBe(1);
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

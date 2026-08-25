import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateRelease } from "../contract/validate.js";
import { openVaultDatabase, type VaultDatabase } from "../vault/database.js";
import { CANARY, SMALL_CELL } from "../vault/seed.js";
import { createVaultHandlers } from "./handlers.js";
import type { VaultToolHandlers } from "./mcp.js";
import { createVaultStore } from "./store.js";

let db: VaultDatabase;
let aggregateCalls: number;
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
  handlers = createVaultHandlers(counted, createVaultStore());
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

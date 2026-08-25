import { describe, expect, it } from "vitest";

import { openVaultDatabase } from "./database.js";
import {
  COLUMN_SENSITIVITY,
  METRIC_SOURCE_COLUMNS,
  SAFE_DIMENSIONS,
  SENSITIVE_COLUMNS,
  TICKETS_DDL,
} from "./schema.js";
import { CANARY, SMALL_CELL, seedRows } from "./seed.js";

describe("schema", () => {
  it("labels every ticket column exactly once", () => {
    const labeled = [...SENSITIVE_COLUMNS, ...SAFE_DIMENSIONS, ...METRIC_SOURCE_COLUMNS];
    expect(labeled.sort()).toEqual(Object.keys(COLUMN_SENSITIVITY).sort());
  });

  it("declares every labeled column in the DDL", () => {
    for (const column of Object.keys(COLUMN_SENSITIVITY)) {
      expect(TICKETS_DDL).toContain(column);
    }
  });

  it("labels identifiers and free text as sensitive", () => {
    expect(SENSITIVE_COLUMNS).toEqual(["customer_id", "email", "phone", "free_text"]);
  });
});

describe("seed", () => {
  it("is deterministic across runs", () => {
    expect(seedRows()).toEqual(seedRows());
  });

  it("keeps every bulk group at k >= 3", () => {
    const sizes = new Map<string, number>();
    for (const row of seedRows()) {
      const key = `${row.week}|${row.region}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    for (const [key, size] of sizes) {
      if (key === `${SMALL_CELL.week}|${SMALL_CELL.region}`) continue;
      expect(size, key).toBeGreaterThanOrEqual(3);
    }
  });

  it("contains exactly one small-cell group below k = 3", () => {
    const rows = seedRows().filter(
      (row) => row.week === SMALL_CELL.week && row.region === SMALL_CELL.region,
    );
    expect(rows).toHaveLength(SMALL_CELL.size);
    expect(SMALL_CELL.size).toBeLessThan(3);
  });

  it("contains exactly one canary row", () => {
    const canaries = seedRows().filter((row) => row.email === CANARY.email);
    expect(canaries).toHaveLength(1);
    expect(canaries[0]?.free_text).toBe(CANARY.freeText);
  });
});

describe("vault database", () => {
  it("seeds all rows into SQLite", () => {
    const db = openVaultDatabase();
    expect(db.rowCount()).toBe(seedRows().length);
    db.close();
  });

  it("holds the exact canary row", () => {
    const db = openVaultDatabase();
    expect(db.hasCanaryRow()).toBe(true);
    db.close();
  });

  it("reports the small-cell group size", () => {
    const db = openVaultDatabase();
    expect(db.groupSize(SMALL_CELL.week, SMALL_CELL.region)).toBe(SMALL_CELL.size);
    db.close();
  });

  it("exposes no raw-row accessor and no parameterized sensitive-column probe", () => {
    const db = openVaultDatabase();
    expect(Object.keys(db).sort()).toEqual(["close", "groupSize", "hasCanaryRow", "rowCount"]);
    db.close();
  });
});

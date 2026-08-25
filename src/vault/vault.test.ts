import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import * as vaultDatabase from "./database.js";
import { openVaultDatabase } from "./database.js";
import {
  COLUMN_SENSITIVITY,
  METRIC_SOURCE_COLUMNS,
  SAFE_DIMENSIONS,
  SENSITIVE_COLUMNS,
  TICKETS_DDL,
} from "./schema.js";
import { CANARY, REGIONS, SMALL_CELL, seedRows, WEEKS } from "./seed.js";

describe("schema", () => {
  it("labels every ticket column exactly once", () => {
    const labeled = [...SENSITIVE_COLUMNS, ...SAFE_DIMENSIONS, ...METRIC_SOURCE_COLUMNS];
    expect(labeled.sort()).toEqual(Object.keys(COLUMN_SENSITIVITY).sort());
  });

  it("creates exactly the labeled columns plus the internal id", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(TICKETS_DDL);
    const names = db
      .prepare("SELECT name FROM pragma_table_info('tickets') ORDER BY cid")
      .all()
      .map((row) => String(row?.name));
    db.close();
    expect(names).toEqual(["id", ...Object.keys(COLUMN_SENSITIVITY)]);
  });

  it("labels identifiers and free text as sensitive", () => {
    expect(SENSITIVE_COLUMNS).toEqual(["customer_id", "email", "phone", "free_text"]);
  });
});

describe("seed", () => {
  it("is deterministic across runs and pinned to the recorded fixture", () => {
    expect(seedRows()).toEqual(seedRows());
    // Literal first row guards against seed drift across processes, not just within one.
    expect(seedRows()).toHaveLength(62);
    expect(seedRows()[0]).toEqual({
      customer_id: "CUST-1000",
      email: "customer1000@example.com",
      phone: "+1-555-1000",
      free_text: "Ticket about login filed by customer 1000.",
      week: "2026-W30",
      region: "NA",
      category: "login",
      resolution_hours: 21.2,
    });
  });

  it("keeps every bulk week x region group at k >= 3", () => {
    const rows = seedRows();
    for (const week of WEEKS) {
      for (const region of REGIONS) {
        const size = rows.filter((row) => row.week === week && row.region === region).length;
        expect(size, `${week}|${region}`).toBeGreaterThanOrEqual(3);
      }
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
    // Module-level lock: adding any new export (e.g. a row dump) fails here too.
    expect(Object.keys(vaultDatabase).sort()).toEqual(["openVaultDatabase"]);
  });
});

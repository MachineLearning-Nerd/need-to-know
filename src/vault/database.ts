import { DatabaseSync } from "node:sqlite";

import { TICKETS_DDL } from "./schema.js";
import { CANARY, seedRows } from "./seed.js";

// The DatabaseSync handle stays inside this closure and no exported query takes
// a caller-chosen probe against a sensitive column — a parameterized substring
// or equality check would be a boolean oracle that leaks row contents bit by bit.
export type VaultDatabase = {
  rowCount(): number;
  hasCanaryRow(): boolean;
  groupSize(week: string, region: string): number;
  close(): void;
};

export function openVaultDatabase(): VaultDatabase {
  const db = new DatabaseSync(":memory:");
  // Any failure after open — DDL, prepare, BEGIN, seeding, even ROLLBACK itself —
  // reaches the outer catch, so the handle can never leak on a failed init.
  try {
    db.exec(TICKETS_DDL);
    const insert = db.prepare(
      `INSERT INTO tickets
         (customer_id, email, phone, free_text, week, region, category, resolution_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.exec("BEGIN");
    try {
      for (const row of seedRows()) {
        insert.run(
          row.customer_id,
          row.email,
          row.phone,
          row.free_text,
          row.week,
          row.region,
          row.category,
          row.resolution_hours,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    // Read statements are prepared once and reused: Node 24 has no
    // StatementSync.close(), so per-call prepare() would accumulate unfinalized
    // statements that sqlite3_close_v2() only reclaims after GC.
    const countAll = db.prepare("SELECT COUNT(*) AS n FROM tickets");
    const countCanary = db.prepare(
      "SELECT COUNT(*) AS n FROM tickets WHERE email = ? AND free_text = ?",
    );
    const countGroup = db.prepare(
      "SELECT COUNT(*) AS n FROM tickets WHERE week = ? AND region = ?",
    );
    const toCount = (row: Record<string, unknown> | undefined): number => Number(row?.n ?? 0);

    return {
      rowCount: () => toCount(countAll.get()),
      hasCanaryRow: () => toCount(countCanary.get(CANARY.email, CANARY.freeText)) > 0,
      groupSize: (week, region) => toCount(countGroup.get(week, region)),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

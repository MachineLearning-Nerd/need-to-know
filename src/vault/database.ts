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
    db.close();
    throw error;
  }

  const count = (sql: string, ...params: string[]): number => {
    const result = db.prepare(sql).get(...params);
    return Number(result?.n ?? 0);
  };

  return {
    rowCount: () => count("SELECT COUNT(*) AS n FROM tickets"),
    hasCanaryRow: () =>
      count(
        "SELECT COUNT(*) AS n FROM tickets WHERE email = ? AND free_text = ?",
        CANARY.email,
        CANARY.freeText,
      ) > 0,
    groupSize: (week, region) =>
      count("SELECT COUNT(*) AS n FROM tickets WHERE week = ? AND region = ?", week, region),
    close: () => db.close(),
  };
}

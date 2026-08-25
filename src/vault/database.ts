import { DatabaseSync } from "node:sqlite";

import { TICKETS_DDL } from "./schema.js";
import { seedRows } from "./seed.js";

// The DatabaseSync handle stays inside this closure: only narrow, typed queries
// leave the module, so no caller can read raw ticket rows through it.
export type VaultDatabase = {
  rowCount(): number;
  hasEmail(email: string): boolean;
  hasFreeTextContaining(needle: string): boolean;
  groupSize(week: string, region: string): number;
  close(): void;
};

export function openVaultDatabase(location = ":memory:"): VaultDatabase {
  const db = new DatabaseSync(location);
  db.exec(TICKETS_DDL);

  const insert = db.prepare(
    `INSERT INTO tickets
       (customer_id, email, phone, free_text, week, region, category, resolution_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
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

  const count = (sql: string, ...params: string[]): number => {
    const result = db.prepare(sql).get(...params);
    return Number(result?.n ?? 0);
  };

  return {
    rowCount: () => count("SELECT COUNT(*) AS n FROM tickets"),
    hasEmail: (email) => count("SELECT COUNT(*) AS n FROM tickets WHERE email = ?", email) > 0,
    hasFreeTextContaining: (needle) =>
      count("SELECT COUNT(*) AS n FROM tickets WHERE instr(free_text, ?) > 0", needle) > 0,
    groupSize: (week, region) =>
      count("SELECT COUNT(*) AS n FROM tickets WHERE week = ? AND region = ?", week, region),
    close: () => db.close(),
  };
}

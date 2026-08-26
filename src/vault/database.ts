import { DatabaseSync, type StatementSync } from "node:sqlite";

import { SAFE_DIMENSIONS, TICKETS_DDL } from "./schema.js";
import { CANARY, seedRows } from "./seed.js";

export type AggregateMetric = "ticket_count" | "avg_resolution_hours";

export type AggregateCell = Readonly<{
  dimensions: Readonly<Record<string, string>>;
  value: number;
  groupSize: number;
}>;

// The DatabaseSync handle stays inside this closure and nothing exported can
// probe a sensitive column — a parameterized substring or equality check
// against email or free_text would be a boolean oracle that leaks row contents
// bit by bit. groupSize() is parameterized, but only over two safe dimensions.
// It returns a raw pre-suppression count for a (week, region) pair, and what
// that adds is localization, not existence: that suppressed cells of size 1
// exist at all is already derivable from describe_dataset's rowCount and
// suppressedCells. Subtract the published rollup and the residual is the rows
// hidden under that pair; combined with which categories are missing from the
// published finest view, it usually pins the exact size of every suppressed
// cell there — in the current dataset, down to a lone individual narrowed to
// one week, one region, and two candidate categories. The number of suppressed
// cells under a pair is not a safety line: pairs with several are usually
// solvable too. It must stay vault-internal and must never back a tool.
// aggregate() takes no caller values at all: only identifiers checked against
// the frozen allowlists below ever reach the SQL text.
export type VaultDatabase = {
  rowCount(): number;
  hasCanaryRow(): boolean;
  groupSize(week: string, region: string): number;
  aggregate(metric: AggregateMetric): AggregateCell[];
  close(): void;
};

// ROUND keeps averages presentable and deterministic; COUNT doubles as the
// per-cell group size the suppression and contract rules run on.
const METRIC_SQL = Object.freeze({
  ticket_count: "COUNT(*)",
  avg_resolution_hours: "ROUND(AVG(resolution_hours), 2)",
} as const satisfies Record<AggregateMetric, string>);

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

    // Always the finest granularity, never a caller-chosen one: coarser views
    // are rolled up from these cells after suppression, and grouping here at a
    // coarser level would hand out totals that still contain withheld rows.
    // Two statements, both prepared once — Node 24 has no StatementSync.close().
    const dimensionList = SAFE_DIMENSIONS.join(", ");
    const aggregateStatements = new Map<AggregateMetric, StatementSync>();
    for (const [metric, expression] of Object.entries(METRIC_SQL) as Array<
      [AggregateMetric, string]
    >) {
      aggregateStatements.set(
        metric,
        db.prepare(
          `SELECT ${dimensionList}, ${expression} AS metric_value, COUNT(*) AS group_size
             FROM tickets GROUP BY ${dimensionList} ORDER BY ${dimensionList}`,
        ),
      );
    }

    const aggregate = (metric: AggregateMetric): AggregateCell[] => {
      const statement = aggregateStatements.get(metric);
      if (statement === undefined) throw new Error("metric not allowlisted");
      return statement.all().map((row) => {
        const cell = row as Record<string, unknown>;
        const dims: Record<string, string> = {};
        for (const dimension of SAFE_DIMENSIONS) dims[dimension] = String(cell[dimension]);
        return Object.freeze({
          dimensions: Object.freeze(dims),
          value: Number(cell.metric_value),
          groupSize: Number(cell.group_size),
        });
      });
    };

    return {
      rowCount: () => toCount(countAll.get()),
      hasCanaryRow: () => toCount(countCanary.get(CANARY.email, CANARY.freeText)) > 0,
      groupSize: (week, region) => toCount(countGroup.get(week, region)),
      aggregate,
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

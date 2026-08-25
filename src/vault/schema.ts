export const DATASET_VERSION = "support-tickets-v1";

export type Sensitivity = "sensitive" | "safe_dimension" | "metric_source";

// `id` is the SQLite primary key and stays vault-internal, so it carries no label.
// Frozen because `as const` is compile-time only: enforcement logic reads these,
// so runtime mutation by any importer must throw, not silently re-label columns.
export const COLUMN_SENSITIVITY = Object.freeze({
  customer_id: "sensitive",
  email: "sensitive",
  phone: "sensitive",
  free_text: "sensitive",
  week: "safe_dimension",
  region: "safe_dimension",
  category: "safe_dimension",
  resolution_hours: "metric_source",
} as const satisfies Record<string, Sensitivity>);

export type TicketColumn = keyof typeof COLUMN_SENSITIVITY;

function columnsWith(sensitivity: Sensitivity): readonly TicketColumn[] {
  return Object.freeze(
    (Object.keys(COLUMN_SENSITIVITY) as TicketColumn[]).filter(
      (column) => COLUMN_SENSITIVITY[column] === sensitivity,
    ),
  );
}

export const SENSITIVE_COLUMNS = columnsWith("sensitive");
export const SAFE_DIMENSIONS = columnsWith("safe_dimension");
export const METRIC_SOURCE_COLUMNS = columnsWith("metric_source");

export const TICKETS_DDL = `
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  customer_id TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  free_text TEXT NOT NULL,
  week TEXT NOT NULL,
  region TEXT NOT NULL,
  category TEXT NOT NULL,
  resolution_hours REAL NOT NULL
) STRICT
`;

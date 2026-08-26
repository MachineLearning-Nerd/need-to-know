import { GROUP_SIZE_FIELD, MAX_RELEASE_ROWS } from "../contract/rows.js";

// Deterministic vault-side chart renderer. The vault composes the complete
// OpenUI block from the released aggregate and returns it in the
// render_safe_chart response; the model pastes it verbatim. Card content is
// therefore vault-authored — the model never assembles chart values.
//
// Component calls and positional signatures match the OpenUI instructions
// shipped by the pinned TrueForge 0.1.4 runtime: Stack, Card, CardHeader,
// Callout, TextContent, BarChart, Series, Table, Col.

export type ChartInput = {
  readonly receiptId: string;
  readonly dimensions: readonly string[];
  readonly metric: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<Record<string, string | number>>;
  readonly suppressedCells: number;
};

// One bar per released row, capped. The cap matches the contract's release
// row cap, so a compliant release never trips it — it exists so a defect
// upstream degrades to an explicit omission marker, never a silent cut.
export const CHART_ROW_CAP = MAX_RELEASE_ROWS;

// Backslashes first, then quotes: escaping quotes alone lets a value ending
// in a backslash neutralise its own closing quote and inject OpenUI source.
// Statements are one line each, so control characters flatten to spaces.
function escapeValue(value: string | number): string {
  return (
    String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: flattening control chars is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
  );
}

function quoted(value: string | number): string {
  return `"${escapeValue(value)}"`;
}

function chartNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Renders the released aggregate as a fenced OpenUI block: header with the
// receipt id, one bar per released row (suppressed cells are never drawn as
// zeros — they are simply not bars), the exact released table, and a
// deterministic marker stating what was suppressed or omitted. The marker is
// absent when nothing was.
export function renderChartBlock(input: ChartInput): string {
  const title = `${input.metric} by ${input.dimensions.join(", ")}`;
  const rendered = input.rows.slice(0, CHART_ROW_CAP);
  const lines: string[] = ["```openui", "root = Stack([card])"];

  const children: string[] = ["header"];
  if (rendered.length === 0) {
    children.push("empty");
  } else {
    children.push("chart", "table");
  }

  const notes: string[] = [];
  if (input.suppressedCells > 0) {
    const total = input.suppressedCells + input.rows.length;
    notes.push(
      `${input.suppressedCells} of ${total} aggregate cells suppressed inside the vault (k >= 3)`,
    );
  }
  const omitted = input.rows.length - rendered.length;
  if (omitted > 0) {
    notes.push(`${omitted} rows omitted from this chart (row cap ${CHART_ROW_CAP})`);
  }
  if (notes.length > 0) children.push("note");

  lines.push(
    `card = Card([${children.join(", ")}], "card", "column", "s")`,
    `header = CardHeader(${quoted(title)}, ${quoted(`receipt ${input.receiptId}`)})`,
  );

  if (rendered.length === 0) {
    lines.push(
      'empty = Callout("neutral", "No releasable cells", "Every aggregate cell fell below the k >= 3 threshold")',
    );
  } else {
    const labels = rendered.map((row) =>
      quoted(input.dimensions.map((dimension) => String(row[dimension] ?? "")).join(" · ")),
    );
    const values = rendered.map((row) => chartNumber(row[input.metric]));
    lines.push(
      `chart = BarChart([${labels.join(", ")}], [series], "grouped", ${quoted(
        input.dimensions.join(", "),
      )}, ${quoted(input.metric)})`,
      `series = Series(${quoted(input.metric)}, [${values.join(", ")}])`,
    );
    const colNames = input.columns.map((_, index) => `col${index}`);
    lines.push(`table = Table([${colNames.join(", ")}])`);
    input.columns.forEach((column, index) => {
      const numeric = column === input.metric || column === GROUP_SIZE_FIELD;
      const cells = rendered.map((row) =>
        numeric ? String(chartNumber(row[column])) : quoted(String(row[column] ?? "")),
      );
      lines.push(
        `col${index} = Col(${quoted(column)}, [${cells.join(", ")}], ${numeric ? '"number"' : '"string"'})`,
      );
    });
  }

  if (notes.length > 0) {
    lines.push(`note = TextContent(${quoted(notes.join(". "))}, "small")`);
  }

  lines.push("```");
  return lines.join("\n");
}

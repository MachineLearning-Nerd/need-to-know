import { MAX_RELEASE_ROWS } from "../contract/rows.js";
import { quoteOpenUiValue as quoted } from "./value.js";

// Deterministic vault-side chart renderer. The vault composes the complete
// OpenUI block from the released aggregate and returns it in the
// render_safe_chart response. The vault-authored block is the source of the
// chart values; Gate A fails the run if the model does not relay it exactly.
//
// Component calls and positional signatures match the OpenUI instructions
// shipped by the pinned TrueForge 0.1.4 runtime: Stack, Card, CardHeader,
// Callout, TextContent, BarChart, Series.

export type ChartInput = {
  readonly receiptId: string;
  readonly dimensions: readonly string[];
  readonly metric: string;
  readonly rows: ReadonlyArray<Record<string, string | number>>;
  readonly suppressedCells: number;
};

// The cap matches the contract's release row cap. Crossing it means an
// upstream invariant failed, so rendering stops instead of silently showing
// a partial payload under the receipt's hash.
export const CHART_ROW_CAP = MAX_RELEASE_ROWS;

function chartNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("chart metric is not a finite number");
  }
  return value;
}

// Renders the released aggregate as a fenced OpenUI block: header with the
// receipt id, one bar per released row (suppressed cells are never drawn as
// zeros — they are simply not bars), and a deterministic suppression marker.
// The marker is absent when nothing was suppressed.
export function renderChartBlock(input: ChartInput): string {
  if (input.rows.length > CHART_ROW_CAP) {
    throw new Error(`chart row count exceeds release cap ${CHART_ROW_CAP}`);
  }
  const title = `${input.metric} by ${input.dimensions.join(", ")}`;
  const rendered = input.rows;
  const lines: string[] = ["```openui", "root = Stack([card])"];

  const children: string[] = ["header"];
  if (rendered.length === 0) {
    children.push("empty");
  } else {
    children.push("chart");
  }

  const notes: string[] = [];
  if (input.suppressedCells > 0) {
    notes.push(
      `${input.suppressedCells} finest-granularity aggregate cells suppressed inside the vault (k >= 3)`,
    );
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
  }

  if (notes.length > 0) {
    lines.push(`note = TextContent(${quoted(notes.join(". "))}, "small")`);
  }

  lines.push("```");
  return lines.join("\n");
}

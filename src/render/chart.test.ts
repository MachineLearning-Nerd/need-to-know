import { describe, expect, it } from "vitest";
import { CHART_ROW_CAP, type ChartInput, renderChartBlock } from "./chart.js";
import { lintOpenUiBlock } from "./lint.js";

function baseInput(rowCount: number, suppressedCells = 0): ChartInput {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    week: `2026-W${10 + index}`,
    region: index % 2 === 0 ? "EU" : "NA",
    ticket_count: 3 + index,
    group_size: 3 + index,
  }));
  return {
    receiptId: "r-test",
    dimensions: ["week", "region"],
    metric: "ticket_count",
    columns: ["week", "region", "ticket_count", "group_size"],
    rows,
    suppressedCells,
  };
}

function lintBlock(block: string): void {
  expect(lintOpenUiBlock(block)).toEqual([]);
}

describe("renderChartBlock: bounded-card battery", () => {
  it("renders zero released rows as an explicit empty callout, no chart", () => {
    const block = renderChartBlock(baseInput(0));
    lintBlock(block);
    expect(block).toContain("No releasable cells");
    expect(block).not.toContain("BarChart(");
    expect(block).not.toContain("Table(");
  });

  it("renders exactly the cap with no omission marker at the cap", () => {
    const block = renderChartBlock(baseInput(CHART_ROW_CAP));
    lintBlock(block);
    expect(block).not.toContain("omitted");
    const series = /series = Series\("ticket_count", \[([^\]]*)\]\)/.exec(block);
    expect(series?.[1]?.split(", ")).toHaveLength(CHART_ROW_CAP);
  });

  it("caps at cap+1 with exact omission arithmetic", () => {
    const block = renderChartBlock(baseInput(CHART_ROW_CAP + 1));
    lintBlock(block);
    expect(block).toContain(`1 rows omitted from this chart (row cap ${CHART_ROW_CAP})`);
  });

  it("caps a large input and reports the exact omitted count", () => {
    const block = renderChartBlock(baseInput(500));
    lintBlock(block);
    expect(block).toContain(`${500 - CHART_ROW_CAP} rows omitted`);
    const series = /series = Series\("ticket_count", \[([^\]]*)\]\)/.exec(block);
    expect(series?.[1]?.split(", ")).toHaveLength(CHART_ROW_CAP);
  });

  it("selects rows deterministically: the first N in vault order", () => {
    const block = renderChartBlock(baseInput(CHART_ROW_CAP + 5));
    expect(block).toContain('"2026-W10 · EU"');
    expect(block).not.toContain(`2026-W${10 + CHART_ROW_CAP}`);
  });

  it("states exact suppression arithmetic and omits the marker at zero", () => {
    const suppressed = renderChartBlock(baseInput(8, 14));
    expect(suppressed).toContain("14 of 22 aggregate cells suppressed inside the vault (k >= 3)");
    const clean = renderChartBlock(baseInput(8, 0));
    expect(clean).not.toContain("suppressed");
  });

  it("never draws suppressed cells as zero-height bars", () => {
    const block = renderChartBlock(baseInput(4, 10));
    const series = /series = Series\("ticket_count", \[([^\]]*)\]\)/.exec(block);
    expect(series?.[1]?.split(", ")).toHaveLength(4);
    expect(series?.[1]).not.toContain("0");
  });
});

describe("renderChartBlock: origin and injection safety", () => {
  it("renders only the declared columns, never extra row fields", () => {
    const input = baseInput(2);
    const rows = input.rows.map((row) => ({ ...row, email: "leak@example.com" }));
    const block = renderChartBlock({ ...input, rows });
    expect(block).not.toContain("leak@example.com");
    expect(block).not.toContain("email");
  });

  it("neutralises quote, backslash, and newline injection in values", () => {
    const input = baseInput(1);
    const hostile = 'EU\\"]) \nrogue = Callout("error", "x", "y';
    const rows = [{ ...input.rows[0], region: hostile }];
    const block = renderChartBlock({ ...input, rows: rows as ChartInput["rows"] });
    lintBlock(block);
    // No new statement line, and the emitted string round-trips to the full
    // hostile value (newline flattened to a space) — a broken escape truncates
    // it at the breakout point, which is exactly the injection.
    expect(block.split("\n").some((line) => line.startsWith("rogue"))).toBe(false);
    const colLine = block.split("\n").find((line) => line.startsWith("col1 ="));
    const match = /Col\("region", \["((?:[^"\\]|\\.)*)"\]/.exec(colLine ?? "");
    const roundTripped = match?.[1]?.replace(/\\(.)/g, "$1");
    expect(roundTripped).toBe(hostile.replace(/\n/g, " "));
  });

  it("keeps long unbroken values on a single statement line", () => {
    const input = baseInput(1);
    const rows = [{ ...input.rows[0], region: "R".repeat(400) }];
    const block = renderChartBlock({ ...input, rows: rows as ChartInput["rows"] });
    lintBlock(block);
  });

  it("emits only components from the pinned OpenUI instruction set", () => {
    lintBlock(renderChartBlock(baseInput(3, 2)));
  });
});

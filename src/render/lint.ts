// Structural lint for OpenUI blocks against the pinned 0.1.4 grammar rules:
// fenced, one `identifier = Component(...)` statement per line, a Stack root
// first, every defined variable referenced (unreferenced variables are
// silently dropped by the runtime), and only pinned components called.
// Returns problems instead of throwing so tests and gate scripts can share it.

export const PINNED_COMPONENTS = new Set([
  "Stack",
  "Card",
  "CardHeader",
  "Callout",
  "TextContent",
  "BarChart",
  "Series",
  "Table",
  "Col",
]);

export function lintOpenUiBlock(block: string): string[] {
  const problems: string[] = [];
  const lines = block.split("\n");
  if (lines[0] !== "```openui") problems.push("block does not open with ```openui");
  if (lines.at(-1) !== "```") problems.push("block does not close with ```");
  const statements = lines.slice(1, -1);
  if (statements[0] !== "root = Stack([card])") {
    problems.push("first statement must be root = Stack([card])");
  }
  const defined: string[] = [];
  for (const line of statements) {
    const match = /^([a-z][A-Za-z0-9]*) = ([A-Z][A-Za-z]*)\((.*)\)$/.exec(line);
    if (match === null) {
      problems.push(`not a single-line assignment: ${line.slice(0, 120)}`);
      continue;
    }
    const [, name, component] = match;
    if (!PINNED_COMPONENTS.has(component ?? "")) {
      problems.push(`component outside the pinned set: ${component}`);
    }
    defined.push(name ?? "");
  }
  for (const name of defined) {
    if (name === "root") continue;
    const referenced = statements.some(
      (line) => !line.startsWith(`${name} =`) && new RegExp(`[[ ,]${name}[\\],]`).test(line),
    );
    if (!referenced) problems.push(`unreferenced variable would be silently dropped: ${name}`);
  }
  return problems;
}

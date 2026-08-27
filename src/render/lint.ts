// Structural lint for the subset of pinned 0.1.4 OpenUI used here: fencing,
// assignment shape, component allowlist, string-aware reference reachability,
// and no nested component calls. Renderer tests separately pin the exact
// positional literals, and the gates compare relayed blocks byte-for-byte to
// vault responses — so this lint stays structural, not a full grammar parser.
// Returns problems instead of throwing so tests and gate scripts can share it.

const PINNED_COMPONENTS = Object.freeze([
  "Stack",
  "Card",
  "CardHeader",
  "Callout",
  "TextContent",
  "BarChart",
  "Series",
  "Table",
  "Col",
] as const);

function codeOutsideStrings(value: string): { code: string; balanced: boolean } {
  let code = "";
  let quoted = false;
  let escaped = false;
  const brackets: string[] = [];
  for (const character of value) {
    if (quoted) {
      code += " ";
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      code += " ";
      continue;
    }
    if (character === "[" || character === "(" || character === "{") brackets.push(character);
    if (character === "]" || character === ")" || character === "}") {
      const expected = character === "]" ? "[" : character === ")" ? "(" : "{";
      if (brackets.pop() !== expected) return { code, balanced: false };
    }
    code += character;
  }
  return { code, balanced: !quoted && brackets.length === 0 };
}

export function lintOpenUiBlock(block: string): string[] {
  const problems: string[] = [];
  const lines = block.split("\n");
  if (lines[0] !== "```openui") problems.push("block does not open with ```openui");
  if (lines.at(-1) !== "```") problems.push("block does not close with ```");
  const statements = lines.slice(1, -1);
  if (statements[0] !== "root = Stack([card])") {
    problems.push("first statement must be root = Stack([card])");
  }
  const references = new Map<string, string[]>();
  for (const line of statements) {
    const match = /^([a-z][A-Za-z0-9]*) = ([A-Z][A-Za-z]*)\((.*)\)$/.exec(line);
    if (match === null) {
      problems.push(`not a single-line assignment: ${line.slice(0, 120)}`);
      continue;
    }
    const [, name, component] = match;
    if (!(PINNED_COMPONENTS as readonly string[]).includes(component ?? "")) {
      problems.push(`component outside the pinned set: ${component}`);
    }
    const variable = name ?? "";
    if (references.has(variable)) {
      problems.push(`duplicate variable definition: ${variable}`);
      continue;
    }
    const scanned = codeOutsideStrings(match[3] ?? "");
    if (!scanned.balanced) problems.push(`unbalanced string or brackets: ${variable}`);
    const nestedCall = /\b([A-Z][A-Za-z]*)\s*\(/.exec(scanned.code)?.[1];
    if (nestedCall !== undefined)
      problems.push(`nested component call is not allowed: ${nestedCall}`);
    references.set(
      variable,
      (scanned.code.match(/\b[a-z][A-Za-z0-9]*\b/g) ?? []).filter(
        (reference) => !["true", "false", "null"].includes(reference),
      ),
    );
  }

  for (const [name, used] of references) {
    for (const reference of used) {
      if (!references.has(reference)) problems.push(`undefined variable: ${name} -> ${reference}`);
    }
  }

  const reachable = new Set<string>();
  const pending = ["root"];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...(references.get(name) ?? []));
  }
  for (const name of references.keys()) {
    if (!reachable.has(name)) {
      problems.push(`variable is unreachable from root and would be silently dropped: ${name}`);
    }
  }
  return problems;
}

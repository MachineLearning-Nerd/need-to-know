import { describe, expect, it } from "vitest";
import { lintOpenUiBlock } from "./lint.js";

describe("lintOpenUiBlock", () => {
  it("rejects an unterminated string", () => {
    const block = ["```openui", "root = Stack([card])", 'card = Card(["unterminated])', "```"].join(
      "\n",
    );
    expect(lintOpenUiBlock(block)).toContain("unbalanced string or brackets: card");
  });

  it("does not treat variable names inside strings as references", () => {
    const block = [
      "```openui",
      "root = Stack([card])",
      'card = Card([header], "card", "column", "s")',
      'header = CardHeader("mentions orphan,", "ok")',
      'orphan = TextContent("x", "small")',
      "```",
    ].join("\n");
    expect(lintOpenUiBlock(block)).toContain(
      "variable is unreachable from root and would be silently dropped: orphan",
    );
  });

  it("rejects duplicate and undefined variables", () => {
    const duplicate = [
      "```openui",
      "root = Stack([card])",
      'card = Card([], "card", "column", "s")',
      'card = Card([], "card", "column", "s")',
      "```",
    ].join("\n");
    expect(lintOpenUiBlock(duplicate)).toContain("duplicate variable definition: card");

    const undefinedChild = [
      "```openui",
      "root = Stack([card])",
      'card = Card([missing], "card", "column", "s")',
      "```",
    ].join("\n");
    expect(lintOpenUiBlock(undefinedChild)).toContain("undefined variable: card -> missing");
  });

  it("rejects nested component calls hidden inside a pinned component", () => {
    const block = [
      "```openui",
      "root = Stack([card])",
      'card = Card([Evil()], "card", "column", "s")',
      "```",
    ].join("\n");
    expect(lintOpenUiBlock(block)).toContain("nested component call is not allowed: Evil");
  });
});

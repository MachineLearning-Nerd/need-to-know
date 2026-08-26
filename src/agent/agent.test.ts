import { describe, expect, it } from "vitest";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../contract/policy.js";
import { lintOpenUiBlock } from "../render/lint.js";
import { CANARY } from "../vault/seed.js";
import { buildAgentManifest } from "./manifest.js";
import { ROOT_AGENT_PROMPT } from "./prompt.js";

// Root prompt invariants — these are behavioral guarantees, not formatting
// preferences. Any edit to prompt.ts must preserve them.
describe("ROOT_AGENT_PROMPT", () => {
  it("embeds the exact authorized purpose literal", () => {
    expect(ROOT_AGENT_PROMPT).toContain(ALLOWED_PURPOSE);
  });

  it("embeds the exact authorized audience literal", () => {
    expect(ROOT_AGENT_PROMPT).toContain(ALLOWED_AUDIENCE);
  });

  it("names release_result as approval-gated", () => {
    expect(ROOT_AGENT_PROMPT).toContain("release_result");
    expect(ROOT_AGENT_PROMPT).toMatch(/approval.gated|approval-gated/);
  });

  it("forbids calling release_result before validate_release returns approved", () => {
    expect(ROOT_AGENT_PROMPT).toMatch(/ONLY when validate_release returns/);
  });

  it("forbids subagents because pinned children inherit root Vault tools", () => {
    expect(ROOT_AGENT_PROMPT).toContain("Do not create subagents");
  });

  it("forbids raw rows, emails, phones, and free text in output", () => {
    expect(ROOT_AGENT_PROMPT).toMatch(/NEVER.*leave.*vault|NEVER appear/);
  });

  it("keeps the Vault canary values out of model-visible instructions", () => {
    const manifestText = JSON.stringify(buildAgentManifest("zai", "glm-5.2"));
    for (const canary of [CANARY.email, CANARY.freeText]) {
      expect(ROOT_AGENT_PROMPT).not.toContain(canary);
      expect(manifestText).not.toContain(canary);
    }
  });

  it("instructs using ask_user_question when purpose or audience is missing", () => {
    expect(ROOT_AGENT_PROMPT).toContain("ask_user_question");
  });

  it("instructs emitting openui blocks", () => {
    expect(ROOT_AGENT_PROMPT).toContain("openui");
  });
});

describe("production OpenUI templates", () => {
  const blocks = [...ROOT_AGENT_PROMPT.matchAll(/```openui\n([\s\S]*?)\n```/g)].map(
    (match) => match[1] ?? "",
  );

  it("defines a pinned-runtime root in every card", () => {
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block).toContain("root = Stack(");
  });

  it("uses only components present in the pinned OpenUI instructions", () => {
    expect(ROOT_AGENT_PROMPT).not.toContain("KeyValue(");
    expect(ROOT_AGENT_PROMPT).toContain("TextContent(");
    expect(ROOT_AGENT_PROMPT).toContain('Callout("success",');
    expect(ROOT_AGENT_PROMPT).toContain('Callout("error",');
  });

  it("keeps denial text to deterministic finding codes", () => {
    expect(ROOT_AGENT_PROMPT).toContain("finding.code values only");
    expect(ROOT_AGENT_PROMPT).not.toContain("{detail}");
    expect(ROOT_AGENT_PROMPT).not.toContain("{rows}");
  });

  // Origin binding: a placeholder the model fills must correspond to a typed
  // field of a vault tool response. A placeholder outside this set would
  // invite model-authored card values.
  const VAULT_TYPED_FIELDS: Record<string, string> = {
    queryId: "q-11111111-1111-1111-1111-111111111111",
    contractHash: "a".repeat(64),
    outputHash: "b".repeat(64),
    suppressedCells: "14",
    status: "denied",
    commaSeparatedFindingCodes: "purpose_not_allowed, small_cell",
    receiptId: "r-22222222-2222-2222-2222-222222222222",
    datasetVersion: "support-tickets-v1",
    policyVersion: "policy-v1",
  };

  it("binds every card placeholder to a typed vault response field", () => {
    const tokens = [...ROOT_AGENT_PROMPT.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => match[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(Object.keys(VAULT_TYPED_FIELDS), `untyped placeholder {${token}}`).toContain(token);
    }
  });

  it("card templates are grammatical OpenUI once vault values are substituted", () => {
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      const filled = `\`\`\`openui\n${block}\n\`\`\``.replace(
        /\{([A-Za-z]+)\}/g,
        (_, token: string) => VAULT_TYPED_FIELDS[token] ?? "MISSING",
      );
      expect(filled).not.toContain("MISSING");
      expect(lintOpenUiBlock(filled)).toEqual([]);
    }
  });

  it("instructs pasting the vault-authored chart block verbatim", () => {
    expect(ROOT_AGENT_PROMPT).toContain("VERBATIM");
    expect(ROOT_AGENT_PROMPT).toContain("Never author, edit, or re-assemble chart content");
  });
});

// Agent manifest shape tests — the manifest must wire require_approval_for_tools
// correctly; any misconfiguration would mean release_result fires without a
// human gate, which is the primary safety control.
describe("buildAgentManifest", () => {
  const manifest = buildAgentManifest("zai", "glm-5.2");

  it("requires approval for release_result", () => {
    const vaultServer = manifest.mcp_servers[0];
    expect(vaultServer?.require_approval_for_tools).toContain("release_result");
  });

  it("enables all vault tools", () => {
    expect(manifest.mcp_servers[0]?.enable_tools).toContain("@all");
  });

  it("disables dynamic subagents because pinned children inherit root Vault tools", () => {
    expect(manifest.config.dynamic_sub_agents.enabled).toBe(false);
  });

  it("enables ask user questions", () => {
    expect(manifest.config.ask_user_questions.enabled).toBe(true);
  });

  it("enables generative UI", () => {
    expect(manifest.config.generative_ui.enabled).toBe(true);
  });

  it("disables sandbox", () => {
    expect(manifest.config.sandbox.enabled).toBe(false);
  });

  it("uses temperature 0 for determinism", () => {
    expect(manifest.model.params.temperature).toBe(0);
  });

  it("disables parallel tool calls for a sequential release flow", () => {
    expect(manifest.model.params.parallel_tool_calls).toBe(false);
  });

  it("preloads the vault MCP server", () => {
    expect(manifest.mcp_servers[0]?.preload).toBe(true);
  });

  it("encodes model name as provider/model", () => {
    expect(manifest.model.name).toBe("zai/glm-5.2");
  });

  it("pins the verifier's Vault MCP server name", () => {
    expect(manifest.mcp_servers[0]?.name).toBe("vault");
  });

  it("embeds instructions from the root prompt", () => {
    expect(manifest.instructions).toBe(ROOT_AGENT_PROMPT);
  });
});

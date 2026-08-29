import { describe, expect, it } from "vitest";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../contract/policy.js";
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

  it("routes exception requests through AskUQ before any vault tool", () => {
    expect(ROOT_AGENT_PROMPT).toContain("requests an exception");
    expect(ROOT_AGENT_PROMPT).toContain("your FIRST action MUST be ask_user_question");
    expect(ROOT_AGENT_PROMPT).toContain("including describe_dataset");
    expect(ROOT_AGENT_PROMPT).toContain("Stop (Recommended)");
  });

  it("instructs emitting openui blocks", () => {
    expect(ROOT_AGENT_PROMPT).toContain("openui");
  });
});

describe("production OpenUI templates", () => {
  it("contains no model-filled card templates or placeholders", () => {
    expect(ROOT_AGENT_PROMPT).not.toContain("```openui");
    expect(ROOT_AGENT_PROMPT).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it("instructs pasting every vault-authored block verbatim", () => {
    expect(ROOT_AGENT_PROMPT).toContain("VERBATIM");
    expect(ROOT_AGENT_PROMPT).toContain("validate_release response contains a complete");
    expect(ROOT_AGENT_PROMPT).toContain("release_result response contains a complete");
    expect(ROOT_AGENT_PROMPT).toContain("render_safe_chart");
    expect(ROOT_AGENT_PROMPT).toContain("Never author, edit, or re-assemble");
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

  it("enables the sandbox for the post-release hash check only", () => {
    expect(manifest.config.sandbox.enabled).toBe(true);
    // The prompt must pin the sandbox to the single step-8 verification and
    // name the exact material allowed into it.
    expect(manifest.instructions).toContain("Sandbox hash verification");
    expect(manifest.instructions).toContain("printf '%s' 'B64' | base64 --decode | sha256sum");
    expect(manifest.instructions).toContain(
      "Use the sandbox ONLY for the single post-release hash verification",
    );
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

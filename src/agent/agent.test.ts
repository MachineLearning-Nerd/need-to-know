import { describe, expect, it } from "vitest";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE, POLICY_VERSION } from "../contract/policy.js";
import { DATASET_VERSION } from "../vault/schema.js";
import { buildAgentManifest } from "./manifest.js";
import { clearanceCard, receiptCard } from "./openui.js";
import { ROOT_AGENT_PROMPT } from "./prompt.js";
import { EVIDENCE_REVIEWER_PROMPT, PLANNER_PROMPT, PRIVACY_REVIEWER_PROMPT } from "./subagents.js";

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

  it("names three parallel subagents", () => {
    expect(ROOT_AGENT_PROMPT).toContain("planner");
    expect(ROOT_AGENT_PROMPT).toContain("privacy-reviewer");
    expect(ROOT_AGENT_PROMPT).toContain("evidence-reviewer");
  });

  it("forbids raw rows, emails, phones, and free text in output", () => {
    expect(ROOT_AGENT_PROMPT).toMatch(/NEVER.*leave.*vault|NEVER appear/);
  });

  it("instructs using ask_user_question when purpose or audience is missing", () => {
    expect(ROOT_AGENT_PROMPT).toContain("ask_user_question");
  });

  it("instructs emitting openui blocks", () => {
    expect(ROOT_AGENT_PROMPT).toContain("openui");
  });
});

// Subagent prompt invariants — each subagent must return a typed JSON object
// and must not be able to approve or deny a release.
describe("PLANNER_PROMPT", () => {
  it('includes the "planner" role field', () => {
    expect(PLANNER_PROMPT).toContain('"planner"');
  });

  it("names the allowed dimensions", () => {
    expect(PLANNER_PROMPT).toContain("week");
    expect(PLANNER_PROMPT).toContain("region");
    expect(PLANNER_PROMPT).toContain("category");
  });

  it("names the allowed metrics", () => {
    expect(PLANNER_PROMPT).toContain("ticket_count");
    expect(PLANNER_PROMPT).toContain("avg_resolution_hours");
  });

  it("forbids calling tools", () => {
    expect(PLANNER_PROMPT).toContain("Do not call any tool");
  });
});

describe("PRIVACY_REVIEWER_PROMPT", () => {
  it('includes the "privacy-reviewer" role field', () => {
    expect(PRIVACY_REVIEWER_PROMPT).toContain('"privacy-reviewer"');
  });

  it("names the four sensitive columns", () => {
    for (const column of ["customer_id", "email", "phone", "free_text"]) {
      expect(PRIVACY_REVIEWER_PROMPT).toContain(column);
    }
  });

  it("forbids calling tools", () => {
    expect(PRIVACY_REVIEWER_PROMPT).toContain("Do not call any tool");
  });
});

describe("EVIDENCE_REVIEWER_PROMPT", () => {
  it('includes the "evidence-reviewer" role field', () => {
    expect(EVIDENCE_REVIEWER_PROMPT).toContain('"evidence-reviewer"');
  });

  it("references the minimum group size k >= 3", () => {
    expect(EVIDENCE_REVIEWER_PROMPT).toContain("3");
  });

  it("requires suppressedCells to be disclosed", () => {
    expect(EVIDENCE_REVIEWER_PROMPT).toContain("suppressedCells");
  });

  it("forbids calling tools", () => {
    expect(EVIDENCE_REVIEWER_PROMPT).toContain("Do not call any tool");
  });
});

// OpenUI card shape tests — the model is prompted to emit these strings;
// tests confirm the helpers produce parseable, deterministic output.
describe("clearanceCard", () => {
  const approvedInput = {
    status: "approved" as const,
    purpose: ALLOWED_PURPOSE,
    audience: ALLOWED_AUDIENCE,
    queryId: "q-1",
    contractHash: "abc123",
    outputHash: "def456",
    suppressedCells: 2,
  };

  it("opens with a fenced openui block", () => {
    const card = clearanceCard(approvedInput);
    expect(card).toMatch(/^```openui\n/);
    expect(card).toMatch(/\n```$/);
  });

  it('sets header to "approved" for an approved verdict', () => {
    expect(clearanceCard(approvedInput)).toContain('CardHeader("Release Clearance", "approved")');
  });

  it("includes purpose, audience, and both hashes for approved", () => {
    const card = clearanceCard(approvedInput);
    expect(card).toContain(ALLOWED_PURPOSE);
    expect(card).toContain(ALLOWED_AUDIENCE);
    expect(card).toContain("abc123");
    expect(card).toContain("def456");
  });

  it("includes suppressed cell count for approved", () => {
    expect(clearanceCard(approvedInput)).toContain("2");
  });

  it('sets header to "denied" for a denied verdict', () => {
    const deniedCard = clearanceCard({ ...approvedInput, status: "denied" });
    expect(deniedCard).toContain('CardHeader("Release Clearance", "denied")');
  });

  it("includes findings table when findings are present in denied card", () => {
    const deniedCard = clearanceCard({
      ...approvedInput,
      status: "denied",
      findings: [{ code: "mission_not_authorized", detail: "purpose_not_authorized" }],
    });
    expect(deniedCard).toContain("Table");
    expect(deniedCard).toContain("mission_not_authorized");
  });

  it("omits findings table when no findings are present", () => {
    const deniedCard = clearanceCard({ ...approvedInput, status: "denied" });
    expect(deniedCard).not.toContain("Table");
  });

  it("escapes double quotes in hash values", () => {
    const card = clearanceCard({ ...approvedInput, contractHash: 'hash"with"quotes' });
    expect(card).toContain('\\"with\\"');
    expect(card).not.toMatch(/[^\\]"with[^\\]"/);
  });
});

describe("receiptCard", () => {
  const receiptInput = {
    receiptId: "r-1",
    queryId: "q-1",
    contractHash: "abc123",
    outputHash: "def456",
    datasetVersion: DATASET_VERSION,
    policyVersion: POLICY_VERSION,
  };

  it("opens with a fenced openui block", () => {
    const card = receiptCard(receiptInput);
    expect(card).toMatch(/^```openui\n/);
    expect(card).toMatch(/\n```$/);
  });

  it('sets header to "released"', () => {
    expect(receiptCard(receiptInput)).toContain('CardHeader("Release Receipt", "released")');
  });

  it("includes all receipt fields", () => {
    const card = receiptCard(receiptInput);
    expect(card).toContain("r-1");
    expect(card).toContain("q-1");
    expect(card).toContain("abc123");
    expect(card).toContain("def456");
    expect(card).toContain(DATASET_VERSION);
    expect(card).toContain(POLICY_VERSION);
  });

  it("mentions verify-receipt CLI", () => {
    expect(receiptCard(receiptInput)).toContain("verify-receipt");
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

  it("enables dynamic subagents", () => {
    expect(manifest.config.dynamic_sub_agents.enabled).toBe(true);
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

  it("enables parallel_tool_calls for subagent fan-out", () => {
    expect(manifest.model.params.parallel_tool_calls).toBe(true);
  });

  it("preloads the vault MCP server", () => {
    expect(manifest.mcp_servers[0]?.preload).toBe(true);
  });

  it("encodes model name as provider/model", () => {
    expect(manifest.model.name).toBe("zai/glm-5.2");
  });

  it("accepts a custom vault MCP server name", () => {
    const custom = buildAgentManifest("zai", "glm-5.2", "my-vault");
    expect(custom.mcp_servers[0]?.name).toBe("my-vault");
  });

  it("embeds instructions from the root prompt", () => {
    expect(manifest.instructions).toBe(ROOT_AGENT_PROMPT);
  });
});

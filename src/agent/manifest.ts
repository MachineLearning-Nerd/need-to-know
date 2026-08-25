import { ROOT_AGENT_PROMPT } from "./prompt.js";

// The TrueForge agent manifest for the Need-to-Know release officer.
// This is the object that goes to POST /api/v1/agents.
//
// Key decisions encoded here:
//   - require_approval_for_tools: ["release_result"] — the vault's write/destructive
//     tool always pauses for a human before executing, regardless of model output.
//   - dynamic_sub_agents: enabled — the root agent calls create_sub_agent to fan
//     out planner / privacy-reviewer / evidence-reviewer in parallel.
//   - ask_user_questions: enabled — the root agent calls ask_user_question when
//     purpose or audience is missing from the initial user request.
//   - generative_ui: enabled — the model emits openui fenced blocks that the
//     bundled TrueForge chat UI renders as structured clearance/receipt cards.
//   - sandbox: disabled — the MVP uses a deterministic local renderer only.

export type AgentManifest = {
  readonly model: {
    readonly name: string;
    readonly params: {
      readonly temperature: number;
      readonly max_tokens: number;
      readonly parallel_tool_calls: boolean;
    };
  };
  readonly instructions: string;
  readonly mcp_servers: ReadonlyArray<{
    readonly name: string;
    readonly enable_tools: readonly string[];
    readonly require_approval_for_tools: readonly string[];
    readonly preload: boolean;
  }>;
  readonly config: {
    readonly iteration_limit: number;
    readonly generative_ui: { readonly enabled: boolean };
    readonly ask_user_questions: { readonly enabled: boolean };
    readonly dynamic_sub_agents: { readonly enabled: boolean };
    readonly sandbox: { readonly enabled: boolean };
  };
};

export const AGENT_NAME = "need-to-know";

// The vault MCP server name as configured in TrueForge's /api/v1/settings/mcp-servers.
// Operators must register the Vault MCP server under this name before starting a session.
export const VAULT_MCP_SERVER_NAME = "vault";

export function buildAgentManifest(
  modelProvider: string,
  modelId: string,
  vaultMcpServerName: string = VAULT_MCP_SERVER_NAME,
): AgentManifest {
  return {
    model: {
      name: `${modelProvider}/${modelId}`,
      params: {
        temperature: 0,
        max_tokens: 4096,
        parallel_tool_calls: true,
      },
    },
    instructions: ROOT_AGENT_PROMPT,
    mcp_servers: [
      {
        name: vaultMcpServerName,
        enable_tools: ["@all"],
        require_approval_for_tools: ["release_result"],
        preload: true,
      },
    ],
    config: {
      iteration_limit: 25,
      generative_ui: { enabled: true },
      ask_user_questions: { enabled: true },
      dynamic_sub_agents: { enabled: true },
      sandbox: { enabled: false },
    },
  };
}

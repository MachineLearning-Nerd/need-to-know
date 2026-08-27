// Evidence extracted from the conversation itself: the rail renders only what
// the vault's tool responses actually said, parsed from the thread's
// tool-call parts. No separate evidence endpoint exists — by design the vault
// speaks exclusively through its five MCP tools.

export type ClearanceEvidence = {
  queryId?: string;
  purpose?: string;
  audience?: string;
  columns?: string[];
  suppressedCells?: number;
  verdict?: string;
  findingCodes?: string;
  contractHash?: string;
  outputHash?: string;
  receiptId?: string;
  datasetVersion?: string;
  policyVersion?: string;
  denialCode?: string;
  chartRendered?: boolean;
};

type ToolCallPart = {
  type: string;
  toolName?: string;
  result?: unknown;
  isError?: boolean;
  args?: unknown;
};

type ThreadMessageLike = { role: string; content?: readonly unknown[] };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// MCP tool results arrive either as the decoded payload or wrapped in the MCP
// content envelope ({content: [{type: "text", text}]}); both forms decode to
// the vault's JSON body, and anything unparseable is ignored.
function decodeToolResult(result: unknown): Record<string, unknown> | null {
  const wrapper = record(result);
  if (wrapper === null) {
    if (typeof result !== "string") return null;
    try {
      return record(JSON.parse(result));
    } catch {
      return null;
    }
  }
  if (Array.isArray(wrapper.content)) {
    const first = record(wrapper.content[0]);
    if (typeof first?.text === "string") {
      try {
        return record(JSON.parse(first.text));
      } catch {
        return null;
      }
    }
  }
  return wrapper;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

export function extractEvidence(messages: readonly ThreadMessageLike[]): ClearanceEvidence {
  const evidence: ClearanceEvidence = {};
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const call = part as ToolCallPart;
      if (call.type !== "tool-call" || typeof call.toolName !== "string") continue;
      const body = decodeToolResult(call.result);
      if (body === null) continue;

      if (call.toolName === "prepare_analysis" && typeof body.queryId === "string") {
        const candidate = record(body.candidate);
        evidence.queryId = body.queryId;
        if (typeof candidate?.purpose === "string") evidence.purpose = candidate.purpose;
        if (typeof candidate?.audience === "string") evidence.audience = candidate.audience;
        evidence.columns = strings(candidate?.columns);
        if (typeof body.suppressedCells === "number") {
          evidence.suppressedCells = body.suppressedCells;
        }
      }
      if (call.toolName === "validate_release") {
        if (typeof body.status === "string") evidence.verdict = body.status;
        if (typeof body.contractHash === "string") evidence.contractHash = body.contractHash;
        if (typeof body.outputHash === "string") evidence.outputHash = body.outputHash;
        if (typeof body.findingCodes === "string") evidence.findingCodes = body.findingCodes;
      }
      if (call.toolName === "release_result") {
        const receipt = record(body.receipt);
        if (typeof receipt?.receiptId === "string") {
          evidence.receiptId = receipt.receiptId;
          if (typeof receipt.datasetVersion === "string") {
            evidence.datasetVersion = receipt.datasetVersion;
          }
          if (typeof receipt.policyVersion === "string") {
            evidence.policyVersion = receipt.policyVersion;
          }
        } else if (typeof body.error === "string") {
          evidence.denialCode = body.error;
        }
      }
      if (call.toolName === "render_safe_chart" && typeof body.openui === "string") {
        evidence.chartRendered = true;
      }
    }
  }
  return evidence;
}

// The pending release approval's human-approved tuple, straight from the tool
// call the model is asking to run — this is what the approval bar makes the
// hero of the decision.
export function pendingReleaseTuple(
  messages: readonly ThreadMessageLike[],
): Record<string, unknown> | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const call = part as ToolCallPart;
      if (call.type !== "tool-call" || call.toolName !== "release_result") continue;
      if (call.result !== undefined) continue;
      return record(call.args);
    }
  }
  return null;
}

export function shortHash(hash: string | undefined): string {
  if (hash === undefined) return "—";
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

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

// MCP tool results arrive either decoded or in a text content/error envelope.
// Both forms decode to the vault's JSON body; anything unparseable is ignored.
function decodeToolResult(result: unknown): Record<string, unknown> | null {
  let wrapper = record(result);
  if (wrapper === null) {
    if (typeof result !== "string") return null;
    try {
      wrapper = record(JSON.parse(result));
    } catch {
      return null;
    }
  }
  if (wrapper === null) return null;
  const content = Array.isArray(wrapper.content)
    ? wrapper.content
    : Array.isArray(wrapper.error)
      ? wrapper.error
      : null;
  if (content !== null) {
    const first = record(content[0]);
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

function recordDenial(body: Record<string, unknown>, evidence: ClearanceEvidence): void {
  if (typeof body.error !== "string") return;
  evidence.denialCode =
    typeof body.detail === "string" ? `${body.error}: ${body.detail}` : body.error;
  if (typeof body.findingCodes === "string") evidence.findingCodes = body.findingCodes;
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
      if (call.toolName === "describe_dataset" || call.toolName === "render_safe_chart") {
        recordDenial(body, evidence);
      }

      if (call.toolName === "prepare_analysis") {
        // A preparation — success or denial — starts the latest workflow.
        // Nothing from an earlier query may survive it: a stale receipt would
        // mask a new denial, and a new query would inherit RELEASED state.
        for (const key of Object.keys(evidence) as Array<keyof ClearanceEvidence>) {
          delete evidence[key];
        }
        if (typeof body.queryId === "string") {
          const candidate = record(body.candidate);
          evidence.queryId = body.queryId;
          if (typeof candidate?.purpose === "string") evidence.purpose = candidate.purpose;
          if (typeof candidate?.audience === "string") evidence.audience = candidate.audience;
          evidence.columns = strings(candidate?.columns);
          if (typeof body.suppressedCells === "number") {
            evidence.suppressedCells = body.suppressedCells;
          }
        } else {
          recordDenial(body, evidence);
        }
      }
      // Validation, release, and chart evidence binds to the current query:
      // a response carrying a different queryId belongs to an earlier
      // preparation and must not be attributed to this one.
      if (call.toolName === "validate_release") {
        if (typeof body.queryId !== "string" || body.queryId === evidence.queryId) {
          recordDenial(body, evidence);
          if (typeof body.status === "string") evidence.verdict = body.status;
          if (typeof body.contractHash === "string") evidence.contractHash = body.contractHash;
          if (typeof body.outputHash === "string") evidence.outputHash = body.outputHash;
          if (typeof body.findingCodes === "string") evidence.findingCodes = body.findingCodes;
        }
      }
      if (call.toolName === "release_result") {
        const receipt = record(body.receipt);
        if (typeof receipt?.receiptId === "string") {
          if (receipt.queryId === evidence.queryId) {
            evidence.receiptId = receipt.receiptId;
            if (typeof receipt.datasetVersion === "string") {
              evidence.datasetVersion = receipt.datasetVersion;
            }
            if (typeof receipt.policyVersion === "string") {
              evidence.policyVersion = receipt.policyVersion;
            }
          }
        } else {
          recordDenial(body, evidence);
        }
      }
      if (
        call.toolName === "render_safe_chart" &&
        typeof body.openui === "string" &&
        body.queryId === evidence.queryId
      ) {
        evidence.chartRendered = true;
      }
    }
  }
  return evidence;
}

export function releaseTupleFromArgsText(
  argsText: string | undefined,
): Record<string, unknown> | null {
  if (argsText === undefined) return null;
  try {
    return record(JSON.parse(argsText));
  } catch {
    return null;
  }
}

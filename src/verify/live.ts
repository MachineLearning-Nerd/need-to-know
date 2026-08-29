import { buildAgentManifest, VAULT_MCP_SERVER_NAME } from "../agent/manifest.js";
import { snapshotArray, snapshotRecord } from "../contract/snapshot.js";
import {
  fetchSessionEvents,
  isSafeTrueForgeId,
  listSessionTurnIds,
  type PersistedEvent,
} from "./events.js";
import type { VerifiableReceipt, VerifyResult } from "./receipt.js";
import { verifyReceipt } from "./verify.js";

const expectedModelProvider = process.env.MODEL_PROVIDER_NAME ?? "zai";
const expectedModelId = process.env.ZAI_OPENAI_MODEL ?? "glm-5.2";

function evidenceOf(value: unknown): VerifiableReceipt["evidence"] | null {
  const bundle = snapshotRecord(value);
  const evidence = bundle === null ? null : snapshotRecord(bundle.evidence);
  const turnIds = evidence === null ? null : snapshotArray(evidence.turnIds);
  if (
    evidence === null ||
    Object.keys(evidence).length !== 3 ||
    !isSafeTrueForgeId(evidence.sessionId) ||
    evidence.agentType !== "inline" ||
    turnIds === null ||
    turnIds.length === 0 ||
    !turnIds.every(isSafeTrueForgeId) ||
    new Set(turnIds).size !== turnIds.length
  ) {
    return null;
  }
  return {
    sessionId: evidence.sessionId,
    agentType: "inline",
    turnIds: turnIds as string[],
  };
}

async function checkSessionAgent(
  baseUrl: string,
  evidence: VerifiableReceipt["evidence"],
): Promise<VerifyResult | null> {
  try {
    const response = await fetch(
      `${baseUrl}/api/v1/sessions/${encodeURIComponent(evidence.sessionId)}`,
      {
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return {
        outcome: "events_unavailable",
        detail: `session fetch returned ${response.status}`,
      };
    }
    const body = snapshotRecord(await response.json());
    const session = body === null ? null : snapshotRecord(body.data);
    const agent = session === null ? null : snapshotRecord(session.agent);
    if (
      session?.id !== evidence.sessionId ||
      agent === null ||
      agent.type !== "inline" ||
      !hasExpectedAgentManifest(agent.spec)
    ) {
      return {
        outcome: "session_mismatch",
        detail: "session does not carry the expected inline agent manifest",
      };
    }
    return null;
  } catch (error) {
    return { outcome: "events_unavailable", detail: (error as Error).message };
  }
}

// The security-relevant manifest fields are checked exactly — the pinned
// instructions, the model, no seeded messages, the single gated vault MCP
// server, subagents disabled, and sandbox enabled (its use is pinned to the
// single post-release hash step by the instructions equality below).
// Server-added defaults (tool lists, context management, download flags) are
// deliberately ignored: a runtime default change must not false-fail every
// bundle.
function hasExpectedAgentManifest(value: unknown): boolean {
  const manifest = snapshotRecord(value);
  if (manifest === null) return false;
  const configured = buildAgentManifest(expectedModelProvider, expectedModelId);
  const model = snapshotRecord(manifest.model);
  if (model?.name !== configured.model.name) return false;
  if (manifest.instructions !== configured.instructions) return false;
  const seeded = manifest.messages === undefined ? [] : snapshotArray(manifest.messages);
  if (seeded === null || seeded.length !== 0) return false;
  const servers = snapshotArray(manifest.mcp_servers);
  const server = servers?.length === 1 ? snapshotRecord(servers[0]) : null;
  const gated = server === null ? null : snapshotArray(server.require_approval_for_tools);
  if (
    server?.name !== VAULT_MCP_SERVER_NAME ||
    gated === null ||
    !gated.includes("release_result")
  ) {
    return false;
  }
  const config = snapshotRecord(manifest.config);
  const subAgents = config === null ? null : snapshotRecord(config.dynamic_sub_agents);
  const sandbox = config === null ? null : snapshotRecord(config.sandbox);
  return subAgents?.enabled === false && sandbox?.enabled === true;
}

export async function loadLiveSessionEvidence(
  baseUrl: string,
  evidence: VerifiableReceipt["evidence"],
): Promise<
  | { readonly ok: true; readonly events: PersistedEvent[]; readonly turnIds: string[] }
  | { readonly ok: false; readonly result: VerifyResult }
> {
  const sessionFailure = await checkSessionAgent(baseUrl, evidence);
  if (sessionFailure !== null) return { ok: false, result: sessionFailure };

  const before = await listSessionTurnIds(baseUrl, evidence.sessionId);
  if (!before.ok) {
    return { ok: false, result: { outcome: before.reason, detail: before.detail } };
  }
  const claimed = new Set(evidence.turnIds);
  if (
    before.turnIds.length !== claimed.size ||
    !before.turnIds.every((turnId) => claimed.has(turnId))
  ) {
    return {
      ok: false,
      result: {
        outcome: "session_mismatch",
        detail: "bundle turn list differs from the session's persisted turns",
      },
    };
  }

  const fetched = await fetchSessionEvents(baseUrl, evidence.sessionId, before.turnIds);
  if (!fetched.ok) {
    return { ok: false, result: { outcome: fetched.reason, detail: fetched.detail } };
  }
  const after = await listSessionTurnIds(baseUrl, evidence.sessionId);
  if (!after.ok) return { ok: false, result: { outcome: after.reason, detail: after.detail } };
  if (
    before.turnIds.length !== after.turnIds.length ||
    before.turnIds.some((turnId, index) => after.turnIds[index] !== turnId)
  ) {
    return {
      ok: false,
      result: { outcome: "events_partial", detail: "session turn list changed during fetch" },
    };
  }
  // No second agent check: an inline session's spec is frozen at creation,
  // so only the turn list can change under the fetch.
  return { ok: true, events: fetched.events, turnIds: before.turnIds };
}

export async function verifyLiveReceipt(
  value: unknown,
  baseUrl: string | undefined,
): Promise<VerifyResult> {
  const evidence = evidenceOf(value);
  if (evidence === null) return verifyReceipt(value);
  if (baseUrl === undefined || baseUrl.length === 0) {
    return {
      outcome: "events_unavailable",
      detail: "TRUEFORGE_BASE_URL is required to authenticate the identified session",
    };
  }

  const loaded = await loadLiveSessionEvidence(baseUrl, evidence);
  if (!loaded.ok) return loaded.result;
  return verifyReceipt({ ...(value as Record<string, unknown>), events: loaded.events });
}

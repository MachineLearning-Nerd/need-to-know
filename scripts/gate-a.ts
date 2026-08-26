#!/usr/bin/env node
// Gate A: the full release flow against a LIVE TrueForge instance.
//
// Proves, with the vault store in this process as the ground truth:
//   DENY path  — the turn pauses on release_result, the human denies, and the
//                vault records ZERO release transitions and zero receipts.
//   ALLOW path — the same flow approved produces exactly ONE receipt.
// Then fetches the PERSISTED events for both sessions and asserts the
// approval-before-release ordering on what the server stored, not on what the
// stream happened to show. Writes a VerifiableReceipt bundle for the allow
// run so verify-receipt and Gate B consume the same evidence.
//
// Prerequisites: a running TrueForge (TRUEFORGE_BASE_URL, default
// http://localhost:8891) already configured via setup-trueforge; ZAI billing
// live. The vault itself is started IN THIS PROCESS so its store can be
// interrogated directly.

import { writeFileSync } from "node:fs";

import { TrueForge } from "@truefoundry/trueforge-sdk";

import { buildAgentManifest } from "../src/agent/manifest.js";
import { createVaultHandlers } from "../src/server/handlers.js";
import { startVaultMcpServer } from "../src/server/mcp.js";
import { createVaultStore } from "../src/server/store.js";
import { openVaultDatabase } from "../src/vault/database.js";
import { listSessionTurnIds, type PersistedEvent } from "../src/verify/events.js";
import { loadLiveSessionEvidence } from "../src/verify/live.js";
import { verifyReceipt } from "../src/verify/verify.js";
import {
  askUqPrecedesApproval,
  exercisedQuestionAndApproval,
  GATE_A_USER_MESSAGE,
  type GateActionInput,
  type GateStreamEvent,
  gateABoundaryFailures,
  pendingSessionInput,
} from "./gate-a-actions.js";

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891";
const vaultPort = Number(process.env.VAULT_PORT ?? 8788);
const providerName = process.env.MODEL_PROVIDER_NAME ?? "zai";
const modelId = process.env.ZAI_OPENAI_MODEL ?? "glm-5.2";
const bundlePath = process.env.BUNDLE_PATH ?? "gate-a-bundle.json";
const resultPath = process.env.RESULT_PATH ?? "gate-a-result.json";

const CONTINUE_MESSAGE = "Continue the requested release flow from the current prepared state.";

type GateTurnInput = GateActionInput | { type: "user.message"; content: string };

const failures: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) failures.push(label);
  process.stdout.write(`gate-a: ${condition ? "ok " : "FAIL"} ${label}\n`);
}

async function runTurn(
  client: TrueForge,
  sessionId: string,
  input: GateTurnInput[],
): Promise<GateStreamEvent[]> {
  const events: GateStreamEvent[] = [];
  const stream = await client.sessions.createTurnStream(sessionId, { input });
  for await (const { data: event } of stream.withMetadata()) {
    events.push(event as GateStreamEvent);
  }
  return events;
}

// Drive one session to its approval pause, answer with the given status, and
// keep answering until the turn stops pausing (a denied model may retry).
async function runSession(
  client: TrueForge,
  status: "allow" | "deny",
): Promise<{
  sessionId: string;
  events: GateStreamEvent[];
  approvalPauses: number;
  questionPauses: number;
}> {
  const { data: session } = await client.sessions.create({
    agent: { spec: buildAgentManifest(providerName, modelId) },
  });
  if (session.agent.type !== "inline") {
    throw new Error("created session did not snapshot its agent");
  }
  const events = await runTurn(client, session.id, [
    { type: "user.message", content: GATE_A_USER_MESSAGE },
  ]);
  let approvalPauses = 0;
  let questionPauses = 0;
  const answeredCallIds = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const pending = pendingSessionInput(events, answeredCallIds, status);
    if (pending.input.length === 0) {
      if (approvalPauses > 0) break;
      events.push(
        ...(await runTurn(client, session.id, [
          { type: "user.message", content: CONTINUE_MESSAGE },
        ])),
      );
      continue;
    }
    for (const item of pending.input) {
      const callId = (item as { toolCallId: string }).toolCallId;
      answeredCallIds.add(callId);
    }
    approvalPauses += pending.approvalCount;
    questionPauses += pending.questionCount;
    events.push(...(await runTurn(client, session.id, pending.input)));
  }
  return { sessionId: session.id, events, approvalPauses, questionPauses };
}

// Persisted approval events carry tool_calls[].id only — no tool names — so
// gated calls are identified by id and their responses matched by
// tool_call_id.
function gatedCallPositions(events: PersistedEvent[]): Map<string, number> {
  const positions = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.type !== "tool.approval_required") return;
    const calls = (event.tool_calls ?? []) as Array<{ id?: string }>;
    for (const call of calls) {
      if (typeof call.id === "string") positions.set(call.id, index);
    }
  });
  return positions;
}

function hasAskUserQuestion(events: PersistedEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== "model.message" || !Array.isArray(event.tool_calls)) return false;
    return event.tool_calls.some((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      const fn = (value as { function?: unknown }).function;
      return (
        typeof fn === "object" &&
        fn !== null &&
        !Array.isArray(fn) &&
        (fn as { name?: unknown }).name === "ask_user_question"
      );
    });
  });
}

async function main(): Promise<void> {
  const db = openVaultDatabase();
  const store = createVaultStore();
  const vault = await startVaultMcpServer(vaultPort, createVaultHandlers(db, store));
  process.stdout.write(`gate-a: vault on ${vault.port}, trueforge at ${baseUrl}\n`);
  const client = new TrueForge({ baseUrl, timeoutInSeconds: 300 });

  try {
    // ---- DENY path -------------------------------------------------------
    const denied = await runSession(client, "deny");
    check(
      exercisedQuestionAndApproval(denied.approvalPauses, denied.questionPauses),
      `deny path exercised AskUQ (${denied.questionPauses}x) and approval (${denied.approvalPauses}x)`,
    );
    check(
      askUqPrecedesApproval(denied.events),
      "deny path: the audience question paused the session before the approval gate",
    );
    const releasedAfterDeny = store.audits().filter((record) => record.outcome === "released");
    check(releasedAfterDeny.length === 0, "deny path: zero release transitions in the vault");
    check(
      store.audits().every((record) => store.getReceipt(record.queryId) === undefined),
      "deny path: zero receipts in the vault",
    );

    // ---- ALLOW path ------------------------------------------------------
    const allowed = await runSession(client, "allow");
    check(
      exercisedQuestionAndApproval(allowed.approvalPauses, allowed.questionPauses),
      `allow path exercised AskUQ (${allowed.questionPauses}x) and approval (${allowed.approvalPauses}x)`,
    );
    check(
      askUqPrecedesApproval(allowed.events),
      "allow path: the audience question paused the session before the approval gate",
    );
    const released = store.audits().filter((record) => record.outcome === "released");
    check(released.length === 1, `allow path: exactly one release transition (${released.length})`);
    const queryId = released[0]?.queryId ?? "-";
    const receipt = store.getReceipt(queryId);
    check(receipt !== undefined, `allow path: receipt exists for ${queryId}`);

    // ---- Persisted-event assertions -------------------------------------
    const listedAllowTurns = await listSessionTurnIds(baseUrl, allowed.sessionId);
    const listedDenyTurns = await listSessionTurnIds(baseUrl, denied.sessionId);
    if (!listedAllowTurns.ok || !listedDenyTurns.ok) throw new Error("turn list fetch failed");
    const allowTurnIds = listedAllowTurns.turnIds;
    const denyTurnIds = listedDenyTurns.turnIds;
    const persistedAllow = await loadLiveSessionEvidence(baseUrl, {
      sessionId: allowed.sessionId,
      agentType: "inline",
      turnIds: allowTurnIds,
    });
    const persistedDeny = await loadLiveSessionEvidence(baseUrl, {
      sessionId: denied.sessionId,
      agentType: "inline",
      turnIds: denyTurnIds,
    });
    check(persistedAllow.ok, "allow path: persisted events fetched completely");
    check(persistedDeny.ok, "deny path: persisted events fetched completely");
    if (!persistedAllow.ok || !persistedDeny.ok) throw new Error("persisted fetch failed");
    if (receipt === undefined) throw new Error("allow path produced no receipt");

    check(hasAskUserQuestion(persistedAllow.events), "persisted allow stream contains AskUQ");
    check(hasAskUserQuestion(persistedDeny.events), "persisted deny stream contains AskUQ");

    const allowGated = gatedCallPositions(persistedAllow.events);
    check(allowGated.size >= 1, "persisted allow stream contains an approval_required gate");

    const denyGated = gatedCallPositions(persistedDeny.events);
    check(denyGated.size >= 1, "persisted deny stream contains an approval_required gate");
    const denyMarker = persistedDeny.events.some(
      (event) =>
        event.type === "tool.response" &&
        typeof event.tool_call_id === "string" &&
        denyGated.has(event.tool_call_id) &&
        typeof event.content === "string" &&
        event.content.includes("User denied tool call"),
    );
    check(denyMarker, "persisted deny stream: the gated response records the user denial");
    check(
      !JSON.stringify(persistedDeny.events).includes('"receiptId'),
      "persisted deny stream carries no release receipt",
    );
    const persistedBoundaryFailures = gateABoundaryFailures(
      persistedAllow.events,
      persistedDeny.events,
    );
    check(
      persistedBoundaryFailures.length === 0,
      "persisted allow and deny streams contain no canary or raw synthetic values",
    );
    for (const failure of persistedBoundaryFailures) {
      check(false, failure);
    }

    // ---- Bundle for verify-receipt / Gate B ------------------------------
    const candidate = store.getPrepared(queryId)?.candidate;
    const bundle = {
      receipt,
      candidate,
      evidence: { sessionId: allowed.sessionId, agentType: "inline", turnIds: allowTurnIds },
      events: persistedAllow.events,
    };
    const verdict = verifyReceipt(bundle);
    check(verdict.outcome === "pass", `allow path: exact persisted witness -> ${verdict.outcome}`);
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
    process.stdout.write(`gate-a: bundle written to ${bundlePath}\n`);

    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          gate: "A",
          pass: failures.length === 0,
          failures,
          denySessionId: denied.sessionId,
          allowSessionId: allowed.sessionId,
          allowTurnIds,
          denyQuestionPauses: denied.questionPauses,
          allowQuestionPauses: allowed.questionPauses,
          receiptId: receipt.receiptId,
          auditOutcomes: store.audits().map((record) => record.outcome),
        },
        null,
        2,
      ),
    );
  } finally {
    await vault.close();
    db.close();
  }

  process.stdout.write(`gate-a: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}\n`);
  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((error) => {
  process.stderr.write(`gate-a: error: ${(error as Error).stack ?? error}\n`);
  process.exit(1);
});

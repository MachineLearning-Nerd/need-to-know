#!/usr/bin/env node
// Reconnect proof (T7.1): hard-abort the demo turn's SSE stream mid-flow,
// resume with subscribeToTurn({afterSequenceNumber}), and prove the stitched
// client view misses and duplicates nothing — then finish the real release
// flow on the same session to show the interruption cost nothing.
//
//   1. Seam integrity: sequence numbers across abort + resume are strictly
//      consecutive — the first resumed event is lastSeq + 1.
//   2. Persistence equality: the stitched non-delta events match the persisted
//      turn in order after the SDK's camel/snake conversion and known final
//      model-message enrichment — nothing missed, duplicated, or altered.
//   3. The demo flow still completes: AskUQ answered, release approved,
//      exactly one receipt in the vault.
//
// Usage: TRUEFORGE_BASE_URL=http://localhost:8891 npm run reconnect-proof

import { writeFileSync } from "node:fs";

import { TrueForge } from "@truefoundry/trueforge-sdk";

import { buildAgentManifest } from "../src/agent/manifest.js";
import { createVaultHandlers } from "../src/server/handlers.js";
import { startVaultMcpServer } from "../src/server/mcp.js";
import { createVaultStore } from "../src/server/store.js";
import { openVaultDatabase } from "../src/vault/database.js";
import { fetchTurnEvents } from "../src/verify/events.js";
import {
  exercisedQuestionAndApproval,
  GATE_A_USER_MESSAGE,
  type GateStreamEvent,
  pendingSessionInput,
} from "./gate-a-actions.js";
import { nonDeltaEventsMatchPersistence } from "./reconnect-events.js";

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891";
const vaultPort = Number(process.env.VAULT_PORT ?? 8788);
const providerName = process.env.MODEL_PROVIDER_NAME ?? "zai";
const modelId = process.env.ZAI_OPENAI_MODEL ?? "glm-5.2";
const resultPath = process.env.RESULT_PATH ?? "gate-reconnect-result.json";

// Abort after this many streamed events — early enough that the model is
// still mid-answer, late enough that the turn id is known.
const ABORT_AFTER_EVENTS = 6;

const failures: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) failures.push(label);
  process.stdout.write(`reconnect: ${condition ? "ok " : "FAIL"} ${label}\n`);
}

type StitchedEvent = { seq: number; data: GateStreamEvent & { id?: string } };

async function main(): Promise<void> {
  const db = openVaultDatabase();
  const store = createVaultStore();
  const vault = await startVaultMcpServer(vaultPort, createVaultHandlers(db, store));
  const client = new TrueForge({ baseUrl, timeoutInSeconds: 300 });

  try {
    const { data: session } = await client.sessions.create({
      agent: { spec: buildAgentManifest(providerName, modelId) },
    });

    // ---- Phase 1: stream the demo turn and hard-abort it mid-flow --------
    const controller = new AbortController();
    const firstStream = await client.sessions.createTurnStream(
      session.id,
      { input: [{ type: "user.message", content: GATE_A_USER_MESSAGE }] },
      { abortSignal: controller.signal },
    );
    const stitched: StitchedEvent[] = [];
    let turnId = "";
    try {
      for await (const sse of firstStream.withMetadata()) {
        const data = sse.data as StitchedEvent["data"];
        stitched.push({ seq: Number(sse.id), data });
        if (data.type === "turn.created") {
          const created = data as { turnId?: string; turn_id?: string };
          turnId = created.turnId ?? created.turn_id ?? "";
        }
        if (stitched.length >= ABORT_AFTER_EVENTS) {
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") throw error;
    }
    const lastSeq = stitched.at(-1)?.seq ?? 0;
    check(turnId.length > 0, `turn id captured before the abort (${turnId})`);
    check(
      stitched.length === ABORT_AFTER_EVENTS && lastSeq === ABORT_AFTER_EVENTS,
      `hard abort after ${stitched.length} events at sequence ${lastSeq}`,
    );

    // ---- Phase 2: resume from the cursor and drain the turn --------------
    const resumed = await client.sessions.subscribeToTurn(session.id, turnId, {
      afterSequenceNumber: lastSeq,
    });
    let firstResumedSeq: number | undefined;
    for await (const sse of resumed.withMetadata()) {
      const data = sse.data as StitchedEvent["data"];
      const seq = Number(sse.id);
      firstResumedSeq ??= seq;
      stitched.push({ seq, data });
      // The pause is tool.response_required, but the turn persists one more
      // event (turn.done) right after it — drain to that, or the coverage
      // check below would report a "missed" event the client chose to skip.
      if (data.type === "turn.done") break;
    }
    check(
      firstResumedSeq === lastSeq + 1,
      `resume replays from exactly lastSeq + 1 (got ${firstResumedSeq})`,
    );
    const sequences = stitched.map((event) => event.seq);
    check(
      sequences.every((seq, index) => seq === index + 1),
      "stitched sequence numbers are strictly consecutive with no gap or duplicate",
    );

    // ---- Phase 3: the persisted turn is fully covered by the stitch ------
    const persisted = await fetchTurnEvents(baseUrl, session.id, turnId);
    check(persisted.ok, "persisted turn events refetched completely");
    if (!persisted.ok) throw new Error(persisted.detail);
    // Every model.message.delta carries its parent aggregate's event id, so
    // the once-and-only-once claim is over non-delta events. The stream SDK
    // camel-cases fields while persistence uses snake_case and enriches the
    // final model message; the matcher allows exactly those differences.
    const persistedEventsMatch = nonDeltaEventsMatchPersistence(stitched, persisted.events);
    const persistedIds = persisted.events
      .map((event) => event.id)
      .filter((id): id is string => typeof id === "string");
    check(
      persistedEventsMatch,
      `stitched non-delta events are preserved in the persisted turn under the pinned SDK mapping (${persistedIds.length} events, order preserved)`,
    );

    // ---- Phase 4: finish the real flow on the same session ---------------
    const events = stitched.map((event) => event.data);
    const answeredCallIds = new Set<string>();
    let approvalPauses = 0;
    let questionPauses = 0;
    for (let round = 0; round < 4; round++) {
      const pending = pendingSessionInput(events, answeredCallIds, "allow");
      if (pending.input.length === 0) break;
      approvalPauses += pending.approvalCount;
      questionPauses += pending.questionCount;
      for (const item of pending.input) {
        answeredCallIds.add((item as { toolCallId: string }).toolCallId);
      }
      const next = await client.sessions.createTurnStream(session.id, { input: pending.input });
      for await (const { data } of next.withMetadata()) {
        events.push(data as GateStreamEvent);
      }
    }
    check(
      exercisedQuestionAndApproval(approvalPauses, questionPauses),
      `interrupted flow exercised AskUQ (${questionPauses}x) and approval (${approvalPauses}x)`,
    );
    const released = store.audits().filter((record) => record.outcome === "released");
    check(released.length === 1, "the interrupted demo flow still released exactly once");
    check(store.receiptCount() === 1, "exactly one receipt exists after reconnect");

    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          proof: "reconnect",
          pass: failures.length === 0,
          failures,
          sessionId: session.id,
          turnId,
          abortedAtSequence: lastSeq,
          resumedFromSequence: firstResumedSeq,
          stitchedEvents: stitched.length,
          persistedEvents: persistedIds.length,
          questionPauses,
          approvalPauses,
          stitchedTrace: stitched.map((event) => ({
            seq: event.seq,
            type: event.data.type,
            id: event.data.id ?? null,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await vault.close();
    db.close();
  }

  process.stdout.write(
    `reconnect: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((error) => {
  process.stderr.write(`reconnect: error: ${(error as Error).message}\n`);
  process.exit(1);
});

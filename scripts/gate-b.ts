#!/usr/bin/env node
// Gate B: boundary and canary checks over the PERSISTED evidence of a Gate A
// run. Everything here reads what the TrueForge server stored, refetched
// live — not what the client stream happened to show.
//
//   1. The canary email and canary free text appear nowhere in the persisted
//      event stream of the releasing session.
//   2. No tool.response carries raw-row shapes: sensitive column names as
//      keys, customer ids, email addresses, or phone patterns.
//   3. verifyReceipt PASSES on the bundle against the refetched events — the
//      same code path a stranger runs via the verify-receipt CLI.
//
// Usage: gate-b [bundle-path]   (default gate-a-bundle.json)

import { readFileSync, writeFileSync } from "node:fs";

import { CANARY } from "../src/vault/seed.js";
import { checkVaultResponses } from "../src/verify/boundary.js";
import { isSafeTrueForgeId } from "../src/verify/events.js";
import { loadLiveSessionEvidence } from "../src/verify/live.js";
import { verifyReceipt } from "../src/verify/verify.js";

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891";
const bundlePath = process.argv[2] ?? "gate-a-bundle.json";
const resultPath = process.env.RESULT_PATH ?? "gate-b-result.json";

const failures: string[] = [];
function check(condition: boolean, label: string): void {
  if (!condition) failures.push(label);
  process.stdout.write(`gate-b: ${condition ? "ok " : "FAIL"} ${label}\n`);
}

async function main(): Promise<void> {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
    evidence?: { sessionId: string; agentType: "inline"; turnIds: string[] };
    events?: unknown;
  };
  const evidence = bundle.evidence;
  if (
    evidence === undefined ||
    Object.keys(evidence).length !== 3 ||
    !isSafeTrueForgeId(evidence.sessionId) ||
    evidence.agentType !== "inline" ||
    !Array.isArray(evidence.turnIds) ||
    evidence.turnIds.length === 0 ||
    !evidence.turnIds.every(isSafeTrueForgeId)
  ) {
    throw new Error("bundle carries no valid evidence section — run gate-a first");
  }

  const fetched = await loadLiveSessionEvidence(baseUrl, evidence);
  check(fetched.ok, "persisted session evidence refetched completely and stayed stable");
  if (!fetched.ok) {
    throw new Error("detail" in fetched.result ? fetched.result.detail : fetched.result.outcome);
  }
  const serialized = JSON.stringify(fetched.events);

  check(!serialized.includes(CANARY.email), "canary email absent from persisted stream");
  check(!serialized.includes(CANARY.freeText), "canary free text absent from persisted stream");

  const boundary = checkVaultResponses(fetched.events);
  check(boundary.responseCount > 0, `Vault tool responses present (${boundary.responseCount})`);
  for (const failure of boundary.failures) check(false, failure);

  const verdict = verifyReceipt({ ...bundle, events: fetched.events });
  check(verdict.outcome === "pass", `verifyReceipt on refetched events -> ${verdict.outcome}`);

  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        gate: "B",
        pass: failures.length === 0,
        failures,
        sessionId: evidence.sessionId,
        eventCount: fetched.events.length,
        toolResponseCount: boundary.responseCount,
        verifyOutcome: verdict.outcome,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`gate-b: ${failures.length === 0 ? "PASS" : `FAIL (${failures.length})`}\n`);
  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((error) => {
  process.stderr.write(`gate-b: error: ${(error as Error).message}\n`);
  process.exit(1);
});

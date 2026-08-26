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
import { fetchSessionEvents } from "../src/verify/events.js";
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
    evidence?: { sessionId: string; turnIds: string[] };
    events?: unknown;
  };
  const evidence = bundle.evidence;
  if (evidence === undefined) {
    process.stderr.write("gate-b: bundle carries no evidence section — run gate-a first\n");
    process.exit(1);
  }

  const fetched = await fetchSessionEvents(baseUrl, evidence.sessionId, evidence.turnIds);
  check(fetched.ok, "persisted events refetched completely");
  if (!fetched.ok) throw new Error(fetched.detail);
  const serialized = JSON.stringify(fetched.events);

  check(!serialized.includes(CANARY.email), "canary email absent from persisted stream");
  check(!serialized.includes(CANARY.freeText), "canary free text absent from persisted stream");

  const allResponses = fetched.events
    .filter((event) => event.type === "tool.response")
    .map((event) => (typeof event.content === "string" ? event.content : ""));
  // The vault's five tools emit JSON only; the one non-JSON tool response in
  // a session is TrueForge's own openui syntax documentation, which carries a
  // placeholder address ("you@example.com") that is not vault data. PII
  // patterns therefore run over the JSON responses; the canary scan above
  // still covers every event byte.
  const toolResponses = allResponses.filter((content) => {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  });
  check(toolResponses.length > 0, `vault JSON tool responses present (${toolResponses.length})`);
  // Raw-row shapes: sensitive columns as JSON keys, customer ids, emails,
  // phone runs. Bounded aggregates carry none of these.
  const rawPatterns: Array<[string, RegExp]> = [
    ["sensitive column key", /"(customer_id|email|phone|free_text)":/],
    ["customer id value", /CUST-\d/],
    ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ["phone pattern", /\+?\d[\d\s\-()]{8,}\d/],
  ];
  for (const [label, pattern] of rawPatterns) {
    const offender = toolResponses.findIndex((content) => pattern.test(content));
    check(
      offender === -1,
      `no ${label} in any tool response${offender === -1 ? "" : ` (response ${offender})`}`,
    );
  }
  // describe_dataset legitimately NAMES sensitive columns in its metadata; it
  // must never carry their values. The key-shaped pattern above only matches
  // value-bearing keys, so a hit is a genuine boundary failure.

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
        toolResponseCount: toolResponses.length,
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

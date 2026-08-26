#!/usr/bin/env node
// verify-receipt: evidence command for Need-to-Know release receipts.
//
// Usage:
//   verify-receipt <receipt-file.json>
//   cat receipt.json | verify-receipt
//
// Exit codes:
//   0 — PASS: receipt is internally consistent and all checks passed
//   1 — FAIL: one or more checks failed (outcome printed to stdout)
//   2 — ERROR: could not read input (I/O error)
//
// This is an evidence command, not a receipt service or product API.
// It performs deterministic internal-consistency checks only:
//   - receipt fields are present and non-empty
//   - contract hash matches the recomputed candidate hash
//   - output hash matches the recomputed candidate output hash
//   - candidate passes the release contract policy
//   - receipt queryId and versions match the verified candidate
//   - canary values are absent from the released rows
//   - when the bundle names its TrueForge session (evidence): events are
//     REQUIRED — fetched live from the named session when TRUEFORGE_BASE_URL
//     is set (paginated, failing closed on partial fetch), else taken from
//     the embedded copy; a bundle with evidence and no events fails
//   - on the events: every gated tool call is requested AND granted by the
//     user (user.tool_approval status "allow") before it executes, no
//     duplicate approval requests, canary absent from the serialized stream
//
// It does NOT authenticate origin or verify external delivery; the session
// binding holds only as far as the TrueForge instance it fetches from.

import { readFileSync } from "node:fs";

import { fetchSessionEvents } from "./events.js";
import { verifyReceipt } from "./verify.js";

function readInput(args: string[]): string {
  const [filePath] = args;
  if (filePath !== undefined && filePath !== "-") {
    return readFileSync(filePath, "utf8");
  }
  // Read from stdin synchronously — file descriptor 0, not /dev/stdin,
  // which does not exist on Windows.
  return readFileSync(0, "utf8");
}

async function main(args: string[]): Promise<void> {
  let raw: string;
  try {
    raw = readInput(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify-receipt: could not read input: ${message}\n`);
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write("verify-receipt: input is not valid JSON\n");
    process.exit(1);
  }

  // When the bundle names its session and a TrueForge base URL is available,
  // verify against the events the server actually persisted, not the embedded
  // copy — the fetch fails closed on an unavailable or partial stream.
  const baseUrl = process.env.TRUEFORGE_BASE_URL;
  const bundle = parsed as { evidence?: { sessionId?: unknown; turnIds?: unknown } } | null;
  const evidence = bundle?.evidence;
  if (
    baseUrl !== undefined &&
    typeof evidence?.sessionId === "string" &&
    Array.isArray(evidence.turnIds) &&
    evidence.turnIds.every((turnId) => typeof turnId === "string")
  ) {
    const fetched = await fetchSessionEvents(baseUrl, evidence.sessionId, evidence.turnIds);
    if (!fetched.ok) {
      process.stdout.write(
        `verify-receipt: FAIL outcome=${fetched.reason} detail=${fetched.detail}\n`,
      );
      process.exit(1);
    }
    parsed = { ...(parsed as Record<string, unknown>), events: fetched.events };
    process.stdout.write(
      `verify-receipt: fetched ${fetched.events.length} persisted events from ${evidence.sessionId}\n`,
    );
  }

  const result = verifyReceipt(parsed);

  if (result.outcome === "pass") {
    process.stdout.write(
      `verify-receipt: PASS receipt=${result.receiptId} query=${result.queryId}\n`,
    );
    process.exit(0);
  } else {
    process.stdout.write(
      `verify-receipt: FAIL outcome=${result.outcome} detail=${result.detail}\n`,
    );
    process.exit(1);
  }
}

await main(process.argv.slice(2));

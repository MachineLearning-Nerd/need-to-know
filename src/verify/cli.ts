#!/usr/bin/env node
// verify-receipt: evidence command for Need-to-Know release receipts.
//
// Usage:
//   verify-receipt <receipt-file.json>
//   cat gate-a-bundle.json | verify-receipt
//
// Exit codes:
//   0 — PASS: all checks passed in the mode indicated on stderr
//   1 — FAIL: one or more checks failed (outcome printed to stdout)
//   2 — ERROR: could not read input (I/O error)
//
// This is an evidence command, not a receipt service or product API.
// It performs deterministic receipt and evidence checks:
//   - receipt fields are present and non-empty
//   - contract hash matches the recomputed candidate hash
//   - output hash matches the recomputed candidate output hash
//   - candidate passes the release contract policy
//   - receipt queryId and versions match the verified candidate
//   - canary values are absent from the released rows
//   - on the events: the full vault chain (prepare → validate → gated
//     release) with a single user grant in order, canary absent from the
//     serialized stream
//
// Two modes, chosen by TRUEFORGE_BASE_URL:
//   - live (set): the identified session is refetched from the server
//     (token-paginated, failing closed on partials) and the bundle's turn
//     list must equal the session's actual turns.
//   - offline (unset): the bundle's embedded events are checked instead.
//     Weaker — embedded events come from the same party as the receipt —
//     and announced on stderr so a pass cannot masquerade as live.
//
// It does NOT verify external delivery; the live binding holds only as far
// as the configured TrueForge instance.

import { readFileSync } from "node:fs";

import { verifyLiveReceipt } from "./live.js";
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

  const baseUrl = process.env.TRUEFORGE_BASE_URL;
  let result: Awaited<ReturnType<typeof verifyLiveReceipt>>;
  if (baseUrl === undefined || baseUrl.length === 0) {
    process.stderr.write(
      "verify-receipt: offline mode — checking the bundle's embedded events; set TRUEFORGE_BASE_URL to authenticate against the live session\n",
    );
    result = verifyReceipt(parsed);
  } else {
    result = await verifyLiveReceipt(parsed, baseUrl);
  }

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

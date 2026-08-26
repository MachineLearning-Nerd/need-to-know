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
//   - canary values are absent from the released rows
//   - when events are present: every gated tool call is requested AND granted
//     by the user (user.tool_approval status "allow") before it executes, no
//     duplicate approval requests, canary absent from the serialized stream
//
// It does NOT authenticate origin, verify external delivery, or guarantee that
// the persisted-event witness and the local candidate are from the same session.

import { readFileSync } from "node:fs";

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

function main(args: string[]): void {
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

main(process.argv.slice(2));

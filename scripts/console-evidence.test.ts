// The console's evidence rail parses vault tool responses out of the thread;
// this is the one piece of logic-heavy client code, so it is covered here by
// the root suite (the console workspace deliberately has no test runner).
// Payload shapes mirror src/server/handlers.ts returns exactly.
import { describe, expect, it } from "vitest";

import { extractEvidence } from "../console/src/evidence.js";

const call = (toolName: string, result: unknown) => ({
  role: "assistant",
  content: [{ type: "tool-call", toolName, toolCallId: "x", args: {}, argsText: "{}", result }],
});

const prepA = call("prepare_analysis", {
  queryId: "q-A",
  candidate: {
    purpose: "weekly support trend",
    audience: "support leadership",
    columns: ["week", "region", "ticket_count"],
  },
  suppressedCells: 2,
});
const validateA = call("validate_release", {
  queryId: "q-A",
  status: "approved",
  contractHash: "c".repeat(64),
  outputHash: "o".repeat(64),
  findingCodes: "",
  openui: "x",
});
const releaseA = call("release_result", {
  receipt: {
    receiptId: "r-A",
    queryId: "q-A",
    contractHash: "c".repeat(64),
    outputHash: "o".repeat(64),
    datasetVersion: "d1",
    policyVersion: "p1",
  },
  columns: [],
  rows: [],
  openui: "x",
});
const chartA = call("render_safe_chart", { queryId: "q-A", openui: "x" });
const prepB = call("prepare_analysis", {
  queryId: "q-B",
  candidate: {
    purpose: "weekly support trend",
    audience: "support leadership",
    columns: ["week", "ticket_count"],
  },
  suppressedCells: 0,
});
const prepDenied = call("prepare_analysis", {
  error: "mission_not_authorized",
  findingCodes: "purpose_not_allowed",
});

describe("console evidence extraction", () => {
  it("follows the normal flow: mission, verdict, receipt, chart", () => {
    const evidence = extractEvidence([prepA, validateA, releaseA, chartA]);
    expect(evidence.queryId).toBe("q-A");
    expect(evidence.suppressedCells).toBe(2);
    expect(evidence.verdict).toBe("approved");
    expect(evidence.receiptId).toBe("r-A");
    expect(evidence.datasetVersion).toBe("d1");
    expect(evidence.chartRendered).toBe(true);
  });

  it("resets everything when a new preparation starts", () => {
    const evidence = extractEvidence([prepA, validateA, releaseA, chartA, prepB]);
    expect(evidence.queryId).toBe("q-B");
    expect(evidence.suppressedCells).toBe(0);
    expect(evidence.receiptId).toBeUndefined();
    expect(evidence.verdict).toBeUndefined();
    expect(evidence.chartRendered).toBeUndefined();
  });

  it("never masks a fresh mission denial behind an old receipt", () => {
    const evidence = extractEvidence([prepA, validateA, releaseA, prepDenied]);
    expect(evidence.denialCode).toBe("mission_not_authorized");
    expect(evidence.findingCodes).toBe("purpose_not_allowed");
    expect(evidence.receiptId).toBeUndefined();
  });

  it("ignores validate, release, and chart responses for an earlier query", () => {
    const evidence = extractEvidence([prepA, prepB, validateA, releaseA, chartA]);
    expect(evidence.queryId).toBe("q-B");
    expect(evidence.verdict).toBeUndefined();
    expect(evidence.receiptId).toBeUndefined();
    expect(evidence.chartRendered).toBeUndefined();
  });

  it("keeps the denial detail on a release denial", () => {
    const denied = call("release_result", { error: "release_denied", detail: "hash_mismatch" });
    const evidence = extractEvidence([prepA, validateA, denied]);
    expect(evidence.denialCode).toBe("release_denied: hash_mismatch");
  });

  it("decodes the MCP text envelope form of a tool result", () => {
    const enveloped = call("validate_release", {
      content: [
        {
          type: "text",
          text: JSON.stringify({ queryId: "q-A", status: "denied", findingCodes: "small_cell" }),
        },
      ],
      isError: false,
    });
    const evidence = extractEvidence([prepA, enveloped]);
    expect(evidence.verdict).toBe("denied");
    expect(evidence.findingCodes).toBe("small_cell");
  });
});

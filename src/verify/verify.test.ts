import { beforeAll, describe, expect, it } from "vitest";
import { validateRelease } from "../contract/validate.js";
import { createVaultHandlers } from "../server/handlers.js";
import { createVaultStore } from "../server/store.js";
import { openVaultDatabase, type VaultDatabase } from "../vault/database.js";
import { CANARY } from "../vault/seed.js";
import {
  TF_EVENT_TOOL_APPROVAL_REQUIRED,
  TF_EVENT_TOOL_RESPONSE,
  TF_EVENT_USER_TOOL_APPROVAL,
} from "./receipt.js";
import { verifyReceipt } from "./verify.js";

// Helpers to build a minimal valid VerifiableReceipt from the vault.
let db: VaultDatabase;

beforeAll(() => {
  db = openVaultDatabase();
});

// afterAll: database is opened once and GC'd — no StatementSync.close() in Node 24.

function buildValidReceipt() {
  const store = createVaultStore();
  const handlers = createVaultHandlers(db, store);

  const prepResult = handlers.prepareAnalysis({
    purpose: "weekly support trend",
    audience: "support leadership",
    dimensions: ["week", "region"],
    metric: "ticket_count",
  });
  if (prepResult.isError) throw new Error("prepare failed in test setup");
  const prepBody = JSON.parse(prepResult.content[0]?.text ?? "{}") as {
    queryId: string;
    candidate: unknown;
  };

  const valResult = handlers.validateRelease({ queryId: prepBody.queryId });
  if (valResult.isError) throw new Error("validate failed in test setup");
  const valBody = JSON.parse(valResult.content[0]?.text ?? "{}") as {
    status: string;
    contractHash: string;
    outputHash: string;
  };
  if (valBody.status !== "approved") throw new Error("expected approved in test setup");

  const relResult = handlers.releaseResult({
    queryId: prepBody.queryId,
    contractHash: valBody.contractHash,
    outputHash: valBody.outputHash,
  });
  if (relResult.isError) throw new Error("release failed in test setup");
  const relBody = JSON.parse(relResult.content[0]?.text ?? "{}") as {
    receipt: {
      receiptId: string;
      queryId: string;
      contractHash: string;
      outputHash: string;
      datasetVersion: string;
      policyVersion: string;
    };
  };

  return { verifiable: { receipt: relBody.receipt, candidate: prepBody.candidate }, store };
}

// Minimal TrueForge-shaped event log for approval-ordering tests.
function approvalEvents(overrides?: {
  skipApproval?: boolean;
  duplicateApproval?: boolean;
  responseBeforeApproval?: boolean;
  includeCanaryEmail?: boolean;
  includeCanaryText?: boolean;
}) {
  const events: Array<Record<string, unknown>> = [];
  if (!overrides?.responseBeforeApproval && !overrides?.skipApproval) {
    const approval: Record<string, unknown> = {
      type: TF_EVENT_TOOL_APPROVAL_REQUIRED,
      tool_calls: [{ id: "tc-1", source_event_id: "evt-1" }],
    };
    if (overrides?.includeCanaryEmail) {
      approval.debug = CANARY.email;
    }
    if (overrides?.includeCanaryText) {
      approval.debug = CANARY.freeText;
    }
    events.push(approval);
    if (overrides?.duplicateApproval) {
      events.push({
        type: TF_EVENT_TOOL_APPROVAL_REQUIRED,
        tool_calls: [{ id: "tc-1", source_event_id: "evt-1" }],
      });
    }
    events.push({
      type: TF_EVENT_USER_TOOL_APPROVAL,
      tool_call_id: "tc-1",
      approval: { status: "allow" },
    });
  }
  if (overrides?.responseBeforeApproval) {
    // response arrives before any approval
    events.push({ type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-1" });
    events.push({
      type: TF_EVENT_TOOL_APPROVAL_REQUIRED,
      tool_calls: [{ id: "tc-1", source_event_id: "evt-1" }],
    });
  } else {
    events.push({ type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-1" });
  }
  return events;
}

// ---- Positive tests --------------------------------------------------------

describe("verify-receipt: positive cases", () => {
  it("passes a well-formed receipt with matching hashes", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt(verifiable);
    expect(result.outcome).toBe("pass");
    if (result.outcome === "pass") {
      expect(result.receiptId).toMatch(/^r-\d+$/);
      expect(result.queryId).toMatch(/^q-\d+$/);
    }
  });

  it("passes with a minimal valid event log (approval before response)", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, events: approvalEvents() });
    expect(result.outcome).toBe("pass");
  });

  it("passes when events field is omitted entirely", () => {
    const { verifiable } = buildValidReceipt();
    const { events: _events, ...withoutEvents } = verifiable as typeof verifiable & {
      events?: unknown;
    };
    const result = verifyReceipt(withoutEvents);
    expect(result.outcome).toBe("pass");
  });

  it("passes when events field is null (treated as absent)", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, events: null });
    expect(result.outcome).toBe("pass");
  });
});

// ---- Negative tests: receipt structure -------------------------------------

describe("verify-receipt: receipt structure failures", () => {
  it("returns receipt_malformed for null input", () => {
    expect(verifyReceipt(null).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed for a bare string", () => {
    expect(verifyReceipt("bad").outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed when receipt field is missing", () => {
    const { verifiable } = buildValidReceipt();
    const { receipt: _receipt, ...noReceipt } = verifiable;
    expect(verifyReceipt(noReceipt).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed when candidate field is missing", () => {
    const { verifiable } = buildValidReceipt();
    const { candidate: _candidate, ...noCandidate } = verifiable;
    expect(verifyReceipt(noCandidate).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed for extra keys on the top-level object", () => {
    const { verifiable } = buildValidReceipt();
    expect(verifyReceipt({ ...verifiable, extra: "injected" }).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed when any receipt field is missing", () => {
    const { verifiable } = buildValidReceipt();
    const { contractHash: _ch, ...noHash } = verifiable.receipt;
    expect(verifyReceipt({ ...verifiable, receipt: noHash }).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed when any receipt field is empty string", () => {
    const { verifiable } = buildValidReceipt();
    expect(
      verifyReceipt({
        ...verifiable,
        receipt: { ...verifiable.receipt, receiptId: "" },
      }).outcome,
    ).toBe("receipt_malformed");
  });
});

// ---- Negative tests: hash mismatches ---------------------------------------

describe("verify-receipt: hash mismatch failures", () => {
  it("returns contract_hash_mismatch when contractHash is tampered", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      receipt: { ...verifiable.receipt, contractHash: "0".repeat(64) },
    });
    expect(result.outcome).toBe("contract_hash_mismatch");
  });

  it("returns output_hash_mismatch when outputHash is tampered", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      receipt: { ...verifiable.receipt, outputHash: "a".repeat(64) },
    });
    expect(result.outcome).toBe("output_hash_mismatch");
  });

  it("returns candidate_denied when candidate fails policy (bad purpose)", () => {
    const { verifiable } = buildValidReceipt();
    const candidate = verifiable.candidate as Record<string, unknown>;
    const result = verifyReceipt({
      ...verifiable,
      candidate: { ...candidate, purpose: "export customer emails" },
    });
    // Re-validates against the stored receipt hashes — the candidate no longer
    // matches the hashes either, but policy denial fires first.
    expect(["candidate_denied", "contract_hash_mismatch", "output_hash_mismatch"]).toContain(
      result.outcome,
    );
  });

  it("returns candidate_malformed when candidate has unknown keys", () => {
    const { verifiable } = buildValidReceipt();
    const candidate = verifiable.candidate as Record<string, unknown>;
    const result = verifyReceipt({
      ...verifiable,
      candidate: { ...candidate, injected: "evil" },
    });
    expect(result.outcome).toBe("candidate_malformed");
  });

  // The hashes bind the receipt to the candidate's content; queryId and the
  // two versions bind it to the candidate's identity. A receipt naming the
  // wrong query or versions must not verify even with perfect hashes.
  it("returns receipt_metadata_mismatch when the receipt names another query", () => {
    const { verifiable } = buildValidReceipt();
    const wrongQuery = verifyReceipt({
      ...verifiable,
      receipt: { ...verifiable.receipt, queryId: "q-999" },
    });
    expect(wrongQuery.outcome).toBe("receipt_metadata_mismatch");
    const wrongVersion = verifyReceipt({
      ...verifiable,
      receipt: { ...verifiable.receipt, datasetVersion: "forged-v9" },
    });
    expect(wrongVersion.outcome).toBe("receipt_metadata_mismatch");
  });

  it("returns candidate_malformed when candidate is null", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, candidate: null });
    expect(result.outcome).toBe("candidate_malformed");
  });
});

// ---- Negative tests: canary containment ------------------------------------

describe("verify-receipt: canary containment failures", () => {
  // The canary_in_rows branch is defence in depth, and today it is
  // unreachable through an approved candidate: the contract pins every string
  // field a canary could ride — dimension values and provenance.queryId to
  // domains, versions to compiled-in constants, purpose and audience to the
  // mission — so every carrier we could construct (region value,
  // datasetVersion, provenance.queryId) is denied before the scan runs. The
  // scan stays because a future contract relaxation must not silently open a
  // canary path; these tests pin the denials that currently stand in front of
  // it, for both canary values.
  it("returns candidate_denied when the canary free text is smuggled into a row", () => {
    const { verifiable } = buildValidReceipt();
    const candidate = verifiable.candidate as Record<string, unknown>;
    const rows = (candidate.rows as Array<Record<string, unknown>>).map((row, index) =>
      index === 0 ? { ...row, region: CANARY.freeText } : row,
    );
    const tampered = { ...candidate, rows };
    expect(validateRelease(tampered).status).toBe("denied");
    // A policy denial short-circuits before hash comparison, so the original
    // receipt hashes serve unchanged.
    const result = verifyReceipt({ ...verifiable, candidate: tampered });
    expect(result.outcome).toBe("candidate_denied");
    if (result.outcome === "candidate_denied") {
      expect(result.detail).toContain("value_out_of_domain");
    }
  });

  it("returns candidate_denied when the canary email is smuggled into a row", () => {
    const { verifiable } = buildValidReceipt();
    const candidate = verifiable.candidate as Record<string, unknown>;
    const rows = (candidate.rows as Array<Record<string, unknown>>).map((row, index) =>
      index === 0 ? { ...row, region: CANARY.email } : row,
    );
    const tampered = { ...candidate, rows };
    expect(validateRelease(tampered).status).toBe("denied");
    const result = verifyReceipt({ ...verifiable, candidate: tampered });
    expect(result.outcome).toBe("candidate_denied");
  });

  it("returns canary_in_events when the canary email appears in events", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ includeCanaryEmail: true });
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("canary_in_events");
  });

  it("returns canary_in_events when the canary free_text appears in events", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ includeCanaryText: true });
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("canary_in_events");
  });
});

// ---- Negative tests: event ordering ----------------------------------------

describe("verify-receipt: event ordering failures", () => {
  it("returns approval_missing when no tool.approval_required event is present", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ skipApproval: true });
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("approval_missing");
  });

  it("returns release_before_approval when tool.response precedes approval", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ responseBeforeApproval: true });
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("release_before_approval");
  });

  it("returns duplicate_approval_event for duplicate tool call IDs in approval events", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ duplicateApproval: true });
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("duplicate_approval_event");
  });

  it("returns events_malformed when events is a non-array", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, events: { type: "not-an-array" } });
    expect(result.outcome).toBe("events_malformed");
  });

  it("returns events_malformed when events contains a non-record element", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, events: ["string-element"] });
    expect(result.outcome).toBe("events_malformed");
  });

  // The agent asking is not the user allowing: a transcript where the user
  // explicitly denied — or never answered — and the tool ran anyway is the
  // exact evidence this verifier exists to reject.
  it("returns user_approval_missing when the user denied and the tool ran anyway", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: [
        { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-1" }] },
        { type: TF_EVENT_USER_TOOL_APPROVAL, tool_call_id: "tc-1", approval: { status: "deny" } },
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-1" },
      ],
    });
    expect(result.outcome).toBe("user_approval_missing");
  });

  // trueforge 0.1.4 does not persist the user's decision, so a stream with no
  // user.tool_approval events falls back to structural evidence: a denial
  // leaves its error marker on the gated response and must still fail.
  it("returns user_approval_missing when the gated response records a denial", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: [
        { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-1" }] },
        {
          type: TF_EVENT_TOOL_RESPONSE,
          tool_call_id: "tc-1",
          content: '{"error":"User denied tool call: no reason provided"}',
        },
      ],
    });
    expect(result.outcome).toBe("user_approval_missing");
  });

  // Only gated calls need approval-before-response: a real session answers
  // describe_dataset and prepare_analysis long before release_result asks.
  it("passes a full-session transcript with ungated responses before the approval", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: [
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-describe" },
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-prepare" },
        { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-release" }] },
        {
          type: TF_EVENT_USER_TOOL_APPROVAL,
          tool_call_id: "tc-release",
          approval: { status: "allow" },
        },
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-release" },
      ],
    });
    expect(result.outcome).toBe("pass");
  });

  // Ordering must be judged on real indices into events: a filtered view
  // shifted positions leftward, so an unrecognised event type false-failed a
  // correctly ordered stream. Real TrueForge streams carry many types the
  // verifier does not interpret (model.message, turn.done, ...).
  it("passes a correctly ordered stream that contains unrecognised event types", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: [
        { type: "model.message", content: "planning" },
        { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-1" }] },
        { type: "turn.paused" },
        { type: TF_EVENT_USER_TOOL_APPROVAL, tool_call_id: "tc-1", approval: { status: "allow" } },
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-1" },
        { type: "turn.done" },
      ],
    });
    expect(result.outcome).toBe("pass");
  });

  // A record without a string type is not a TrueForge event; skipping it
  // would let evidence hide inside the stream unexamined.
  it("returns events_malformed for an event without a string type", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: [
        { note: "no type field" },
        { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-1" }] },
        { type: TF_EVENT_USER_TOOL_APPROVAL, tool_call_id: "tc-1", approval: { status: "allow" } },
        { type: TF_EVENT_TOOL_RESPONSE, tool_call_id: "tc-1" },
      ],
    });
    expect(result.outcome).toBe("events_malformed");
  });
});

// ---- Session binding: evidence requires events ------------------------------

describe("verify-receipt: session-bound evidence", () => {
  // A session-bound stream must WITNESS the receipt: the gated post-approval
  // response carries the receipt id and both hashes, the way a real
  // trueforge release_result response does.
  function boundEvents(verifiable: ReturnType<typeof buildValidReceipt>["verifiable"]) {
    const { receiptId, contractHash, outputHash } = verifiable.receipt;
    return [
      { type: TF_EVENT_TOOL_APPROVAL_REQUIRED, tool_calls: [{ id: "tc-1" }] },
      { type: TF_EVENT_USER_TOOL_APPROVAL, tool_call_id: "tc-1", approval: { status: "allow" } },
      {
        type: TF_EVENT_TOOL_RESPONSE,
        tool_call_id: "tc-1",
        content: JSON.stringify({ receipt: { receiptId, contractHash, outputHash } }),
      },
    ];
  }

  it("passes a bundle whose evidence and events agree", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", turnIds: ["turn-1"] },
      events: boundEvents(verifiable).map((event) => ({
        ...event,
        session_id: "sess-1",
        turn_id: "turn-1",
      })),
    });
    expect(result.outcome).toBe("pass");
  });

  it("returns events_missing when evidence names a session but no events exist", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", turnIds: ["turn-1"] },
    });
    expect(result.outcome).toBe("events_missing");
  });

  it("returns receipt_unwitnessed when no gated response carries the receipt", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const witness = events[2] as { content: string };
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", turnIds: ["turn-1"] },
      events: [events[0], events[1], { ...events[2], content: witness.content.slice(0, 20) }],
    });
    expect(result.outcome).toBe("receipt_unwitnessed");
  });

  it("returns session_mismatch when an event names another session or turn", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const otherSession = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", turnIds: ["turn-1"] },
      events: [{ ...events[0], session_id: "sess-2" }, ...events.slice(1)],
    });
    expect(otherSession.outcome).toBe("session_mismatch");
    const otherTurn = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", turnIds: ["turn-1"] },
      events: [{ ...events[0], turn_id: "turn-9" }, ...events.slice(1)],
    });
    expect(otherTurn.outcome).toBe("session_mismatch");
  });

  it("returns receipt_malformed for malformed evidence", () => {
    const { verifiable } = buildValidReceipt();
    for (const evidence of [
      { sessionId: "", turnIds: ["turn-1"] },
      { sessionId: "sess-1", turnIds: [] },
      { sessionId: "sess-1", turnIds: ["turn-1"], extra: true },
      { sessionId: "sess-1" },
      "sess-1",
    ]) {
      const result = verifyReceipt({ ...verifiable, evidence, events: boundEvents(verifiable) });
      expect(result.outcome, JSON.stringify(evidence)).toBe("receipt_malformed");
    }
  });
});

// ---- Fail-closed: unexpected input shapes ----------------------------------

describe("verify-receipt: fail-closed on adversarial input", () => {
  it("returns receipt_malformed for an empty object", () => {
    expect(verifyReceipt({}).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed for an array at the top level", () => {
    expect(verifyReceipt([]).outcome).toBe("receipt_malformed");
  });

  it("returns receipt_malformed for a number", () => {
    expect(verifyReceipt(42).outcome).toBe("receipt_malformed");
  });

  it("never throws on any input shape", () => {
    const hostile = [
      null,
      undefined,
      42,
      "string",
      [],
      {},
      { receipt: null, candidate: null },
      { receipt: Object.create(null), candidate: null },
      Object.assign(Object.create(null), { receipt: {}, candidate: {} }),
    ];
    for (const input of hostile) {
      expect(() => verifyReceipt(input)).not.toThrow();
      const result = verifyReceipt(input);
      expect(result.outcome).not.toBe("pass");
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ReleaseCandidate, validateRelease } from "../contract/validate.js";
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

afterAll(() => {
  db.close();
});

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
    candidate: ReleaseCandidate;
    suppressedCells: number;
  };

  const valResult = handlers.validateRelease({ queryId: prepBody.queryId });
  if (valResult.isError) throw new Error("validate failed in test setup");
  const valBody = JSON.parse(valResult.content[0]?.text ?? "{}") as {
    queryId: string;
    status: string;
    contractHash: string;
    outputHash: string;
    findingCodes: string;
    openui: string;
  };
  if (valBody.status !== "approved") throw new Error("expected approved in test setup");

  const relResult = handlers.releaseResult({
    queryId: prepBody.queryId,
    purpose: prepBody.candidate.purpose,
    audience: prepBody.candidate.audience,
    columns: [...prepBody.candidate.columns],
    suppressedCells: prepBody.suppressedCells,
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
    columns: string[];
    rows: Array<Record<string, string | number>>;
    openui: string;
  };

  const releaseTuple = {
    queryId: prepBody.queryId,
    purpose: prepBody.candidate.purpose,
    audience: prepBody.candidate.audience,
    columns: [...prepBody.candidate.columns],
    suppressedCells: prepBody.suppressedCells,
    contractHash: valBody.contractHash,
    outputHash: valBody.outputHash,
  };
  const events = [
    {
      type: "model.message",
      id: "evt-prepare",
      thread_id: "main",
      tool_calls: [
        {
          id: "tc-prepare",
          type: "function",
          function: {
            name: "prepare_analysis",
            arguments: JSON.stringify({
              purpose: prepBody.candidate.purpose,
              audience: prepBody.candidate.audience,
              dimensions: prepBody.candidate.queryPlan.dimensions,
              metric: prepBody.candidate.queryPlan.metric,
            }),
          },
          tool_info: {
            type: "mcp",
            name: "prepare_analysis",
            server_id: "vault",
            server_name: "vault",
          },
        },
      ],
    },
    {
      type: TF_EVENT_TOOL_RESPONSE,
      thread_id: "main",
      tool_call_id: "tc-prepare",
      content: JSON.stringify(prepBody),
    },
    {
      type: "model.message",
      id: "evt-validate",
      thread_id: "main",
      tool_calls: [
        {
          id: "tc-validate",
          type: "function",
          function: {
            name: "validate_release",
            arguments: JSON.stringify({ queryId: prepBody.queryId }),
          },
          tool_info: {
            type: "mcp",
            name: "validate_release",
            server_id: "vault",
            server_name: "vault",
          },
        },
      ],
    },
    {
      type: TF_EVENT_TOOL_RESPONSE,
      thread_id: "main",
      tool_call_id: "tc-validate",
      content: JSON.stringify(valBody),
    },
    {
      type: "model.message",
      id: "evt-release",
      thread_id: "main",
      tool_calls: [
        {
          id: "tc-release",
          type: "function",
          function: { name: "release_result", arguments: JSON.stringify(releaseTuple) },
          tool_info: {
            type: "mcp",
            name: "release_result",
            server_id: "vault",
            server_name: "vault",
          },
        },
      ],
    },
    {
      type: TF_EVENT_TOOL_APPROVAL_REQUIRED,
      thread_id: "main",
      tool_calls: [{ id: "tc-release", source_event_id: "evt-release" }],
    },
    {
      type: "turn.created",
      input: [
        {
          type: TF_EVENT_USER_TOOL_APPROVAL,
          thread_id: "main",
          tool_call_id: "tc-release",
          approval: { status: "allow" },
        },
      ],
    },
    {
      type: TF_EVENT_TOOL_RESPONSE,
      thread_id: "main",
      tool_call_id: "tc-release",
      content: JSON.stringify(relBody),
    },
  ];
  return {
    verifiable: {
      receipt: relBody.receipt,
      candidate: prepBody.candidate,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events,
    },
    store,
  };
}

function releaseBodyOf(verifiable: ReturnType<typeof buildValidReceipt>["verifiable"]) {
  const candidate = verifiable.candidate as {
    columns: readonly string[];
    rows: ReadonlyArray<Readonly<Record<string, string | number>>>;
  };
  return {
    receipt: verifiable.receipt,
    columns: candidate.columns,
    rows: candidate.rows.map((row) =>
      Object.fromEntries(candidate.columns.map((column) => [column, row[column]])),
    ),
  };
}

// Minimal TrueForge-shaped event log for approval-ordering tests.
function approvalEvents(
  overrides:
    | {
        skipApproval?: boolean;
        duplicateApproval?: boolean;
        responseBeforeApproval?: boolean;
        includeCanaryEmail?: boolean;
        includeCanaryText?: boolean;
      }
    | undefined,
  verifiable: ReturnType<typeof buildValidReceipt>["verifiable"],
) {
  const events = structuredClone(verifiable.events) as Array<Record<string, unknown>>;
  const gateIndex = events.findIndex((event) => event.type === TF_EVENT_TOOL_APPROVAL_REQUIRED);
  const responseIndex = events.findIndex(
    (event) => event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release",
  );
  const gate = events[gateIndex];
  if (gate !== undefined) {
    if (overrides?.includeCanaryEmail) {
      gate.debug = CANARY.email;
    }
    if (overrides?.includeCanaryText) {
      gate.debug = CANARY.freeText;
    }
  }
  if (overrides?.skipApproval && gateIndex >= 0) events.splice(gateIndex, 1);
  if (overrides?.duplicateApproval && gate !== undefined) {
    events.splice(gateIndex + 1, 0, structuredClone(gate));
  }
  if (overrides?.responseBeforeApproval && gateIndex >= 0 && responseIndex >= 0) {
    const [response] = events.splice(responseIndex, 1);
    if (response !== undefined) events.splice(gateIndex, 0, response);
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
      expect(result.receiptId).toMatch(/^r-[0-9a-f-]{36}$/);
      expect(result.queryId).toMatch(/^q-[0-9a-f-]{36}$/);
    }
  });

  it("passes with a minimal valid event log (approval before response)", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      events: approvalEvents(undefined, verifiable),
    });
    expect(result.outcome).toBe("pass");
  });

  it("fails closed when evidence and events are omitted", () => {
    const { verifiable } = buildValidReceipt();
    const { events: _events, evidence: _evidence, ...withoutEvidence } = verifiable;
    const result = verifyReceipt(withoutEvidence);
    expect(result.outcome).toBe("receipt_malformed");
  });

  it("fails closed when events is null", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({ ...verifiable, events: null });
    expect(result.outcome).toBe("events_malformed");
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
    const events = approvalEvents({ includeCanaryEmail: true }, verifiable);
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("canary_in_events");
  });

  it("returns canary_in_events when the canary free_text appears in events", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ includeCanaryText: true }, verifiable);
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("canary_in_events");
  });
});

// ---- Negative tests: event ordering ----------------------------------------

describe("verify-receipt: event ordering failures", () => {
  it("returns approval_missing when no tool.approval_required event is present", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ skipApproval: true }, verifiable);
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("approval_missing");
  });

  it("returns release_before_approval when tool.response precedes approval", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ responseBeforeApproval: true }, verifiable);
    const result = verifyReceipt({ ...verifiable, events });
    expect(result.outcome).toBe("release_before_approval");
  });

  it("returns duplicate_approval_event for duplicate tool call IDs in approval events", () => {
    const { verifiable } = buildValidReceipt();
    const events = approvalEvents({ duplicateApproval: true }, verifiable);
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
    const events = (verifiable.events as Array<Record<string, unknown>>).map((event) =>
      event.type === "turn.created"
        ? {
            ...event,
            input: [
              {
                type: TF_EVENT_USER_TOOL_APPROVAL,
                thread_id: "main",
                tool_call_id: "tc-release",
                approval: { status: "deny" },
              },
            ],
          }
        : event,
    );
    const result = verifyReceipt({
      ...verifiable,
      events,
    });
    expect(result.outcome).toBe("user_approval_missing");
  });

  // trueforge 0.1.4 does not persist the user's decision, so a stream with no
  // user.tool_approval events falls back to structural evidence: a denial
  // leaves its error marker on the gated response and must still fail.
  it("returns user_approval_missing when the gated response records a denial", () => {
    const { verifiable } = buildValidReceipt();
    const events = (verifiable.events as Array<Record<string, unknown>>)
      .filter((event) => event.type !== "turn.created")
      .map((event) =>
        event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release"
          ? { ...event, content: '{"error":"User denied tool call: no reason provided"}' }
          : event,
      );
    const result = verifyReceipt({
      ...verifiable,
      events,
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
        ...(verifiable.events as Array<Record<string, unknown>>),
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
    const valid = verifiable.events as Array<Record<string, unknown>>;
    const result = verifyReceipt({
      ...verifiable,
      events: [valid[0], { type: "turn.paused" }, ...valid.slice(1), { type: "turn.done" }],
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
    return structuredClone(verifiable.events) as Array<Record<string, unknown>>;
  }

  it("passes a bundle whose evidence and events agree", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: boundEvents(verifiable).map((event) => ({
        ...event,
        session_id: "sess-1",
        turn_id: "turn-1",
      })),
    });
    expect(result.outcome).toBe("pass");
  });

  it("returns receipt_malformed when evidence names a session but events are omitted", () => {
    const { verifiable } = buildValidReceipt();
    const { events: _events, ...withoutEvents } = verifiable;
    const result = verifyReceipt({
      ...withoutEvents,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
    });
    expect(result.outcome).toBe("receipt_malformed");
  });

  it("returns receipt_unwitnessed when no gated response carries the receipt", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const responseIndex = events.findIndex(
      (event) => event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release",
    );
    const witness = events[responseIndex] as { content: string };
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: events.map((event, index) =>
        index === responseIndex ? { ...event, content: witness.content.slice(0, 20) } : event,
      ),
    });
    expect(result.outcome).toBe("receipt_unwitnessed");
  });

  it("requires an exact receipt object in the release response", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const result = verifyReceipt({
      ...verifiable,
      receipt: { ...verifiable.receipt, receiptId: "r" },
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events,
    });
    expect(result.outcome).toBe("receipt_unwitnessed");
  });

  it("requires the exact hash-bound columns and rows in the release response", () => {
    const { verifiable } = buildValidReceipt();
    const body = releaseBodyOf(verifiable);
    const firstRow = body.rows[0];
    if (firstRow === undefined) throw new Error("fixture has no released rows");
    const alteredRows = [{ ...firstRow, ticket_count: 999_999 }, ...body.rows.slice(1)];
    const mutations = [
      { ...body, rows: alteredRows },
      { ...body, columns: [...body.columns].reverse() },
      { ...body, rows: [...body.rows].reverse() },
      { ...body, extra: "unverified" },
    ];

    for (const mutation of mutations) {
      const events = boundEvents(verifiable).map((event) =>
        event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release"
          ? { ...event, content: JSON.stringify(mutation) }
          : event,
      );
      expect(verifyReceipt({ ...verifiable, events }).outcome).toBe("receipt_unwitnessed");
    }
  });

  it("rejects altered vault-authored decision and receipt cards", () => {
    const { verifiable } = buildValidReceipt();
    const alteredDecision = structuredClone(verifiable.events).map((event) => {
      if (event.type !== TF_EVENT_TOOL_RESPONSE || event.tool_call_id !== "tc-validate")
        return event;
      const body = JSON.parse(event.content) as { openui: string };
      return { ...event, content: JSON.stringify({ ...body, openui: `${body.openui} stale` }) };
    });
    expect(verifyReceipt({ ...verifiable, events: alteredDecision }).outcome).toBe(
      "approval_source_mismatch",
    );

    const alteredReceipt = structuredClone(verifiable.events).map((event) => {
      if (event.type !== TF_EVENT_TOOL_RESPONSE || event.tool_call_id !== "tc-release")
        return event;
      const body = JSON.parse(event.content) as { openui: string };
      return { ...event, content: JSON.stringify({ ...body, openui: `${body.openui} stale` }) };
    });
    expect(verifyReceipt({ ...verifiable, events: alteredReceipt }).outcome).toBe(
      "receipt_unwitnessed",
    );
  });

  it("rejects approval evidence that does not resolve to release_result", () => {
    const { verifiable } = buildValidReceipt();
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: boundEvents(verifiable).map((event) =>
        event.type === TF_EVENT_TOOL_APPROVAL_REQUIRED
          ? { ...event, tool_calls: [{ id: "tc-release", source_event_id: "evt-missing" }] }
          : event,
      ),
    });
    expect(result.outcome).toBe("approval_source_mismatch");
  });

  it("requires release_result to come from the named Vault MCP server", () => {
    const { verifiable } = buildValidReceipt();
    const invalidInfo = [
      undefined,
      { type: "builtin", name: "release_result", server_id: "vault", server_name: "vault" },
      { type: "mcp", name: "other", server_id: "vault", server_name: "vault" },
      { type: "mcp", name: "release_result", server_id: "not-vault", server_name: "vault" },
      { type: "mcp", name: "release_result", server_id: "vault", server_name: "not-vault" },
    ];

    for (const toolInfo of invalidInfo) {
      const events = boundEvents(verifiable).map((event) => {
        if (event.type !== "model.message" || event.id !== "evt-release") return event;
        const calls = event.tool_calls as Array<Record<string, unknown>>;
        return { ...event, tool_calls: [{ ...calls[0], tool_info: toolInfo }] };
      });
      expect(verifyReceipt({ ...verifiable, events }).outcome).toBe("approval_source_mismatch");
    }
  });

  it("requires the persisted prepare and validate chain", () => {
    const { verifiable } = buildValidReceipt();
    for (const omittedCallId of ["tc-prepare", "tc-validate"]) {
      const events = boundEvents(verifiable).filter((event) => {
        if (event.tool_call_id === omittedCallId) return false;
        const calls = event.tool_calls as Array<{ id?: unknown }> | undefined;
        return !calls?.some((call) => call.id === omittedCallId);
      });
      expect(verifyReceipt({ ...verifiable, events }).outcome).toBe("approval_source_mismatch");
    }
  });

  it("requires every release-chain action on the root thread", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable).map((event) => {
      if (event.type === "turn.created") {
        const input = event.input as Array<Record<string, unknown>>;
        return { ...event, input: input.map((item) => ({ ...item, thread_id: "child-1" })) };
      }
      return { ...event, thread_id: "child-1" };
    });
    expect(verifyReceipt({ ...verifiable, events }).outcome).toBe("approval_source_mismatch");
  });

  it("requires the full structured release tuple in the approved tool call", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable).map((event) => {
      if (event.type !== "model.message" || event.id !== "evt-release") return event;
      const calls = event.tool_calls as Array<Record<string, unknown>>;
      const call = calls[0];
      const fn = call?.function as Record<string, unknown>;
      const args = JSON.parse(fn.arguments as string) as Record<string, unknown>;
      delete args.purpose;
      return {
        ...event,
        tool_calls: [{ ...call, function: { ...fn, arguments: JSON.stringify(args) } }],
      };
    });
    expect(verifyReceipt({ ...verifiable, events }).outcome).toBe("approval_source_mismatch");
  });

  it("rejects duplicate responses, orphan gates, and top-level approval claims", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const releaseResponse = events.find(
      (event) => event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release",
    );
    if (releaseResponse === undefined) throw new Error("fixture has no release response");
    expect(
      verifyReceipt({ ...verifiable, events: [...events, structuredClone(releaseResponse)] })
        .outcome,
    ).toBe("receipt_unwitnessed");
    expect(
      verifyReceipt({
        ...verifiable,
        events: [
          ...events,
          {
            type: TF_EVENT_TOOL_APPROVAL_REQUIRED,
            thread_id: "main",
            tool_calls: [{ id: "orphan", source_event_id: "missing" }],
          },
        ],
      }).outcome,
    ).toBe("duplicate_approval_event");
    expect(
      verifyReceipt({
        ...verifiable,
        events: [
          ...events,
          {
            type: TF_EVENT_USER_TOOL_APPROVAL,
            thread_id: "main",
            tool_call_id: "tc-release",
            approval: { status: "allow" },
          },
        ],
      }).outcome,
    ).toBe("events_malformed");
  });

  it("snapshots a stateful candidate once before checking its witnessed rows", () => {
    const { verifiable } = buildValidReceipt();
    const original = verifiable.candidate as ReleaseCandidate;
    const forgedRows = original.rows.map((row, index) =>
      index === 0 ? { ...row, ticket_count: 999_999 } : row,
    );
    let rowReads = 0;
    const candidate = new Proxy(original, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property !== "rows" || descriptor === undefined) return descriptor;
        rowReads += 1;
        return { ...descriptor, value: rowReads === 1 ? target.rows : forgedRows };
      },
    });
    const forgedBody = { ...releaseBodyOf(verifiable), rows: forgedRows };
    const events = boundEvents(verifiable).map((event) =>
      event.type === TF_EVENT_TOOL_RESPONSE && event.tool_call_id === "tc-release"
        ? { ...event, content: JSON.stringify(forgedBody) }
        : event,
    );
    expect(verifyReceipt({ ...verifiable, candidate, events }).outcome).toBe("receipt_unwitnessed");
    expect(rowReads).toBe(1);
  });

  it("does not accept evidence borrowed from an identical fresh-store run", () => {
    const first = buildValidReceipt().verifiable;
    const second = buildValidReceipt().verifiable;
    expect(first.receipt.queryId).not.toBe(second.receipt.queryId);
    expect(
      verifyReceipt({ ...second, evidence: first.evidence, events: first.events }).outcome,
    ).not.toBe("pass");
  });

  it("rejects a nested persisted user denial", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const result = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: events.map((event) =>
        event.type === "turn.created"
          ? {
              type: "turn.created",
              input: [
                {
                  type: TF_EVENT_USER_TOOL_APPROVAL,
                  thread_id: "main",
                  tool_call_id: "tc-release",
                  approval: { status: "deny" },
                },
              ],
            }
          : event,
      ),
    });
    expect(result.outcome).toBe("user_approval_missing");
  });

  it("rejects duplicate persisted user decisions", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const duplicate = events.find((event) => event.type === "turn.created");
    if (duplicate === undefined) throw new Error("fixture has no persisted user decision");
    const result = verifyReceipt({
      ...verifiable,
      events: events.flatMap((event) =>
        event === duplicate ? [event, structuredClone(event)] : [event],
      ),
    });
    expect(result.outcome).toBe("duplicate_user_approval");
  });

  it("rejects a malformed persisted user decision", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const result = verifyReceipt({
      ...verifiable,
      events: events.map((event) =>
        event.type === "turn.created"
          ? {
              type: "turn.created",
              input: [
                {
                  type: TF_EVENT_USER_TOOL_APPROVAL,
                  thread_id: "main",
                  tool_call_id: "tc-release",
                },
              ],
            }
          : event,
      ),
    });
    expect(result.outcome).toBe("events_malformed");
  });

  it("returns session_mismatch when an event names another session or turn", () => {
    const { verifiable } = buildValidReceipt();
    const events = boundEvents(verifiable);
    const otherSession = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: [{ ...events[0], session_id: "sess-2" }, ...events.slice(1)],
    });
    expect(otherSession.outcome).toBe("session_mismatch");
    const otherTurn = verifyReceipt({
      ...verifiable,
      evidence: { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"] },
      events: [{ ...events[0], turn_id: "turn-9" }, ...events.slice(1)],
    });
    expect(otherTurn.outcome).toBe("session_mismatch");
  });

  it("returns receipt_malformed for malformed evidence", () => {
    const { verifiable } = buildValidReceipt();
    for (const evidence of [
      { sessionId: "", agentType: "inline", turnIds: ["turn-1"] },
      { sessionId: "sess-1", agentType: "inline", turnIds: [] },
      { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1", "turn-1"] },
      { sessionId: "sess-1", agentType: "inline", turnIds: ["turn-1"], extra: true },
      { sessionId: "sess-1", agentType: "reference", turnIds: ["turn-1"] },
      { sessionId: "sess-1", agentType: "inline" },
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

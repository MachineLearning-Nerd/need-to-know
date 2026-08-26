import { VAULT_MCP_SERVER_NAME } from "../agent/manifest.js";
import { canonicalize } from "../contract/canonical.js";
import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../contract/policy.js";
import { snapshotArray, snapshotRecord } from "../contract/snapshot.js";
import {
  parseReleaseCandidate,
  type ReleaseCandidate,
  verifyRelease,
} from "../contract/validate.js";
import { CANARY } from "../vault/seed.js";
import { isSafeTrueForgeId } from "./events.js";
import {
  RECEIPT_KEYS,
  TF_EVENT_TOOL_APPROVAL_REQUIRED,
  TF_EVENT_TOOL_RESPONSE,
  TF_EVENT_USER_TOOL_APPROVAL,
  VERIFIABLE_RECEIPT_KEYS,
  type VerifiableReceipt,
  type VerifyResult,
} from "./receipt.js";

// Parse and validate the receipt object from unknown input.
// Returns the typed receipt or null on malformed input.
function parseReceipt(value: unknown): VerifiableReceipt["receipt"] | null {
  const record = snapshotRecord(value);
  if (record === null) return null;
  const own = Object.keys(record);
  if (own.length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((key) => own.includes(key))) {
    return null;
  }
  for (const key of RECEIPT_KEYS) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) return null;
  }
  return record as unknown as VerifiableReceipt["receipt"];
}

// Parse the evidence section: inline agent + session + turn ids binding this bundle
// to the TrueForge run that produced it. Malformed evidence is malformed
// input, never silently ignored evidence.
function parseEvidence(value: unknown): VerifiableReceipt["evidence"] | null {
  const record = snapshotRecord(value);
  if (record === null) return null;
  const own = Object.keys(record);
  if (
    own.length !== 3 ||
    !own.includes("sessionId") ||
    !own.includes("agentType") ||
    !own.includes("turnIds")
  )
    return null;
  if (!isSafeTrueForgeId(record.sessionId) || record.agentType !== "inline") return null;
  const turnIds = snapshotArray(record.turnIds);
  if (turnIds === null || turnIds.length === 0) return null;
  for (const turnId of turnIds) {
    if (!isSafeTrueForgeId(turnId)) return null;
  }
  if (new Set(turnIds).size !== turnIds.length) return null;
  return { sessionId: record.sessionId, agentType: "inline", turnIds: turnIds as string[] };
}

// Parse a VerifiableReceipt from unknown input (e.g. JSON.parse output).
function parseVerifiable(value: unknown): VerifiableReceipt | null {
  const record = snapshotRecord(value);
  if (record === null) return null;
  const own = Object.keys(record);
  if (
    own.length !== VERIFIABLE_RECEIPT_KEYS.length ||
    !VERIFIABLE_RECEIPT_KEYS.every((key) => own.includes(key))
  )
    return null;
  const receipt = parseReceipt(record.receipt);
  if (receipt === null) return null;
  const evidence = parseEvidence(record.evidence);
  if (evidence === null) return null;
  return { receipt, candidate: record.candidate, evidence, events: record.events };
}

// Scan serialized text for the canary values. Used for both released rows
// (stringified from the candidate projection) and serialized event payloads.
function containsCanary(text: string): boolean {
  return text.includes(CANARY.email) || text.includes(CANARY.freeText);
}

function parseEvents(value: unknown): Array<Record<string, unknown>> | null {
  if (value === undefined || value === null) return null;
  const items = snapshotArray(value);
  if (items === null) return null;
  const result: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const record = snapshotRecord(item);
    if (record === null) return null;
    result.push(record);
  }
  return result;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function checkEvents(
  events: Array<Record<string, unknown>>,
  evidence: VerifiableReceipt["evidence"],
  receipt: VerifiableReceipt["receipt"],
  candidate: ReleaseCandidate,
  expectedOutput: { readonly columns: readonly string[]; readonly rows: readonly unknown[] },
): VerifyResult | null {
  const eventsText = JSON.stringify(events);
  if (containsCanary(eventsText)) {
    return { outcome: "canary_in_events", detail: "canary value found in event stream" };
  }

  for (let index = 0; index < events.length; index++) {
    if (typeof events[index]?.type !== "string") {
      return { outcome: "events_malformed", detail: `event at index ${index} has no string type` };
    }
  }

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined) continue;
    const sessionId = event.session_id ?? event.sessionId;
    if (typeof sessionId === "string" && sessionId !== evidence.sessionId) {
      return {
        outcome: "session_mismatch",
        detail: `event at index ${index} names another session`,
      };
    }
    const turnId = event.turn_id ?? event.turnId;
    if (typeof turnId === "string" && !evidence.turnIds.includes(turnId)) {
      return {
        outcome: "session_mismatch",
        detail: `event at index ${index} names another turn`,
      };
    }
  }

  type VaultCall = {
    readonly id: string;
    readonly eventId: string;
    readonly index: number;
    readonly name: string;
    readonly args: Record<string, unknown>;
  };
  const vaultCalls: VaultCall[] = [];
  const relevantNames = new Set(["prepare_analysis", "validate_release", "release_result"]);
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event?.type !== "model.message") continue;
    const calls = snapshotArray(event.tool_calls);
    if (calls === null) continue;
    for (const value of calls) {
      const call = snapshotRecord(value);
      const fn = call === null ? null : snapshotRecord(call.function);
      if (fn === null || typeof fn.name !== "string" || !relevantNames.has(fn.name)) continue;
      const info = call === null ? null : snapshotRecord(call.tool_info);
      let args: Record<string, unknown> | null = null;
      try {
        args = typeof fn.arguments === "string" ? snapshotRecord(JSON.parse(fn.arguments)) : null;
      } catch {
        args = null;
      }
      if (
        event.thread_id !== "main" ||
        typeof event.id !== "string" ||
        call?.type !== "function" ||
        !hasExactKeys(call, ["id", "type", "function", "tool_info"]) ||
        typeof call.id !== "string" ||
        !hasExactKeys(fn, ["name", "arguments"]) ||
        info?.type !== "mcp" ||
        !hasExactKeys(info, ["type", "name", "server_id", "server_name"]) ||
        info.name !== fn.name ||
        info.server_id !== VAULT_MCP_SERVER_NAME ||
        info.server_name !== VAULT_MCP_SERVER_NAME ||
        args === null
      ) {
        return {
          outcome: "approval_source_mismatch",
          detail: `${fn.name} is not a root-thread Vault MCP call`,
        };
      }
      vaultCalls.push({ id: call.id, eventId: event.id, index, name: fn.name, args });
    }
  }

  const oneCall = (name: string): VaultCall | null => {
    const matches = vaultCalls.filter((call) => call.name === name);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  };
  const prepareCall = oneCall("prepare_analysis");
  const validateCall = oneCall("validate_release");
  const releaseCall = oneCall("release_result");
  if (prepareCall === null || validateCall === null || releaseCall === null) {
    return {
      outcome: "approval_source_mismatch",
      detail: "evidence must contain exactly one root Vault prepare, validate, and release call",
    };
  }

  if (
    !hasExactKeys(prepareCall.args, ["purpose", "audience", "dimensions", "metric"]) ||
    prepareCall.args.purpose !== ALLOWED_PURPOSE ||
    prepareCall.args.audience !== ALLOWED_AUDIENCE ||
    canonicalize(prepareCall.args.dimensions) !== canonicalize(candidate.queryPlan.dimensions) ||
    prepareCall.args.metric !== candidate.queryPlan.metric
  ) {
    return { outcome: "approval_source_mismatch", detail: "prepare_analysis arguments mismatch" };
  }
  if (
    !hasExactKeys(validateCall.args, ["queryId"]) ||
    validateCall.args.queryId !== receipt.queryId
  ) {
    return { outcome: "approval_source_mismatch", detail: "validate_release arguments mismatch" };
  }

  const responsesFor = (
    call: VaultCall,
  ): Array<{ index: number; body: Record<string, unknown> }> => {
    const responses: Array<{ index: number; body: Record<string, unknown> }> = [];
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (event?.type !== TF_EVENT_TOOL_RESPONSE || event.tool_call_id !== call.id) continue;
      if (event.thread_id !== "main" || typeof event.content !== "string") return [];
      try {
        const body = snapshotRecord(JSON.parse(event.content));
        if (body === null) return [];
        responses.push({ index, body });
      } catch {
        return [];
      }
    }
    return responses;
  };
  const prepareResponses = responsesFor(prepareCall);
  const validateResponses = responsesFor(validateCall);
  const releaseResponses = responsesFor(releaseCall);
  if (
    prepareResponses.length !== 1 ||
    validateResponses.length !== 1 ||
    releaseResponses.length !== 1
  ) {
    return {
      outcome: "receipt_unwitnessed",
      detail: "each Vault chain call must have exactly one root-thread response",
    };
  }
  const prepareResponse = prepareResponses[0];
  const validateResponse = validateResponses[0];
  const releaseResponse = releaseResponses[0];
  if (
    prepareResponse === undefined ||
    validateResponse === undefined ||
    releaseResponse === undefined
  ) {
    return { outcome: "receipt_unwitnessed", detail: "Vault chain response is missing" };
  }
  const preparedCandidate = parseReleaseCandidate(prepareResponse.body.candidate);
  if (
    !hasExactKeys(prepareResponse.body, ["queryId", "candidate", "suppressedCells"]) ||
    prepareResponse.body.queryId !== receipt.queryId ||
    preparedCandidate === null ||
    canonicalize(preparedCandidate) !== canonicalize(candidate) ||
    !Number.isInteger(prepareResponse.body.suppressedCells) ||
    (prepareResponse.body.suppressedCells as number) < 0
  ) {
    return { outcome: "approval_source_mismatch", detail: "prepare_analysis response mismatch" };
  }
  const suppressedCells = prepareResponse.body.suppressedCells as number;
  if (
    !hasExactKeys(validateResponse.body, ["queryId", "status", "contractHash", "outputHash"]) ||
    validateResponse.body.queryId !== receipt.queryId ||
    validateResponse.body.status !== "approved" ||
    validateResponse.body.contractHash !== receipt.contractHash ||
    validateResponse.body.outputHash !== receipt.outputHash
  ) {
    return { outcome: "approval_source_mismatch", detail: "validate_release response mismatch" };
  }
  if (
    !hasExactKeys(releaseCall.args, [
      "queryId",
      "purpose",
      "audience",
      "columns",
      "suppressedCells",
      "contractHash",
      "outputHash",
    ]) ||
    releaseCall.args.queryId !== receipt.queryId ||
    releaseCall.args.purpose !== candidate.purpose ||
    releaseCall.args.audience !== candidate.audience ||
    canonicalize(releaseCall.args.columns) !== canonicalize(candidate.columns) ||
    releaseCall.args.suppressedCells !== suppressedCells ||
    releaseCall.args.contractHash !== receipt.contractHash ||
    releaseCall.args.outputHash !== receipt.outputHash
  ) {
    return { outcome: "approval_source_mismatch", detail: "release_result tuple mismatch" };
  }

  const approvalEvents = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === TF_EVENT_TOOL_APPROVAL_REQUIRED);
  if (approvalEvents.length === 0) {
    return { outcome: "approval_missing", detail: "no tool.approval_required event found" };
  }
  if (approvalEvents.length !== 1) {
    return { outcome: "duplicate_approval_event", detail: "release evidence has multiple gates" };
  }
  const gate = approvalEvents[0];
  const gateCalls = gate === undefined ? null : snapshotArray(gate.event.tool_calls);
  const gateCall = gateCalls?.length === 1 ? snapshotRecord(gateCalls[0]) : null;
  if (
    gate === undefined ||
    gate.event.thread_id !== "main" ||
    gateCall === null ||
    !hasExactKeys(gateCall, ["id", "source_event_id"]) ||
    gateCall.id !== releaseCall.id ||
    gateCall.source_event_id !== releaseCall.eventId
  ) {
    return {
      outcome: "approval_source_mismatch",
      detail: "approval gate does not resolve to the root release_result call",
    };
  }
  if (gate.index >= releaseResponse.index) {
    return { outcome: "release_before_approval", detail: "release response precedes its gate" };
  }

  const decisions: Array<{ id: string; index: number; status: string }> = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event?.type === TF_EVENT_USER_TOOL_APPROVAL) {
      return {
        outcome: "events_malformed",
        detail: "top-level user approval is not persisted input",
      };
    }
    if (event?.type !== "turn.created") continue;
    const input = snapshotArray(event.input);
    if (input === null) {
      return { outcome: "events_malformed", detail: `turn.created at index ${index} has no input` };
    }
    for (const value of input) {
      const decision = snapshotRecord(value);
      if (decision?.type !== TF_EVENT_USER_TOOL_APPROVAL) continue;
      const approval = snapshotRecord(decision.approval);
      if (
        decision.thread_id !== "main" ||
        !hasExactKeys(decision, ["type", "thread_id", "tool_call_id", "approval"]) ||
        typeof decision.tool_call_id !== "string" ||
        approval === null ||
        !hasExactKeys(approval, ["status"]) ||
        (approval.status !== "allow" && approval.status !== "deny")
      ) {
        return {
          outcome: "events_malformed",
          detail: `user approval at index ${index} is malformed`,
        };
      }
      decisions.push({ id: decision.tool_call_id, index, status: approval.status });
    }
  }
  if (decisions.length > 1) {
    return {
      outcome: "duplicate_user_approval",
      detail: "release evidence has multiple user decisions",
    };
  }
  const decision = decisions[0];
  if (
    decision === undefined ||
    decision.id !== releaseCall.id ||
    decision.status !== "allow" ||
    decision.index <= gate.index ||
    decision.index >= releaseResponse.index
  ) {
    return {
      outcome: "user_approval_missing",
      detail: "release response has no single root-thread user allow",
    };
  }
  if (
    !(
      prepareCall.index < prepareResponse.index &&
      prepareResponse.index < validateCall.index &&
      validateCall.index < validateResponse.index &&
      validateResponse.index < releaseCall.index &&
      releaseCall.index < gate.index &&
      gate.index < releaseResponse.index
    )
  ) {
    return { outcome: "release_before_approval", detail: "Vault release chain is out of order" };
  }

  const responseCarriesRelease = (content: unknown): boolean => {
    if (typeof content !== "string") return false;
    try {
      const body = snapshotRecord(JSON.parse(content));
      const witnessedReceipt = body === null ? null : snapshotRecord(body.receipt);
      return (
        body !== null &&
        Object.keys(body).length === 3 &&
        ["receipt", "columns", "rows"].every((key) => Object.hasOwn(body, key)) &&
        witnessedReceipt !== null &&
        Object.keys(witnessedReceipt).length === RECEIPT_KEYS.length &&
        RECEIPT_KEYS.every((key) => witnessedReceipt[key] === receipt[key]) &&
        canonicalize(body.columns) === canonicalize(expectedOutput.columns) &&
        canonicalize(body.rows) === canonicalize(expectedOutput.rows)
      );
    } catch {
      return false;
    }
  };

  if (!responseCarriesRelease(JSON.stringify(releaseResponse.body))) {
    return {
      outcome: "receipt_unwitnessed",
      detail: "no gated tool.response carries the exact released payload and receipt",
    };
  }

  return null;
}

// The core verification function. Never throws — all error paths return a typed result.
export function verifyReceipt(value: unknown): VerifyResult {
  try {
    const verifiable = parseVerifiable(value);
    if (verifiable === null) {
      return { outcome: "receipt_malformed", detail: "input is not a valid VerifiableReceipt" };
    }

    const { receipt, evidence, events: rawEvents } = verifiable;
    const candidate = parseReleaseCandidate(verifiable.candidate);
    if (candidate === null) {
      return {
        outcome: "candidate_malformed",
        detail: "candidate is not a well-formed release candidate snapshot",
      };
    }

    // Persisted evidence is mandatory for an authoritative receipt verdict.
    const events = parseEvents(rawEvents);
    if (events === null) {
      return {
        outcome: "events_malformed",
        detail: "events field is not an array of records",
      };
    }

    // Validate the candidate through the release contract and recompute hashes.
    // verifyRelease calls validateRelease internally, then checks both hashes.
    const verdict = verifyRelease(candidate, receipt.contractHash, receipt.outputHash);

    if (verdict.status === "needs_review") {
      return {
        outcome: "candidate_malformed",
        detail: verdict.findings.map((finding) => finding.code).join(", ") || "candidate_malformed",
      };
    }

    if (verdict.status === "denied") {
      // Check if it is a hash mismatch specifically (hashes were wrong) vs a policy denial.
      const codes = verdict.findings.map((finding) => finding.code);
      if (codes.includes("contract_hash_mismatch")) {
        return { outcome: "contract_hash_mismatch", detail: codes.join(", ") };
      }
      if (codes.includes("output_hash_mismatch")) {
        return { outcome: "output_hash_mismatch", detail: codes.join(", ") };
      }
      return { outcome: "candidate_denied", detail: codes.join(", ") };
    }

    // verdict.status === "approved" — both hashes match the recomputed values.

    // The hashes bind the receipt to the candidate's CONTENT; these three
    // fields bind it to the candidate's IDENTITY. Without them a receipt
    // naming the wrong query or versions would still verify. receiptId has no
    // candidate-side counterpart and stays an unverified display field.
    const provenance = candidate.provenance;
    if (
      candidate.datasetVersion !== receipt.datasetVersion ||
      candidate.policyVersion !== receipt.policyVersion ||
      provenance.queryId !== receipt.queryId
    ) {
      return {
        outcome: "receipt_metadata_mismatch",
        detail: "receipt queryId or versions do not match the verified candidate",
      };
    }

    const columns = candidate.columns;
    const candidateRows = candidate.rows;
    const releasedRows: Array<Record<string, unknown>> = [];
    for (const value of candidateRows) {
      const released: Record<string, unknown> = {};
      for (const column of columns) released[column] = value[column];
      releasedRows.push(released);
    }

    // Canary scan uses the same frozen candidate snapshot as validation and
    // response witnessing, so a stateful caller cannot swap values between checks.
    const candidateText = JSON.stringify(candidate);
    if (containsCanary(candidateText)) {
      return { outcome: "canary_in_rows", detail: "canary value found in candidate rows" };
    }

    const eventFailure = checkEvents(events, evidence, receipt, candidate, {
      columns,
      rows: releasedRows,
    });
    if (eventFailure !== null) return eventFailure;

    return { outcome: "pass", receiptId: receipt.receiptId, queryId: receipt.queryId };
  } catch {
    // Any unexpected throw maps to receipt_malformed so nothing leaks internals.
    return { outcome: "receipt_malformed", detail: "unexpected error during verification" };
  }
}

export type { VerifiableReceipt, VerifyOutcome, VerifyResult } from "./receipt.js";

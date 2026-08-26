import { snapshotArray, snapshotRecord } from "../contract/snapshot.js";
import { verifyRelease } from "../contract/validate.js";
import { CANARY } from "../vault/seed.js";
import {
  RECEIPT_KEYS,
  TF_EVENT_TOOL_APPROVAL_REQUIRED,
  TF_EVENT_TOOL_RESPONSE,
  TF_EVENT_USER_TOOL_APPROVAL,
  VERIFIABLE_OPTIONAL_KEYS,
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

// Parse the optional evidence section: session + turn ids binding this bundle
// to the TrueForge run that produced it. Malformed evidence is malformed
// input, never silently ignored evidence.
function parseEvidence(value: unknown): VerifiableReceipt["evidence"] | null | undefined {
  if (value === undefined) return undefined;
  const record = snapshotRecord(value);
  if (record === null) return null;
  const own = Object.keys(record);
  if (own.length !== 2 || !own.includes("sessionId") || !own.includes("turnIds")) return null;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return null;
  const turnIds = snapshotArray(record.turnIds);
  if (turnIds === null || turnIds.length === 0) return null;
  for (const turnId of turnIds) {
    if (typeof turnId !== "string" || turnId.length === 0) return null;
  }
  return { sessionId: record.sessionId, turnIds: turnIds as string[] };
}

// Parse a VerifiableReceipt from unknown input (e.g. JSON.parse output).
function parseVerifiable(value: unknown): VerifiableReceipt | null {
  const record = snapshotRecord(value);
  if (record === null) return null;
  // Must have at least receipt + candidate; evidence and events are optional.
  const own = Object.keys(record);
  if (!VERIFIABLE_RECEIPT_KEYS.every((key) => own.includes(key))) return null;
  // Extra keys beyond the declared set are disallowed — fail closed.
  const allowed: readonly string[] = [...VERIFIABLE_RECEIPT_KEYS, ...VERIFIABLE_OPTIONAL_KEYS];
  for (const key of own) {
    if (!allowed.includes(key)) return null;
  }
  const receipt = parseReceipt(record.receipt);
  if (receipt === null) return null;
  const evidence = parseEvidence(record.evidence);
  if (evidence === null) return null;
  const result: VerifiableReceipt = { receipt, candidate: record.candidate, events: record.events };
  return evidence === undefined ? result : { ...result, evidence };
}

// Scan serialized text for the canary values. Used for both released rows
// (stringified from the candidate projection) and serialized event payloads.
function containsCanary(text: string): boolean {
  return text.includes(CANARY.email) || text.includes(CANARY.freeText);
}

// Parse the events array from optional unknown input.
// Returns null if events is present but malformed; returns undefined if absent.
function parseEvents(value: unknown): Array<Record<string, unknown>> | null | undefined {
  if (value === undefined || value === null) return undefined;
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

// Check the TrueForge event array for:
// 1. Canary absence in the serialized event stream
// 2. No duplicate tool.approval_required events for the same tool call
// 3. At least one tool.approval_required event in the stream
// 4. For every GATED tool.response — one whose tool_call_id was named in a
//    tool.approval_required — the request precedes the response AND the user
//    granted it in between (user.tool_approval with status "allow").
// Ungated responses (describe_dataset, prepare_analysis) pass through: a real
// session runs and answers those long before release_result asks for
// approval, so demanding approval before every response would reject every
// legitimate full-session transcript. All positions are real indices into
// events — a filtered view would shift them and misjudge ordering.
function checkEvents(
  events: Array<Record<string, unknown>>,
  evidence: VerifiableReceipt["evidence"],
  receipt: VerifiableReceipt["receipt"],
): VerifyResult | null {
  // Canary check over the full serialized event stream.
  const eventsText = JSON.stringify(events);
  if (containsCanary(eventsText)) {
    return { outcome: "canary_in_events", detail: "canary value found in event stream" };
  }

  // Every event must carry a string type: a record without one is not a
  // TrueForge event and cannot be classified, so it fails closed rather than
  // being skipped — skipped records would let evidence hide inside the
  // stream unexamined.
  for (let index = 0; index < events.length; index++) {
    if (typeof events[index]?.type !== "string") {
      return { outcome: "events_malformed", detail: `event at index ${index} has no string type` };
    }
  }

  // When the bundle names its session, any event that itself carries session
  // or turn identifiers must agree — a stream borrowed from another run must
  // not certify this receipt.
  if (evidence !== undefined) {
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
  }

  // Gated tool calls: id -> position of the tool.approval_required naming it.
  const approvalPositionById = new Map<string, number>();
  let approvalCount = 0;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined || event.type !== TF_EVENT_TOOL_APPROVAL_REQUIRED) continue;
    approvalCount += 1;
    const toolCalls = snapshotArray(event.tool_calls);
    if (toolCalls === null) continue;
    for (const tc of toolCalls) {
      const tcRecord = snapshotRecord(tc);
      if (tcRecord === null || typeof tcRecord.id !== "string") continue;
      if (approvalPositionById.has(tcRecord.id)) {
        return {
          outcome: "duplicate_approval_event",
          detail: `duplicate approval for tool call ${tcRecord.id.slice(0, 120)}`,
        };
      }
      approvalPositionById.set(tcRecord.id, index);
    }
  }

  // There must be at least one approval event.
  if (approvalCount === 0) {
    return { outcome: "approval_missing", detail: "no tool.approval_required event found" };
  }

  const isUserApprovalFor = (event: Record<string, unknown>, id: string): boolean =>
    event.type === TF_EVENT_USER_TOOL_APPROVAL && event.tool_call_id === id;
  const isUserAllow = (event: Record<string, unknown>, id: string): boolean => {
    if (!isUserApprovalFor(event, id)) return false;
    const approval = snapshotRecord(event.approval);
    return approval !== null && approval.status === "allow";
  };
  // trueforge 0.1.4 responds to a denied gated call with this error text —
  // the one persisted trace a denial leaves.
  const isDeniedResponse = (event: Record<string, unknown>): boolean =>
    typeof event.content === "string" && event.content.includes("User denied tool call");

  let witnessed = false;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined || event.type !== TF_EVENT_TOOL_RESPONSE) continue;
    const id = typeof event.tool_call_id === "string" ? event.tool_call_id : null;
    if (id === null) continue;
    const requested = approvalPositionById.get(id);
    if (requested === undefined) continue;
    if (requested >= index) {
      return {
        outcome: "release_before_approval",
        detail: `tool.response at index ${index} precedes its tool.approval_required`,
      };
    }
    // The agent asking is not the user allowing. When the log carries
    // user.tool_approval events for this call, an "allow" must sit between
    // the request and the execution. trueforge 0.1.4 does NOT persist the
    // user's decision, so on persisted streams the grant is evidenced
    // structurally instead: a denial leaves its error marker on the
    // response, and only a granted release can carry the receipt (checked
    // below for session-bound bundles).
    const hasUserEvents = events.some((candidate) => isUserApprovalFor(candidate, id));
    if (hasUserEvents) {
      let granted = false;
      for (let position = requested + 1; position < index; position++) {
        const candidate = events[position];
        if (candidate !== undefined && isUserAllow(candidate, id)) {
          granted = true;
          break;
        }
      }
      if (!granted) {
        return {
          outcome: "user_approval_missing",
          detail: `tool.response at index ${index} for ${id.slice(0, 120)} has no user grant`,
        };
      }
    } else if (isDeniedResponse(event)) {
      return {
        outcome: "user_approval_missing",
        detail: `tool.response at index ${index} for ${id.slice(0, 120)} records a user denial`,
      };
    }
    if (
      typeof event.content === "string" &&
      event.content.includes(receipt.receiptId) &&
      event.content.includes(receipt.contractHash) &&
      event.content.includes(receipt.outputHash)
    ) {
      witnessed = true;
    }
  }

  // A session-bound bundle claims these events ARE the run that produced the
  // receipt, so some gated post-approval response must carry the receipt id
  // and both hashes. A stream where the release was denied — or that belongs
  // to some other run — cannot witness it and must not certify it.
  if (evidence !== undefined && !witnessed) {
    return {
      outcome: "receipt_unwitnessed",
      detail: "no gated tool.response carries this receipt's id and hashes",
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

    const { receipt, candidate, evidence, events: rawEvents } = verifiable;

    // Parse optional events first — fail closed before any hash work if malformed.
    const events = parseEvents(rawEvents);
    if (events === null) {
      return {
        outcome: "events_malformed",
        detail: "events field is present but not an array of records",
      };
    }

    // A bundle that names its TrueForge session has promised event evidence;
    // verifying its hashes alone would certify a run nobody can inspect.
    if (evidence !== undefined && events === undefined) {
      return {
        outcome: "events_missing",
        detail: "evidence names a session but no events were provided or fetched",
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
    const candidateRecord = snapshotRecord(candidate);
    const provenance = candidateRecord === null ? null : snapshotRecord(candidateRecord.provenance);
    if (
      candidateRecord === null ||
      provenance === null ||
      candidateRecord.datasetVersion !== receipt.datasetVersion ||
      candidateRecord.policyVersion !== receipt.policyVersion ||
      provenance.queryId !== receipt.queryId
    ) {
      return {
        outcome: "receipt_metadata_mismatch",
        detail: "receipt queryId or versions do not match the verified candidate",
      };
    }

    // Canary scan on the candidate's released rows (projected by contract columns).
    // validateRelease already parsed a frozen snapshot, so we re-run the projection
    // directly on the candidate object via JSON serialization — this is safe because
    // validateRelease proved the candidate is well-formed and passes policy.
    const candidateText = JSON.stringify(candidate);
    if (containsCanary(candidateText)) {
      return { outcome: "canary_in_rows", detail: "canary value found in candidate rows" };
    }

    // Optional event-stream checks.
    if (events !== undefined) {
      const eventFailure = checkEvents(events, evidence, receipt);
      if (eventFailure !== null) return eventFailure;
    }

    return { outcome: "pass", receiptId: receipt.receiptId, queryId: receipt.queryId };
  } catch {
    // Any unexpected throw maps to receipt_malformed so nothing leaks internals.
    return { outcome: "receipt_malformed", detail: "unexpected error during verification" };
  }
}

export type { VerifiableReceipt, VerifyOutcome, VerifyResult } from "./receipt.js";

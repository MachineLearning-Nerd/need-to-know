import { snapshotArray, snapshotRecord } from "../contract/snapshot.js";
import { verifyRelease } from "../contract/validate.js";
import { CANARY } from "../vault/seed.js";
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

// Parse a VerifiableReceipt from unknown input (e.g. JSON.parse output).
function parseVerifiable(value: unknown): VerifiableReceipt | null {
  const record = snapshotRecord(value);
  if (record === null) return null;
  // Must have at least receipt + candidate; events is optional.
  const own = Object.keys(record);
  if (!VERIFIABLE_RECEIPT_KEYS.every((key) => own.includes(key))) return null;
  // Extra keys beyond receipt/candidate/events are disallowed — fail closed.
  for (const key of own) {
    if (key !== "receipt" && key !== "candidate" && key !== "events") return null;
  }
  const receipt = parseReceipt(record.receipt);
  if (receipt === null) return null;
  return { receipt, candidate: record.candidate, events: record.events };
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
// 1. At least one tool.approval_required event before any tool.response for release_result
// 2. No duplicate tool.approval_required events for the same tool call
// 3. Canary absence in the serialized event stream
function checkEvents(events: Array<Record<string, unknown>>): VerifyResult | null {
  // Canary check over the full serialized event stream.
  const eventsText = JSON.stringify(events);
  if (containsCanary(eventsText)) {
    return { outcome: "canary_in_events", detail: "canary value found in event stream" };
  }

  // Extract event types in sequence order.
  const sequence: string[] = events
    .map((event) => (typeof event.type === "string" ? event.type : ""))
    .filter((type) => type.length > 0);

  // Find all approval events and their positions.
  const approvalPositions: number[] = [];
  const approvalToolCallIds = new Set<string>();
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.type === TF_EVENT_TOOL_APPROVAL_REQUIRED) {
      approvalPositions.push(index);
      // Extract tool call IDs from the approval event's tool_calls array.
      const toolCalls = snapshotArray(event.tool_calls);
      if (toolCalls !== null) {
        for (const tc of toolCalls) {
          const tcRecord = snapshotRecord(tc);
          if (tcRecord !== null && typeof tcRecord.id === "string") {
            if (approvalToolCallIds.has(tcRecord.id)) {
              return {
                outcome: "duplicate_approval_event",
                detail: `duplicate approval for tool call ${tcRecord.id}`,
              };
            }
            approvalToolCallIds.add(tcRecord.id);
          }
        }
      }
    }
  }

  // There must be at least one approval event.
  if (approvalPositions.length === 0) {
    return { outcome: "approval_missing", detail: "no tool.approval_required event found" };
  }

  // Find the position of any user.tool_approval (resume) event.
  const resumePositions: number[] = [];
  for (let index = 0; index < events.length; index++) {
    if (sequence[index] === TF_EVENT_USER_TOOL_APPROVAL) {
      resumePositions.push(index);
    }
  }

  // Find the position of tool.response events (tool execution evidence).
  const responsePositions: number[] = [];
  for (let index = 0; index < events.length; index++) {
    if (sequence[index] === TF_EVENT_TOOL_RESPONSE) {
      responsePositions.push(index);
    }
  }

  // Every tool.response must be preceded by at least one approval event.
  for (const responsePos of responsePositions) {
    const priorApproval = approvalPositions.some((approvalPos) => approvalPos < responsePos);
    if (!priorApproval) {
      return {
        outcome: "release_before_approval",
        detail: `tool.response at index ${responsePos} has no prior tool.approval_required`,
      };
    }
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

    const { receipt, candidate, events: rawEvents } = verifiable;

    // Parse optional events first — fail closed before any hash work if malformed.
    const events = parseEvents(rawEvents);
    if (events === null) {
      return {
        outcome: "events_malformed",
        detail: "events field is present but not an array of records",
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
      const eventFailure = checkEvents(events);
      if (eventFailure !== null) return eventFailure;
    }

    return { outcome: "pass", receiptId: receipt.receiptId, queryId: receipt.queryId };
  } catch {
    // Any unexpected throw maps to receipt_malformed so nothing leaks internals.
    return { outcome: "receipt_malformed", detail: "unexpected error during verification" };
  }
}

// Build a VerifiableReceipt from the store's PreparedAnalysis + ReleaseReceipt.
// This is the companion to the CLI: given what the vault stored, produce
// a JSON-serializable bundle that verify-receipt can consume.
export type { VerifiableReceipt, VerifyOutcome, VerifyResult } from "./receipt.js";

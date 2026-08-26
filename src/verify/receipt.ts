import type { Sha256Hex } from "../contract/canonical.js";

// A VerifiableReceipt bundles the release receipt, candidate, and persisted
// TrueForge evidence that produced it. The library checks their consistency;
// the CLI additionally refetches the identified session from TrueForge.
export type VerifiableReceipt = {
  readonly receipt: {
    // Display field only: nothing candidate-side can corroborate a receiptId,
    // so the verifier reports it back but never treats it as verified.
    readonly receiptId: string;
    readonly queryId: string;
    readonly contractHash: Sha256Hex;
    readonly outputHash: Sha256Hex;
    readonly datasetVersion: string;
    readonly policyVersion: string;
  };
  readonly candidate: unknown;
  // TrueForge session binding: which session and turns produced this receipt.
  readonly evidence: {
    readonly sessionId: string;
    readonly agentType: "inline";
    readonly turnIds: readonly string[];
  };
  // Serialized TrueForge session events for the named turns.
  readonly events: unknown;
};

// The verifier never throws — every path returns a typed verdict.
export type VerifyOutcome =
  | "pass"
  | "receipt_malformed"
  | "candidate_malformed"
  | "contract_hash_mismatch"
  | "output_hash_mismatch"
  | "candidate_denied"
  | "receipt_metadata_mismatch"
  | "canary_in_rows"
  | "events_malformed"
  | "events_unavailable"
  | "events_partial"
  | "session_mismatch"
  | "receipt_unwitnessed"
  | "approval_source_mismatch"
  | "approval_missing"
  | "user_approval_missing"
  | "duplicate_user_approval"
  | "release_before_approval"
  | "canary_in_events"
  | "duplicate_approval_event";

export type VerifyResult =
  | { readonly outcome: "pass"; readonly receiptId: string; readonly queryId: string }
  | { readonly outcome: Exclude<VerifyOutcome, "pass">; readonly detail: string };

// TrueForge event type strings relevant to approval-ordering checks.
export const TF_EVENT_TOOL_APPROVAL_REQUIRED = "tool.approval_required";
export const TF_EVENT_USER_TOOL_APPROVAL = "user.tool_approval";
export const TF_EVENT_TOOL_RESPONSE = "tool.response";

// The receipt record keys — exactly these, no extras, no missing.
export const RECEIPT_KEYS = Object.freeze([
  "receiptId",
  "queryId",
  "contractHash",
  "outputHash",
  "datasetVersion",
  "policyVersion",
] as const);

export const VERIFIABLE_RECEIPT_KEYS = Object.freeze([
  "receipt",
  "candidate",
  "evidence",
  "events",
] as const);

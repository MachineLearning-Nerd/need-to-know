import type { Sha256Hex } from "../contract/canonical.js";

// A VerifiableReceipt bundles the release receipt together with the candidate
// that produced it. The verifier recomputes both hashes from the candidate and
// checks them against the receipt — internal consistency only. It does not
// authenticate origin or prevent a party from fabricating both fields together.
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
  // Optional: serialized TrueForge session events for the turn that produced
  // this receipt. When present the verifier additionally checks approval-before-
  // release ordering and canary absence in the event stream.
  readonly events?: unknown;
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
  | "approval_missing"
  | "user_approval_missing"
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

export const VERIFIABLE_RECEIPT_KEYS = Object.freeze(["receipt", "candidate"] as const);

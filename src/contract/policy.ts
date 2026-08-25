export const POLICY_VERSION = "policy-v1";

// The single authorized mission for this demo deployment. Authorization is an
// exact literal comparison — no trimming, casing, or similarity: deterministic
// code, not the model, decides whether a mission is allowed, and near-misses
// must fail closed rather than be helpfully corrected.
export const ALLOWED_PURPOSE = "weekly support trend";
export const ALLOWED_AUDIENCE = "support leadership";

export type MissionDenialReason = "purpose_not_authorized" | "audience_not_authorized";

export type MissionAuthorization =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly reasons: readonly MissionDenialReason[] };

export function authorizeMission(purpose: unknown, audience: unknown): MissionAuthorization {
  const reasons: MissionDenialReason[] = [];
  if (purpose !== ALLOWED_PURPOSE) reasons.push("purpose_not_authorized");
  if (audience !== ALLOWED_AUDIENCE) reasons.push("audience_not_authorized");
  if (reasons.length > 0) return { authorized: false, reasons: Object.freeze(reasons) };
  return { authorized: true };
}

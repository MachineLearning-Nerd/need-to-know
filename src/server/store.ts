import type { Sha256Hex } from "../contract/canonical.js";
import type { Finding } from "../contract/findings.js";
import type { ReleaseCandidate } from "../contract/validate.js";

export type PreparedAnalysis = Readonly<{
  queryId: string;
  candidate: ReleaseCandidate;
  suppressedCells: number;
}>;

// Audit records and release transitions are different things: every
// release_result call leaves an audit record, but only a successful one
// creates a receipt — and a queryId can never have more than one.
export type AuditOutcome =
  | "released"
  | "denied"
  | "needs_review"
  | "unknown_query_id"
  | "already_released"
  | "not_released"
  | "dimension_not_allowed"
  | "mission_not_authorized";

export type AuditRecord = Readonly<{
  seq: number;
  queryId: string;
  outcome: AuditOutcome;
  findings: readonly Finding[];
}>;

export type ReleaseReceipt = Readonly<{
  receiptId: string;
  queryId: string;
  contractHash: Sha256Hex;
  outputHash: Sha256Hex;
  datasetVersion: string;
  policyVersion: string;
}>;

// The store is the vault's memory of what it prepared: release-time checks
// load evidence from here by queryId, never from a caller-supplied candidate
// body, so a fabricated group_size has nothing to attach itself to.
export type VaultStore = {
  savePrepared(
    candidate: Omit<ReleaseCandidate, "provenance">,
    suppressedCells: number,
  ): PreparedAnalysis;
  getPrepared(queryId: string): PreparedAnalysis | undefined;
  recordAudit(queryId: string, outcome: AuditOutcome, findings?: readonly Finding[]): AuditRecord;
  audits(): readonly AuditRecord[];
  saveReceipt(receipt: Omit<ReleaseReceipt, "receiptId">): ReleaseReceipt;
  getReceipt(queryId: string): ReleaseReceipt | undefined;
};

const MAX_PREPARED_ENTRIES = 500;

export function createVaultStore(): VaultStore {
  const prepared = new Map<string, PreparedAnalysis>();
  const auditLog: AuditRecord[] = [];
  const receipts = new Map<string, ReleaseReceipt>();
  let nextQueryId = 1;
  let nextReceiptId = 1;

  return {
    savePrepared: (candidate, suppressedCells) => {
      const queryId = `q-${nextQueryId}`;
      nextQueryId += 1;
      // Deep-frozen copies, not references: queryPlan.dimensions aliases the
      // caller's parsed input array, and a post-release in-process mutation
      // of rows would change what render_safe_chart serves with no check.
      const entry: PreparedAnalysis = Object.freeze({
        queryId,
        candidate: Object.freeze({
          ...candidate,
          columns: Object.freeze([...candidate.columns]),
          rows: Object.freeze(candidate.rows.map((row) => Object.freeze({ ...row }))),
          queryPlan: Object.freeze({
            ...candidate.queryPlan,
            dimensions: Object.freeze([...candidate.queryPlan.dimensions]),
            filters: Object.freeze([...candidate.queryPlan.filters]),
            joins: Object.freeze([...candidate.queryPlan.joins]),
          }),
          provenance: Object.freeze({
            sourceDataset: candidate.queryPlan.sourceDataset,
            datasetVersion: candidate.datasetVersion,
            queryId,
          }),
        }),
        suppressedCells,
      });
      prepared.set(queryId, entry);
      // Bounded: a caller can drive prepare_analysis in a loop and every entry
      // retains its rows. The audit log deliberately stays uncapped — dropping
      // enforcement records to save memory would be fail-open.
      if (prepared.size > MAX_PREPARED_ENTRIES) {
        const oldest = prepared.keys().next();
        if (!oldest.done) prepared.delete(oldest.value);
      }
      return entry;
    },
    getPrepared: (queryId) => prepared.get(queryId),
    recordAudit: (queryId, outcome, findings = []) => {
      const record: AuditRecord = Object.freeze({
        seq: auditLog.length + 1,
        // Clipped where the write happens: vault-issued ids are at most 64
        // chars, so anything longer is caller-controlled and must not grow
        // the enforcement record without bound.
        queryId: queryId.length > 64 ? `${queryId.slice(0, 64)}…` : queryId,
        outcome,
        // Frozen copies of each finding, not references: the audit trail must
        // stay immutable even against in-process mutation of the originals.
        findings: Object.freeze(findings.map((finding) => Object.freeze({ ...finding }))),
      });
      auditLog.push(record);
      return record;
    },
    audits: () => Object.freeze([...auditLog]),
    saveReceipt: (receipt) => {
      // One receipt per queryId, enforced where the write happens — a replay
      // that slipped past the handler check must still fail here.
      if (receipts.has(receipt.queryId)) {
        throw new Error(`receipt already exists: ${receipt.queryId}`);
      }
      const entry: ReleaseReceipt = Object.freeze({
        receiptId: `r-${nextReceiptId}`,
        ...receipt,
      });
      nextReceiptId += 1;
      receipts.set(receipt.queryId, entry);
      return entry;
    },
    getReceipt: (queryId) => receipts.get(queryId),
  };
}

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
  | "already_released";

export type AuditRecord = Readonly<{
  seq: number;
  queryId: string;
  outcome: AuditOutcome;
  findings: readonly Finding[];
}>;

export type ReleaseReceipt = Readonly<{
  receiptId: string;
  queryId: string;
  contractHash: string;
  outputHash: string;
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
      const entry: PreparedAnalysis = Object.freeze({
        queryId,
        candidate: Object.freeze({
          ...candidate,
          provenance: Object.freeze({
            sourceDataset: candidate.queryPlan.sourceDataset,
            datasetVersion: candidate.datasetVersion,
            queryId,
          }),
        }),
        suppressedCells,
      });
      prepared.set(queryId, entry);
      return entry;
    },
    getPrepared: (queryId) => prepared.get(queryId),
    recordAudit: (queryId, outcome, findings = []) => {
      const record: AuditRecord = Object.freeze({
        seq: auditLog.length + 1,
        queryId,
        outcome,
        findings: Object.freeze([...findings]),
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

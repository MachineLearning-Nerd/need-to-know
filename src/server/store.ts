import type { ReleaseCandidate } from "../contract/validate.js";

export type PreparedAnalysis = Readonly<{
  queryId: string;
  candidate: ReleaseCandidate;
  suppressedCells: number;
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
};

export function createVaultStore(): VaultStore {
  const prepared = new Map<string, PreparedAnalysis>();
  let nextQueryId = 1;

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
  };
}

import { useAui, useAuiState } from "@truefoundry/trueforge-ui/assistant-ui";
import { useMemo } from "react";

import { type ClearanceEvidence, extractEvidence } from "./evidence.js";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="ck-rail-row">
      <span className="ck-rail-label">{label}</span>
      <span className={mono ? "ck-rail-value ck-mono" : "ck-rail-value"} title={value}>
        {value}
      </span>
    </div>
  );
}

function stage(evidence: ClearanceEvidence): { label: string; tone: string } {
  if (evidence.receiptId !== undefined) return { label: "RELEASED", tone: "ck-tone-released" };
  if (evidence.denialCode !== undefined) return { label: "DENIED", tone: "ck-tone-denied" };
  if (evidence.verdict === "approved") return { label: "CLEARED", tone: "ck-tone-cleared" };
  if (evidence.verdict === "denied") return { label: "DENIED", tone: "ck-tone-denied" };
  if (evidence.verdict !== undefined) return { label: "HELD", tone: "ck-tone-denied" };
  if (evidence.queryId !== undefined) return { label: "PREPARED", tone: "ck-tone-prepared" };
  return { label: "NO MISSION", tone: "ck-tone-idle" };
}

// T8.2 — the evidence rail: ledger and receipt state alongside the
// conversation, derived exclusively from what the vault's tool responses said
// in this thread. If nothing was prepared, it says so instead of decorating.
export function EvidenceRail() {
  const aui = useAui();
  const threadRevision = useAuiState((state) => {
    const messages = state.thread.messages;
    const lastMessage = messages.at(-1);
    return `${state.threadListItem.id}:${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.status?.type ?? ""}:${state.thread.isLoading}:${state.thread.isRunning}`;
  });
  const evidence = useMemo(() => {
    void threadRevision;
    return extractEvidence(aui.thread().getState().messages);
  }, [aui, threadRevision]);
  const { label, tone } = stage(evidence);
  return (
    <aside className="ck-rail">
      <div className="ck-rail-title">Evidence</div>
      <div className={`ck-rail-stage ${tone}`}>{label}</div>

      <div className="ck-rail-section">Mission</div>
      <Row label="Purpose" value={evidence.purpose ?? "—"} />
      <Row label="Audience" value={evidence.audience ?? "—"} />
      <Row label="Columns" value={evidence.columns?.join(", ") ?? "—"} />
      <Row
        label="Suppressed"
        value={evidence.suppressedCells === undefined ? "—" : `${evidence.suppressedCells} cells`}
      />

      <div className="ck-rail-section">Contract</div>
      <Row label="Verdict" value={evidence.verdict ?? "—"} />
      {evidence.findingCodes ? <Row label="Findings" value={evidence.findingCodes} /> : null}
      <Row label="Contract" value={evidence.contractHash ?? "—"} mono />
      <Row label="Output" value={evidence.outputHash ?? "—"} mono />

      <div className="ck-rail-section">Ledger</div>
      <Row label="Query" value={evidence.queryId ?? "—"} mono />
      <Row label="Receipt" value={evidence.receiptId ?? "none"} mono />
      {evidence.denialCode ? <Row label="Denied" value={evidence.denialCode} /> : null}
      <Row
        label="Versions"
        value={
          evidence.datasetVersion === undefined
            ? "—"
            : `${evidence.datasetVersion} / ${evidence.policyVersion ?? "—"}`
        }
      />
      <Row label="Chart" value={evidence.chartRendered === true ? "rendered from release" : "—"} />

      <div className="ck-rail-footnote">
        Evidence fields come from vault tool responses in this thread. The stage label summarizes
        their current status.
      </div>
    </aside>
  );
}

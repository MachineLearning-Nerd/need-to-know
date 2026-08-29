import {
  AgentStepsCard,
  type AgentStepsCardProps,
  type AskUserPromptProps,
  ToolApprovalBar as DefaultToolApprovalBar,
  defaultSlots,
  type SubAgentCardProps,
  type ToolApprovalBarProps,
} from "@truefoundry/trueforge-ui";
import { useAuiState } from "@truefoundry/trueforge-ui/assistant-ui";
import { useEffect, useMemo, useState } from "react";

import { releaseTupleFromArgsText } from "./evidence.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function TupleRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="ck-tuple-row">
      <span className="ck-tuple-label">{label}</span>
      <span className={mono ? "ck-tuple-value ck-mono" : "ck-tuple-value"} title={value}>
        {value}
      </span>
    </div>
  );
}

// T8.3 — the approval moment is the hero: for release_result the bar renders
// the full human-approved tuple (mission, columns, suppression, both hashes)
// read from the pending tool call itself, then hands the actual decision to
// the stock bar so approve/deny semantics stay exactly the runtime's.
export function ClearanceApprovalBar(props: ToolApprovalBarProps) {
  const argsText = useAuiState((state) =>
    state.part.type === "tool-call" ? state.part.argsText : undefined,
  );
  const tuple = useMemo(
    () => (props.toolName === "release_result" ? releaseTupleFromArgsText(argsText) : null),
    [argsText, props.toolName],
  );
  const decided = props.status !== undefined;
  return (
    <div className="ck-approval">
      {props.toolName === "release_result" ? (
        <div className="ck-approval-tuple">
          <div className="ck-approval-heading">
            {decided ? "Release decision" : "Release approval required"}
          </div>
          {tuple === null ? (
            <div className="ck-approval-note">
              The exact tuple for this decision is recorded on the release_result call above.
            </div>
          ) : (
            <>
              <TupleRow label="Purpose" value={String(tuple.purpose ?? "—")} />
              <TupleRow label="Audience" value={String(tuple.audience ?? "—")} />
              <TupleRow
                label="Columns"
                value={Array.isArray(tuple.columns) ? tuple.columns.join(", ") : "—"}
              />
              <TupleRow label="Suppressed cells" value={String(tuple.suppressedCells ?? "—")} />
              <TupleRow label="Query" value={String(tuple.queryId ?? "—")} mono />
              <TupleRow label="Contract hash" value={asString(tuple.contractHash) ?? "—"} mono />
              <TupleRow label="Output hash" value={asString(tuple.outputHash) ?? "—"} mono />
            </>
          )}
        </div>
      ) : null}
      <DefaultToolApprovalBar {...props} />
    </div>
  );
}

// T8.4 — the question moment. The stock prompt already renders the pinned
// options ("… (Recommended)" / "Cancel — no release" / Stop); the console
// frames it as the mission checkpoint it is.
export function ClearanceAskUserPrompt(props: AskUserPromptProps) {
  return (
    <div className="ck-askuq">
      <div className="ck-askuq-heading">
        Mission checkpoint — the agent paused before any vault tool
      </div>
      <defaultSlots.AskUserPrompt {...props} />
    </div>
  );
}

type PendingApprovalPart = {
  type?: string;
  status?: { type?: string };
  approval?: { approved?: unknown; resolution?: unknown } | null;
};

function partAwaitsApproval(part: PendingApprovalPart): boolean {
  if (part.type !== "tool-call") return false;
  if (part.status?.type !== "requires-action") return false;
  const approval = part.approval;
  return approval != null && approval.approved === undefined && approval.resolution === undefined;
}

// T8.4 — the steps moment: same disclosure widget, labelled as the audited
// trail it maps to.
//
// The stock container auto-collapses the trail once a trailing text block
// looks like a final answer. In this flow the released chart, the receipt
// card, and the pending release_result approval all live inside that trail,
// so collapsing it hides the deliverable — and, during the pause, the
// Allow/Deny bar. The console owns the state instead: open by default,
// never auto-collapsed, manual toggle respected, and an undecided release
// approval re-opens the card so the decision is never hidden.
export function ClearanceAgentSteps(props: AgentStepsCardProps) {
  const awaitingApproval = useAuiState((state) =>
    (state.message.parts as readonly PendingApprovalPart[]).some(partAwaitsApproval),
  );
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (awaitingApproval) setExpanded(true);
  }, [awaitingApproval]);
  return (
    <AgentStepsCard
      {...props}
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
      borderColor="oklch(0.38 0.05 85)"
      background="oklch(0.2 0.012 265)"
    />
  );
}

// T8.4 — the reviewer moment. Subagents are deliberately disabled in this
// deployment (root-only enforcement), so any child agent in a stream is a
// policy violation worth shouting about, not a card to render politely.
export function ClearanceSubAgentCard(_props: SubAgentCardProps) {
  return (
    <div className="ck-subagent-warning" role="alert">
      Subagents are disabled in this deployment — a child agent in this stream would fail
      verification (approval_source_mismatch).
    </div>
  );
}

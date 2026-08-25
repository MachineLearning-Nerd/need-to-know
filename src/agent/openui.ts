// OpenUI card builders for the three clearance states.
//
// TrueForge renders fenced ```openui blocks as registered React components.
// These helpers produce the canonical text the model should emit so the card
// content is deterministically testable regardless of LLM temperature. In
// integration the model is prompted to emit these shapes; in tests we verify
// the strings directly.

export type ClearanceCardInput = {
  readonly status: "approved" | "denied" | "needs_review";
  readonly purpose: string;
  readonly audience: string;
  readonly queryId: string;
  readonly contractHash: string;
  readonly outputHash: string;
  readonly suppressedCells: number;
  readonly findings?: ReadonlyArray<{ readonly code: string; readonly detail?: string }>;
};

export type ReceiptCardInput = {
  readonly receiptId: string;
  readonly queryId: string;
  readonly contractHash: string;
  readonly outputHash: string;
  readonly datasetVersion: string;
  readonly policyVersion: string;
};

function escapeValue(value: string | number): string {
  return String(value).replace(/"/g, '\\"');
}

// Approved clearance card: purpose/audience tuple and both hashes are in the
// non-scrolling header region so they cannot be pushed off-screen by row data.
export function clearanceCard(input: ClearanceCardInput): string {
  const headerLabel = input.status === "approved" ? "approved" : "denied";

  const lines: string[] = ["```openui", `CardHeader("Release Clearance", "${headerLabel}")`];

  if (input.status === "approved") {
    lines.push(
      `Callout("Authorized mission — no raw rows, emails, phones, or free text released")`,
      `KeyValue("Purpose", "${escapeValue(input.purpose)}")`,
      `KeyValue("Audience", "${escapeValue(input.audience)}")`,
      `KeyValue("Query ID", "${escapeValue(input.queryId)}")`,
      `KeyValue("Contract hash", "${escapeValue(input.contractHash)}")`,
      `KeyValue("Output hash", "${escapeValue(input.outputHash)}")`,
      `KeyValue("Suppressed cells", "${input.suppressedCells}")`,
    );
  } else {
    lines.push(
      `Callout("Release blocked — review findings before retrying")`,
      `KeyValue("Status", "${escapeValue(input.status)}")`,
      `KeyValue("Query ID", "${escapeValue(input.queryId)}")`,
      `KeyValue("Purpose supplied", "${escapeValue(input.purpose)}")`,
      `KeyValue("Audience supplied", "${escapeValue(input.audience)}")`,
    );
    if (input.findings !== undefined && input.findings.length > 0) {
      const rows = input.findings
        .map((f) => `["${escapeValue(f.code)}", "${escapeValue(f.detail ?? "")}"]`)
        .join(", ");
      lines.push(`Table(["finding", "detail"], [${rows}])`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

// Receipt card: shown after a successful release transition. The receiptId and
// both hashes confirm that the vault persisted the exact approved payload.
export function receiptCard(input: ReceiptCardInput): string {
  return [
    "```openui",
    `CardHeader("Release Receipt", "released")`,
    `Callout("Synthetic release recorded — verify with: verify-receipt <receipt-file>")`,
    `KeyValue("Receipt ID", "${escapeValue(input.receiptId)}")`,
    `KeyValue("Query ID", "${escapeValue(input.queryId)}")`,
    `KeyValue("Contract hash", "${escapeValue(input.contractHash)}")`,
    `KeyValue("Output hash", "${escapeValue(input.outputHash)}")`,
    `KeyValue("Dataset version", "${escapeValue(input.datasetVersion)}")`,
    `KeyValue("Policy version", "${escapeValue(input.policyVersion)}")`,
    "```",
  ].join("\n");
}

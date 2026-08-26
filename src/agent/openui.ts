import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../contract/policy.js";

// This exact text is embedded in the production agent prompt. Its components
// and positional signatures match the OpenUI instructions shipped by the
// pinned TrueForge 0.1.4 runtime.
export const OPENUI_CARD_FORMAT = `## OpenUI card format

Emit one of these fenced blocks exactly. Replace placeholders only with the
typed values returned by Vault tools. For denials, render finding.code values only;
never render finding details or user-supplied text.

### Clearance card (approved)

\`\`\`openui
root = Stack([card])
card = Card([header, callout, details], "card", "column", "s")
header = CardHeader("Release Clearance", "approved")
callout = Callout("success", "Ready for human approval", "Authorized mission: ${ALLOWED_PURPOSE} → ${ALLOWED_AUDIENCE}")
details = TextContent("Purpose: ${ALLOWED_PURPOSE}\\nAudience: ${ALLOWED_AUDIENCE}\\nQuery ID: {queryId}\\nContract hash: {contractHash}\\nOutput hash: {outputHash}\\nSuppressed cells: {suppressedCells}", "small")
\`\`\`

### Denial card

\`\`\`openui
root = Stack([card])
card = Card([header, callout, details], "card", "column", "s")
header = CardHeader("Release Clearance", "denied")
callout = Callout("error", "Release blocked", "The deterministic contract did not authorize this request")
details = TextContent("Status: {status}\\nQuery ID: {queryId}\\nFinding codes: {commaSeparatedFindingCodes}", "small")
\`\`\`

### Receipt card

\`\`\`openui
root = Stack([card])
card = Card([header, callout, details], "card", "column", "s")
header = CardHeader("Release Receipt", "released")
callout = Callout("neutral", "Synthetic release recorded", "No external delivery was performed")
details = TextContent("Receipt ID: {receiptId}\\nQuery ID: {queryId}\\nContract hash: {contractHash}\\nOutput hash: {outputHash}\\nDataset version: {datasetVersion}\\nPolicy version: {policyVersion}", "small")
\`\`\``;

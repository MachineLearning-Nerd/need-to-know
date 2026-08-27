import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../contract/policy.js";
import type { ValidationResult } from "../contract/validate.js";
import type { ReleaseReceipt } from "../server/store.js";
import { quoteOpenUiValue as quoted } from "./value.js";

function cardBlock(children: readonly string[], statements: readonly string[]): string {
  return [
    "```openui",
    "root = Stack([card])",
    `card = Card([${children.join(", ")}], "card", "column", "s")`,
    ...statements,
    "```",
  ].join("\n");
}

export function renderDecisionCard(
  queryId: string,
  suppressedCells: number,
  verdict: ValidationResult,
): string {
  if (verdict.status !== "approved") {
    const findingCodes = verdict.findings.map(({ code }) => code).join(", ");
    return cardBlock(
      ["header", "callout", "status", "query", "findings"],
      [
        `header = CardHeader("Release Clearance", ${quoted(verdict.status)})`,
        'callout = Callout("error", "Release blocked", "The deterministic contract did not authorize this request")',
        `status = TextContent(${quoted(`Status: ${verdict.status}`)}, "small")`,
        `query = TextContent(${quoted(`Query ID: ${queryId}`)}, "small")`,
        `findings = TextContent(${quoted(`Finding codes: ${findingCodes}`)}, "small")`,
      ],
    );
  }

  return cardBlock(
    ["header", "callout", "purpose", "audience", "query", "contract", "output", "suppressed"],
    [
      'header = CardHeader("Release Clearance", "approved")',
      `callout = Callout("success", "Ready for human approval", ${quoted(`Authorized mission: ${ALLOWED_PURPOSE} → ${ALLOWED_AUDIENCE}`)})`,
      `purpose = TextContent(${quoted(`Purpose: ${ALLOWED_PURPOSE}`)}, "small")`,
      `audience = TextContent(${quoted(`Audience: ${ALLOWED_AUDIENCE}`)}, "small")`,
      `query = TextContent(${quoted(`Query ID: ${queryId}`)}, "small")`,
      `contract = TextContent(${quoted(`Contract hash: ${verdict.contractHash}`)}, "small")`,
      `output = TextContent(${quoted(`Output hash: ${verdict.outputHash}`)}, "small")`,
      `suppressed = TextContent(${quoted(`Suppressed cells: ${suppressedCells}`)}, "small")`,
    ],
  );
}

export function renderReceiptCard(receipt: ReleaseReceipt): string {
  return cardBlock(
    ["header", "callout", "receipt", "query", "contract", "output", "dataset", "policy"],
    [
      'header = CardHeader("Release Receipt", "released")',
      'callout = Callout("neutral", "Synthetic release recorded", "No external delivery was performed")',
      `receipt = TextContent(${quoted(`Receipt ID: ${receipt.receiptId}`)}, "small")`,
      `query = TextContent(${quoted(`Query ID: ${receipt.queryId}`)}, "small")`,
      `contract = TextContent(${quoted(`Contract hash: ${receipt.contractHash}`)}, "small")`,
      `output = TextContent(${quoted(`Output hash: ${receipt.outputHash}`)}, "small")`,
      `dataset = TextContent(${quoted(`Dataset version: ${receipt.datasetVersion}`)}, "small")`,
      `policy = TextContent(${quoted(`Policy version: ${receipt.policyVersion}`)}, "small")`,
    ],
  );
}

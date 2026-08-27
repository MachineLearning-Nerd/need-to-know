import { describe, expect, it } from "vitest";
import type { Sha256Hex } from "../contract/canonical.js";
import type { ValidationResult } from "../contract/validate.js";
import type { ReleaseReceipt } from "../server/store.js";
import { renderDecisionCard, renderReceiptCard } from "./cards.js";
import { lintOpenUiBlock } from "./lint.js";

const approved = {
  status: "approved",
  contractHash: "a".repeat(64) as Sha256Hex,
  outputHash: "b".repeat(64) as Sha256Hex,
} as const satisfies ValidationResult;

describe("vault-authored OpenUI cards", () => {
  it("renders clearance values from the exact verdict", () => {
    const card = renderDecisionCard("q-approved", 14, approved);
    expect(lintOpenUiBlock(card)).toEqual([]);
    expect(card).toContain(approved.contractHash);
    expect(card).toContain(approved.outputHash);
    expect(card).toContain("Suppressed cells: 14");
    expect(card).not.toContain("c".repeat(64));
    expect(card).toMatch(/^card = Card\(\[.*\], "card", "column", "s"\)$/m);
    expect(card).toContain('header = CardHeader("Release Clearance", "approved")');
    expect(card).toContain('callout = Callout("success",');
    for (const line of card.split("\n").filter((value) => value.includes("TextContent("))) {
      expect(line).toMatch(/, "small"\)$/);
    }
  });

  it("renders denial codes without finding details", () => {
    const card = renderDecisionCard("q-denied", 0, {
      status: "denied",
      findings: [{ code: "purpose_not_authorized", detail: "caller supplied detail" }],
    });
    expect(lintOpenUiBlock(card)).toEqual([]);
    expect(card).toContain("purpose_not_authorized");
    expect(card).not.toContain("caller supplied detail");
    expect(card).toContain('callout = Callout("error",');
  });

  it("labels needs-review decisions honestly", () => {
    const card = renderDecisionCard("q-review", 0, {
      status: "needs_review",
      findings: [{ code: "candidate_malformed" }],
    });
    expect(card).toContain('header = CardHeader("Release Clearance", "needs_review")');
    expect(card).not.toContain('header = CardHeader("Release Clearance", "denied")');
  });

  it("renders receipt values from the exact saved receipt", () => {
    const receipt = {
      receiptId: "r-receipt",
      queryId: "q-receipt",
      contractHash: approved.contractHash,
      outputHash: approved.outputHash,
      datasetVersion: "support-tickets-v1",
      policyVersion: "policy-v1",
    } as const satisfies ReleaseReceipt;
    const card = renderReceiptCard(receipt);
    expect(lintOpenUiBlock(card)).toEqual([]);
    for (const value of Object.values(receipt)) expect(card).toContain(value);
    expect(card).toContain('header = CardHeader("Release Receipt", "released")');
    expect(card).toContain('callout = Callout("neutral",');
  });

  it("keeps hostile server values inside one quoted statement", () => {
    const card = renderDecisionCard('q-1\\"]\nrogue = Callout("error", "x", "y', 0, approved);
    expect(lintOpenUiBlock(card)).toEqual([]);
    expect(card.split("\n").some((line) => line.startsWith("rogue ="))).toBe(false);
  });
});

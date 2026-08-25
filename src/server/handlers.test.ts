import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openVaultDatabase, type VaultDatabase } from "../vault/database.js";
import { CANARY } from "../vault/seed.js";
import { createVaultHandlers } from "./handlers.js";
import type { VaultToolHandlers } from "./mcp.js";

let db: VaultDatabase;
let handlers: VaultToolHandlers;

beforeAll(() => {
  db = openVaultDatabase();
  handlers = createVaultHandlers(db);
});

afterAll(() => {
  db.close();
});

function payload(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("describe_dataset", () => {
  it("returns schema, sensitivity labels, policy constants, and safe counts", () => {
    const result = handlers.describeDataset();
    expect(result.isError).toBeUndefined();
    const described = payload(result);
    expect(described.datasetVersion).toBe("support-tickets-v1");
    expect(described.mission).toEqual({
      purpose: "weekly support trend",
      audience: "support leadership",
    });
    expect(described.columns).toContainEqual({ name: "email", sensitivity: "sensitive" });
    expect(described.columns).toContainEqual({ name: "week", sensitivity: "safe_dimension" });
    expect(described.rowCount).toBe(db.rowCount());
    expect(described.minGroupSize).toBe(3);
  });

  it("never carries a row value, sensitive or otherwise", () => {
    const text = JSON.stringify(payload(handlers.describeDataset()));
    expect(text).not.toContain(CANARY.email);
    expect(text).not.toContain(CANARY.freeText);
    expect(text).not.toContain("CUST-");
    expect(text).not.toContain("2026-W");
  });
});

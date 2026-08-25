import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openVaultDatabase } from "../vault/database.js";
import { createVaultHandlers } from "./handlers.js";
import {
  errorResult,
  type RunningVaultServer,
  startVaultMcpServer,
  type VaultToolHandlers,
} from "./mcp.js";
import { createVaultStore } from "./store.js";

const failClosed = () => errorResult("not_implemented");

const stubHandlers: VaultToolHandlers = {
  describeDataset: failClosed,
  prepareAnalysis: failClosed,
  validateRelease: failClosed,
  releaseResult: failClosed,
  renderSafeChart: failClosed,
};

let server: RunningVaultServer;
let client: Client;

beforeAll(async () => {
  server = await startVaultMcpServer(0, stubHandlers);
  client = new Client({ name: "scaffold-test", version: "0.0.0" });
  // Same exactOptionalPropertyTypes-vs-SDK-types mismatch as the server side.
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://localhost:${server.port}/mcp`),
    ) as unknown as Transport,
  );
});

afterAll(async () => {
  await client.close();
  await server.close();
});

describe("vault MCP scaffold", () => {
  it("exposes exactly the five public tools and nothing else", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "describe_dataset",
      "prepare_analysis",
      "release_result",
      "render_safe_chart",
      "validate_release",
    ]);
  });

  it("marks only release_result destructive", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.destructiveHint, tool.name).toBe(tool.name === "release_result");
    }
  });

  it("fails closed on unimplemented handlers", async () => {
    const result = await client.callTool({ name: "describe_dataset", arguments: {} });
    expect(result.isError).toBe(true);
    const [first] = result.content as Array<{ text: string }>;
    expect(JSON.parse(first?.text ?? "{}").error).toBe("not_implemented");
  });

  it("rejects paths other than /mcp", async () => {
    const response = await fetch(`http://localhost:${server.port}/tickets`);
    expect(response.status).toBe(404);
  });
});

describe("end-to-end release flow over the wire", () => {
  it("prepares, validates, releases exactly once, and charts — no raw value ever crosses", async () => {
    const db = openVaultDatabase();
    const store = createVaultStore();
    const live = await startVaultMcpServer(0, createVaultHandlers(db, store));
    const liveClient = new Client({ name: "flow-test", version: "0.0.0" });
    await liveClient.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${live.port}/mcp`),
      ) as unknown as Transport,
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await liveClient.callTool({ name, arguments: args });
      const [first] = result.content as Array<{ text: string }>;
      return { isError: result.isError === true, body: JSON.parse(first?.text ?? "{}") };
    };
    try {
      const denied = await call("prepare_analysis", {
        purpose: "export customer emails",
        audience: "support leadership",
        dimensions: ["week"],
        metric: "ticket_count",
      });
      expect(denied.isError).toBe(true);

      const prepared = await call("prepare_analysis", {
        purpose: "weekly support trend",
        audience: "support leadership",
        dimensions: ["week", "region"],
        metric: "ticket_count",
      });
      expect(prepared.isError).toBe(false);
      const queryId = prepared.body.queryId as string;

      const verdict = await call("validate_release", { queryId });
      expect(verdict.body.status).toBe("approved");

      const hashes = {
        contractHash: verdict.body.contractHash as string,
        outputHash: verdict.body.outputHash as string,
      };
      const released = await call("release_result", { queryId, ...hashes });
      expect(released.isError).toBe(false);
      const replay = await call("release_result", { queryId, ...hashes });
      expect(replay.isError).toBe(true);
      expect(store.getReceipt(queryId)?.receiptId).toBe(released.body.receipt.receiptId);

      const chart = await call("render_safe_chart", { queryId });
      expect(chart.isError).toBe(false);

      for (const body of [prepared.body, verdict.body, released.body, chart.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain("@");
        expect(text).not.toContain("CUST-");
      }
    } finally {
      await liveClient.close();
      await live.close();
      db.close();
    }
  });
});

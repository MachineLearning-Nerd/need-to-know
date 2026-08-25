import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  errorResult,
  type RunningVaultServer,
  startVaultMcpServer,
  type VaultToolHandlers,
} from "./mcp.js";

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

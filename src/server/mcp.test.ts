import { request as httpRequest } from "node:http";

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

  it("annotates every tool truthfully: destructive and read-only hints", async () => {
    const { tools } = await client.listTools();
    // prepare_analysis persists a candidate, release_result transitions state;
    // the other three never write.
    const readOnly: Record<string, boolean> = {
      describe_dataset: true,
      prepare_analysis: false,
      validate_release: true,
      release_result: false,
      render_safe_chart: true,
    };
    for (const tool of tools) {
      expect(tool.annotations?.destructiveHint, tool.name).toBe(tool.name === "release_result");
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(readOnly[tool.name]);
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
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

  it("never echoes an internal error message from any tool", async () => {
    const boom = () => {
      throw new Error("INTERNAL_MARKER_/Users/secret/path.ts:42 sqlite: no such column: email");
    };
    const throwing = await startVaultMcpServer(0, {
      describeDataset: boom,
      prepareAnalysis: boom,
      validateRelease: boom,
      releaseResult: boom,
      renderSafeChart: boom,
    });
    const throwingClient = new Client({ name: "throw-test", version: "0.0.0" });
    await throwingClient.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${throwing.port}/mcp`),
      ) as unknown as Transport,
    );
    try {
      for (const [name, args] of [
        ["describe_dataset", {}],
        ["prepare_analysis", { purpose: "p", audience: "a", dimensions: [], metric: "m" }],
        ["validate_release", { queryId: "q-1" }],
        ["release_result", { queryId: "q-1", contractHash: "x", outputHash: "y" }],
        ["render_safe_chart", { queryId: "q-1" }],
      ] as const) {
        const result = await throwingClient.callTool({ name, arguments: args });
        const text = JSON.stringify(result.content);
        expect(text, name).not.toContain("INTERNAL_MARKER");
        expect(JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? "{}").error).toBe(
          "internal_error",
        );
      }
    } finally {
      await throwingClient.close();
      await throwing.close();
    }
  });

  it("refuses non-loopback Host and Origin headers against DNS rebinding", async () => {
    // fetch strips Host overrides (forbidden header), so the rebound request
    // goes through node:http, which sends exactly what it is told.
    const reboundStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "localhost",
          port: server.port,
          path: "/mcp",
          method: "POST",
          headers: { "content-type": "application/json", host: "evil.example:8788" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end("{}");
    });
    expect(reboundStatus).toBe(403);

    const crossOrigin = await fetch(`http://localhost:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);

    const sameOrigin = await fetch(`http://localhost:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://localhost:${server.port}` },
      body: "{}",
    });
    // A loopback Origin must get past our guard and reach the SDK, which
    // answers on its own terms (406 here — a bare fetch sends no MCP Accept
    // header). Asserting the body pins "not blocked by us" precisely; a bare
    // status check would also pass on an unrelated 500.
    expect(sameOrigin.status).not.toBe(403);
    expect(await sameOrigin.text()).not.toContain("forbidden_origin");
  });

  it("refuses GET so no caller can pin an open stream", async () => {
    const response = await fetch(`http://localhost:${server.port}/mcp`, { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await response.text();
    // The server must still shut down promptly with no stream held open.
    const idle = await startVaultMcpServer(0, stubHandlers);
    await fetch(`http://localhost:${idle.port}/mcp`, { method: "GET" }).then((r) => r.text());
    await idle.close();
  });

  it("refuses oversized bodies before buffering them", async () => {
    const response = await fetch(`http://localhost:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"pad":"${"x".repeat(2_000_000)}"}`,
    });
    expect(response.status).toBe(413);
  });

  it("refuses chunked bodies that carry no length up front", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const response = await fetch(`http://localhost:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    });
    expect(response.status).toBe(411);
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

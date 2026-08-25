import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

// The vault's public surface is exactly these five tools — no raw-row query
// tool exists, so raw rows cannot leave the vault through any request shape.
export type ToolResult = {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly isError?: boolean;
};

export type VaultToolHandlers = {
  describeDataset(): ToolResult;
  prepareAnalysis(input: {
    purpose: string;
    audience: string;
    dimensions: string[];
    metric: string;
  }): ToolResult;
  validateRelease(input: { queryId: string }): ToolResult;
  releaseResult(input: { queryId: string; contractHash: string; outputHash: string }): ToolResult;
  renderSafeChart(input: { queryId: string }): ToolResult;
};

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function errorResult(code: string, detail?: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, detail }) }],
    isError: true,
  };
}

// The SDK echoes a thrown Error's message verbatim to the caller, which would
// leak internal paths and database errors. Every tool call is wrapped so a
// throw becomes a generic denial instead.
function guarded(run: () => ToolResult): ToolResult {
  try {
    return run();
  } catch {
    return errorResult("internal_error");
  }
}

function buildMcpServer(handlers: VaultToolHandlers): McpServer {
  const server = new McpServer({ name: "need-to-know-vault", version: "0.1.0" });

  server.registerTool(
    "describe_dataset",
    {
      description:
        "Schema, sensitivity labels, and safe row counts for the support-tickets dataset. Never returns row values.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => guarded(() => handlers.describeDataset()),
  );

  server.registerTool(
    "prepare_analysis",
    {
      description:
        "Authorize a mission and run an allowlisted aggregate plan inside the vault. Returns a bounded release candidate keyed by queryId; small cells are suppressed before anything leaves.",
      inputSchema: {
        purpose: z.string(),
        audience: z.string(),
        dimensions: z.array(z.string()),
        metric: z.string(),
      },
      // Not read-only: preparing persists the candidate under a new queryId.
      // Not destructive either — it only adds state, never transitions it.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    (input) => guarded(() => handlers.prepareAnalysis(input)),
  );

  server.registerTool(
    "validate_release",
    {
      description:
        "Run the deterministic ReleaseContract over the vault-stored candidate for a queryId. Returns the verdict, findings, and contract/output hashes.",
      inputSchema: { queryId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (input) => guarded(() => handlers.validateRelease(input)),
  );

  server.registerTool(
    "release_result",
    {
      description:
        "Release the approved aggregate for a queryId. Revalidates the vault-stored candidate and both hashes at execution time; any mismatch is denied with an audit record and zero release side effects.",
      inputSchema: {
        queryId: z.string(),
        contractHash: z.string(),
        outputHash: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    (input) => guarded(() => handlers.releaseResult(input)),
  );

  server.registerTool(
    "render_safe_chart",
    {
      description:
        "Chart-ready view of a released aggregate for a queryId. Only works after a successful release.",
      inputSchema: { queryId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    (input) => guarded(() => handlers.renderSafeChart(input)),
  );

  return server;
}

export type RunningVaultServer = {
  readonly port: number;
  close(): Promise<void>;
};

// Generous for real tool calls (the largest legitimate payload is two hashes
// and a queryId), tight enough that a hostile body cannot balloon memory.
const MAX_REQUEST_BODY_BYTES = 1_048_576;

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Stateless transport, fresh server per request: tool calls are independent
// and all durable state lives in the vault store, so there is no MCP session
// to manage and nothing for a stale session to leak.
export function startVaultMcpServer(
  port: number,
  handlers: VaultToolHandlers,
): Promise<RunningVaultServer> {
  const httpServer = createServer((request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    // Loopback binding does not stop DNS rebinding: a page on evil.com whose
    // DNS now points at loopback sends same-origin requests straight here.
    // Host must be a loopback name and any Origin present must be one too —
    // non-browser clients send no Origin and pass. (MCP Streamable HTTP
    // requires Origin validation.)
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    if (!LOOPBACK_HOST.test(host) || (origin !== undefined && !LOOPBACK_ORIGIN.test(origin))) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "forbidden_origin" }));
      return;
    }
    // SDK 1.30 reads the body with no size cap (the old 4 MB guard is gone),
    // so an oversized request must be refused before it is buffered. Chunked
    // bodies carry no length up front, so they are refused outright rather
    // than trusted.
    if (request.method === "POST" && request.headers["transfer-encoding"] !== undefined) {
      response.writeHead(411, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "length_required" }));
      return;
    }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BODY_BYTES) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    // The vault only answers tool calls; it never pushes server-initiated
    // messages, so the standalone GET SSE stream has no purpose and would pin
    // an McpServer and its socket for as long as a caller cares to hold it.
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json", allow: "POST" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }
    const server = buildMcpServer(handlers);
    // No sessionIdGenerator: stateless mode — all durable state lives in the
    // vault store, so there is no MCP session for a stale transport to leak.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    server
      // The SDK's transport classes type optional callbacks as `| undefined`
      // getters, which exactOptionalPropertyTypes rejects structurally even
      // though the runtime shape matches — confine the mismatch to this cast.
      .connect(transport as unknown as Transport)
      .then(() => transport.handleRequest(request, response))
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
        }
        response.end(JSON.stringify({ error: "internal_error" }));
      });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    // The vault process holds raw sensitive rows in memory: its tool surface
    // binds to loopback only, never to every interface.
    httpServer.listen(port, "localhost", () => {
      const address = httpServer.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            httpServer.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

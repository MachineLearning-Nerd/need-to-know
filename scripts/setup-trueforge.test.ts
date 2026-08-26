import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server?.closeAllConnections();
  server = undefined;
});

function runSetup(
  baseUrl: string,
  apiKey: string,
): Promise<{
  code: number | null;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "./scripts/register-ts-loader.mjs", "scripts/setup-trueforge.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, TRUEFORGE_BASE_URL: baseUrl, ZAI_API_KEY: apiKey },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

describe("setup-trueforge", () => {
  it("never repeats a provider credential from an error response", async () => {
    const fakeKey = "test-secret-never-log";
    const baseUrl = await new Promise<string>((resolve) => {
      server = createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ echoedRequest: body }));
        });
      });
      server.listen(0, "localhost", () => {
        const address = server?.address();
        resolve(`http://localhost:${typeof address === "object" ? address?.port : 0}`);
      });
    });

    const { stderr } = await runSetup(baseUrl, fakeKey);

    expect(stderr).toContain("-> 500");
    expect(stderr).not.toContain(fakeKey);
  });

  it("fails closed when the existing Vault MCP URL differs", async () => {
    const requests: string[] = [];
    const baseUrl = await new Promise<string>((resolve) => {
      server = createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        response.setHeader("content-type", "application/json");
        if (request.method === "POST" && request.url === "/api/v1/settings/model-providers") {
          response.writeHead(201).end("{}");
          return;
        }
        if (request.method === "POST" && request.url === "/api/v1/settings/mcp-servers") {
          response.writeHead(409).end("{}");
          return;
        }
        if (request.method === "GET" && request.url === "/api/v1/settings/mcp-servers") {
          response.writeHead(200).end(
            JSON.stringify({
              data: [
                {
                  manifest: {
                    type: "remote",
                    name: "vault",
                    url: "http://localhost:9999/mcp",
                  },
                },
              ],
            }),
          );
          return;
        }
        response.writeHead(500).end("{}");
      });
      server.listen(0, "localhost", () => {
        const address = server?.address();
        resolve(`http://localhost:${typeof address === "object" ? address?.port : 0}`);
      });
    });

    const result = await runSetup(baseUrl, "test-key");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MCP server vault");
    expect(result.stderr).toContain("different settings");
    expect(requests).toContain("GET /api/v1/settings/mcp-servers");
    expect(requests.some((request) => request.includes("/agents"))).toBe(false);
  });

  it("fails closed when the existing provider endpoint differs", async () => {
    const requests: string[] = [];
    const baseUrl = await new Promise<string>((resolve) => {
      server = createServer((request, response) => {
        requests.push(`${request.method} ${request.url}`);
        response.setHeader("content-type", "application/json");
        if (request.method === "POST" && request.url === "/api/v1/settings/model-providers") {
          response.writeHead(409).end("{}");
          return;
        }
        if (request.method === "GET" && request.url === "/api/v1/settings/model-providers") {
          response.writeHead(200).end(
            JSON.stringify({
              data: [
                {
                  manifest: {
                    type: "custom",
                    name: "zai",
                    base_url: "https://wrong.invalid/v1",
                    models: [{ model_id: "glm-5.2" }],
                  },
                },
              ],
            }),
          );
          return;
        }
        response.writeHead(500).end("{}");
      });
      server.listen(0, "localhost", () => {
        const address = server?.address();
        resolve(`http://localhost:${typeof address === "object" ? address?.port : 0}`);
      });
    });

    const result = await runSetup(baseUrl, "test-key");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("model provider zai");
    expect(result.stderr).toContain("different settings");
    expect(requests).toEqual([
      "POST /api/v1/settings/model-providers",
      "GET /api/v1/settings/model-providers",
    ]);
  });
});

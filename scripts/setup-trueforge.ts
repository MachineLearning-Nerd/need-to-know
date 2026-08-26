#!/usr/bin/env node
// setup-trueforge: register the model provider, the vault MCP server, and the
// need-to-know agent on a running TrueForge instance.
//
// Usage:  setup-trueforge            (TRUEFORGE_BASE_URL, ZAI_API_KEY in env)
//
// Idempotent by construction:
//   - provider and MCP-server registration tolerate 409 (already registered)
//   - the agent is upserted by id: list agents, PUT /agents/{id} {manifest}
//     when a name match exists, POST /agents when absent. The agents API is
//     id-routed on trueforge 0.1.4 — name-based routes silently no-op.
//
// Base URLs must use localhost, never 127.0.0.1: trueforge 0.1.4 listens on
// IPv6 only and refuses the IPv4 literal.

import { AGENT_NAME, buildAgentManifest, VAULT_MCP_SERVER_NAME } from "../src/agent/manifest.js";

const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891";
const vaultUrl = process.env.VAULT_MCP_URL ?? "http://localhost:8788/mcp";
const providerName = process.env.MODEL_PROVIDER_NAME ?? "zai";
const modelId = process.env.ZAI_OPENAI_MODEL ?? "glm-5.2";

async function api(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { "content-type": "application/json" },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = new Error(`${options.method ?? "GET"} ${path} -> ${response.status}`);
    (error as Error & { status: number; body: unknown }).status = response.status;
    (error as Error & { status: number; body: unknown }).body = body;
    throw error;
  }
  return body;
}

// A 409 means the resource already exists — the state we want.
async function tolerateConflict(work: Promise<unknown>, label: string): Promise<void> {
  try {
    await work;
    process.stdout.write(`setup-trueforge: registered ${label}\n`);
  } catch (error) {
    if ((error as { status?: number }).status === 409) {
      process.stdout.write(`setup-trueforge: ${label} already registered\n`);
      return;
    }
    throw error;
  }
}

function listedAgents(body: unknown): Array<{ id: string; name: string }> {
  const items = Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? []);
  return (items as Array<Record<string, unknown>>)
    .filter((item) => typeof item.id === "string" && typeof item.name === "string")
    .map((item) => ({ id: item.id as string, name: item.name as string }));
}

async function main(): Promise<void> {
  const apiKey = process.env.ZAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    process.stderr.write("setup-trueforge: ZAI_API_KEY is not set\n");
    process.exit(1);
  }

  await tolerateConflict(
    api("/settings/model-providers", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          type: "custom",
          name: providerName,
          base_url: process.env.ZAI_OPENAI_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4",
          auth: { api_key: apiKey },
          models: [{ model_id: modelId, name: modelId, properties: { context_length: 32768 } }],
        },
      }),
    }),
    `model provider ${providerName}`,
  );

  await tolerateConflict(
    api("/settings/mcp-servers", {
      method: "POST",
      body: JSON.stringify({
        manifest: {
          type: "remote",
          name: VAULT_MCP_SERVER_NAME,
          url: vaultUrl,
          description: "Need-to-Know synthetic vault (aggregate-only release tools)",
        },
      }),
    }),
    `MCP server ${VAULT_MCP_SERVER_NAME} -> ${vaultUrl}`,
  );

  const manifest = buildAgentManifest(providerName, modelId);
  const existing = listedAgents(await api("/agents")).find((agent) => agent.name === AGENT_NAME);
  if (existing === undefined) {
    await api("/agents", {
      method: "POST",
      body: JSON.stringify({ name: AGENT_NAME, manifest }),
    });
    process.stdout.write(`setup-trueforge: created agent ${AGENT_NAME}\n`);
  } else {
    await api(`/agents/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ manifest }),
    });
    process.stdout.write(`setup-trueforge: updated agent ${AGENT_NAME} (${existing.id})\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`setup-trueforge: ${(error as Error).message}\n`);
  const body = (error as { body?: unknown }).body;
  if (body !== undefined) process.stderr.write(`${JSON.stringify(body)}\n`);
  process.exit(1);
});

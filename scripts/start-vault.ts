#!/usr/bin/env node
// start-vault: open the Need-to-Know Vault MCP server.
//
// Usage:
//   start-vault [--port <n>]
//
// Starts the Vault MCP server on the given port (default: 8788, or $VAULT_PORT).
// Prints the listening URL on stdout so TrueForge can be pointed at it.
// The vault uses an in-memory SQLite database seeded with synthetic data; no
// file path is needed and no real data is ever loaded.
//
// Register the server in TrueForge once it is running:
//   POST /api/v1/settings/mcp-servers
//   { "manifest": { "type": "remote", "name": "vault",
//                   "url": "http://localhost:<port>/mcp",
//                   "description": "Need-to-Know synthetic vault" } }
//
// Then register the agent manifest (see src/agent/manifest.ts).

import { createVaultHandlers } from "../src/server/handlers.js";
import { startVaultMcpServer } from "../src/server/mcp.js";
import { createVaultStore } from "../src/server/store.js";
import { openVaultDatabase } from "../src/vault/database.js";

function parsePort(args: string[]): number {
  const idx = args.indexOf("--port");
  if (idx !== -1 && args[idx + 1] !== undefined) {
    const parsed = Number(args[idx + 1]);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    process.stderr.write(`start-vault: invalid port: ${args[idx + 1]}\n`);
    process.exit(1);
  }
  const env = Number(process.env.VAULT_PORT ?? 8788);
  return Number.isInteger(env) && env > 0 && env < 65536 ? env : 8788;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2));
  const db = openVaultDatabase();
  const store = createVaultStore();
  const handlers = createVaultHandlers(db, store);
  const server = await startVaultMcpServer(port, handlers);

  process.stdout.write(`vault-mcp listening at http://localhost:${server.port}/mcp\n`);
  process.stdout.write(
    `Register in TrueForge: POST /api/v1/settings/mcp-servers with url http://localhost:${server.port}/mcp\n`,
  );

  const shutdown = (): void => {
    server
      .close()
      .then(() => {
        db.close();
        process.exit(0);
      })
      .catch(() => process.exit(1));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`start-vault: ${message}\n`);
  process.exit(1);
});

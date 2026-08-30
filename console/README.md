# Clearance Console

A custom-branded TrueForge UI for the Need-to-Know release officer: the same
server and sessions as the bundled UI, rendered as a clearance workflow.

- **Evidence rail** — mission, contract verdict, hashes, and ledger/receipt
  state alongside the conversation, parsed exclusively from the vault's tool
  responses in the current session.
- **Release approval hero** — the approval bar for `release_result` shows the
  full human-approved tuple (purpose, audience, columns, suppressed cells,
  contract and output hashes) read from the pending tool call itself.
- **Checkpoint framing** — Ask-User-Question pauses and agent-step trails are
  labelled as the audited moments they map to; any subagent card renders as a
  policy violation, because this deployment disables subagents.

## Run

```bash
cd console
npm install
npm run dev        # http://localhost:5178, proxies /api to TRUEFORGE_BASE_URL
```

Prerequisites: TrueForge running (default `http://localhost:8891`), the vault
(`npm run start-vault` in the repo root), and the agent registered
(`npm run setup-trueforge`). Select the **need-to-know** agent and start a
session.

Session deletion is an operator convenience scoped to this console. Published
evidence sessions have no delete action here, and the console adapter rejects
attempts to delete them. Direct administrative access to the TrueForge API is
outside this UI safeguard.

## Fallback

The console adds no backend: it drives the same TrueForge server as the
bundled UI. If the console is unavailable, open the bundled UI directly at the
TrueForge base URL (`http://localhost:8891`) — every session works identically
in both, and sessions started in one are visible in the other.

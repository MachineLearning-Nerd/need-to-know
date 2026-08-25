# Need-to-Know

A data-steward agent on TrueForge that can analyze sensitive synthetic records behind a Vault MCP boundary, but cannot execute a release until a deterministic contract validates it and a human approves it through TrueForge native approval.

> The agent can analyze the mission, but it cannot release what the mission does not authorize.

Built for the TrueForge Agent Harness Hackathon (2026-08-24 → 2026-08-30). All data is synthetic.

## How it works (target architecture)

Each component below lands in its own pull request during the build window — see Status for what exists today.

A data steward asks the agent for numbers from a support-ticket database that contains things nobody should export: emails, phone numbers, raw free text. The agent can help — but the raw data never passes through it, and release is not its decision to make.

1. **Vault MCP boundary.** Raw rows live in a local SQLite vault behind an MCP server that exposes exactly five tools — `describe_dataset`, `prepare_analysis`, `render_safe_chart`, `validate_release`, `release_result`. There is no raw-row query tool; identifiers and free text cannot leave the vault through the public tool schema.
2. **Deterministic release contract.** A typed, LLM-free library decides what may be released: one fixed authorized purpose/audience pair, allowlisted aggregate columns, minimum group size k ≥ 3, no unapproved joins or filters, content hashes over the exact payload. The model proposes; deterministic code disposes.
3. **Human approval on the real action.** `release_result` is approval-gated through TrueForge's native approval flow, and the tool revalidates the full contract and hashes at execution time. On any mismatch, missing authorization, small cell, or error: fail closed — an audit record is written and no release happens.
4. **Verifiable evidence.** Every attempt links to TrueForge session/turn/event IDs in a release ledger. A `verify-receipt` CLI recomputes the hashes and checks the persisted event trail, so a reviewer can verify a release claim without trusting this repo's word for it.

The interesting failure is the point: ask it to export customer emails and you get a deterministic denial with reasons, zero side effects, and an audit trail.

## Getting started

Requires Node.js ≥ 24.

```bash
npm install
npm test          # unit tests (no LLM required)
npm run typecheck
npm run lint
```

### Running the full agent flow

You need a running TrueForge server (`@truefoundry/trueforge@0.1.4`) and a model provider API key.

**Step 1 — start the Vault MCP server:**

```bash
npm run start-vault            # listens on http://localhost:8788/mcp
# or: npm run start-vault -- --port 9000
```

**Step 2 — register the vault and agent in TrueForge:**

```bash
# Register the Vault MCP server (run once, or after TrueForge restarts)
curl -s -X POST http://localhost:8890/api/v1/settings/mcp-servers \
  -H 'content-type: application/json' \
  -d '{"manifest":{"type":"remote","name":"vault","url":"http://localhost:8788/mcp","description":"Need-to-Know synthetic vault"}}'

# Register the agent (run once; see src/agent/manifest.ts for the full schema)
# Replace <provider> and <model-id> with your TrueForge model provider and model.
curl -s -X POST http://localhost:8890/api/v1/agents \
  -H 'content-type: application/json' \
  -d '{"name":"need-to-know","manifest":{...}}'
```

The `buildAgentManifest(provider, modelId)` function in `src/agent/manifest.ts` produces the exact manifest object for the POST body.

**Step 3 — open the TrueForge UI** at `http://localhost:8890` and start a session with the `need-to-know` agent.

### Verifying a release receipt

After a successful release the agent returns a receipt. Save it to a file and verify it:

```bash
npm run verify-receipt -- receipt.json
# verify-receipt: PASS receipt=r-1 query=q-1
```

## AI-assisted development disclosure

This project is built with AI coding assistants (Claude Code and Codex as pair programmers, Qodo for pull-request review). Every change is human-reviewed before merge, and the team owns and can explain the architecture and all technical decisions. All data in this repository is synthetic; no real personal data is used anywhere.

## Status

Phase 5 of the build window complete. All five components are wired:

- **Phase 1** - Vault SQLite database: synthetic support-ticket data with canary row and small-cell case.
- **Phase 2** - Deterministic ReleaseContract library: allowlists, group-size enforcement, canonical hashing.
- **Phase 3** - Vault MCP server: five-tool boundary (describe, prepare, chart, validate, release). No raw-row tool.
- **Phase 4** - `verify-receipt` CLI: recomputes hashes, checks persisted event ordering, fails closed on partial fetches.
- **Phase 5** - TrueForge agent wiring: root prompt, parallel subagents (planner/privacy-reviewer/evidence-reviewer), Ask User Questions, OpenUI clearance/denial/receipt cards, agent manifest with `require_approval_for_tools: ["release_result"]`.

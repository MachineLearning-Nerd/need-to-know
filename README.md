# Need-to-Know

A data-steward agent on TrueForge that can analyze sensitive synthetic records behind a Vault MCP boundary, but cannot execute a release until a deterministic contract validates it and a human approves it through TrueForge native approval.

> The agent can analyze the mission, but it cannot release what the mission does not authorize.

Built for the TrueForge Agent Harness Hackathon (2026-08-24 → 2026-08-30). All data is synthetic.

## How it works

A data steward asks the agent for numbers from a support-ticket database that contains things nobody should export: emails, phone numbers, raw free text. The agent can help — but the raw data never passes through it, and release is not its decision to make.

1. **Vault MCP boundary.** Raw rows live in a local SQLite vault behind an MCP server that exposes exactly five tools — `describe_dataset`, `prepare_analysis`, `render_safe_chart`, `validate_release`, `release_result`. There is no raw-row query tool; identifiers and free text cannot leave the vault through the public tool schema.
2. **Deterministic release contract.** A typed, LLM-free library decides what may be released: one fixed authorized purpose/audience pair, allowlisted aggregate columns, minimum group size k ≥ 3, no unapproved joins or filters, content hashes over the exact payload. The model proposes; deterministic code disposes.
3. **Human approval on the real action.** `release_result` is approval-gated through TrueForge's native approval flow, and the tool revalidates the full contract and hashes at execution time. On any mismatch, missing authorization, small cell, or error: fail closed — an audit record is written and no release happens.
4. **Verifiable evidence.** Gate A bundles a successful receipt and candidate with an inline agent spec, the TrueForge session/turn IDs, and the persisted events that produced them. The `verify-receipt` CLI checks the expected spec before and after refetching that live session, recomputes both hashes, and checks the root-thread prepare → validate → approval → release trail. This is operational demo evidence, not proof against a TrueForge administrator who can rewrite both session configuration and stored events. The Vault's in-memory audit log separately records query outcomes; it does not claim TrueForge event linkage.

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

**Step 0 — start TrueForge:**

```bash
npx @truefoundry/trueforge@0.1.4 --port 8891
```

**Step 1 — start the Vault MCP server:**

```bash
npm run start-vault            # listens on http://localhost:8788/mcp
# or: npm run start-vault -- --port 9000
```

**Step 2 — register the vault and agent in TrueForge:**

```bash
# Registers the model provider, the vault MCP server, and the agent in one
# idempotent pass (409 = already registered; the agent is upserted by id).
ZAI_API_KEY=<key> TRUEFORGE_BASE_URL=http://localhost:8891 npm run setup-trueforge
```

The manifest comes from `buildAgentManifest(provider, modelId)` in `src/agent/manifest.ts`; the script is `scripts/setup-trueforge.ts`. Base URLs must use `localhost` — trueforge 0.1.4 listens on IPv6 only and refuses `127.0.0.1`.

**Step 3 — open the TrueForge UI** at `http://localhost:8891` and start a session with the `need-to-know` agent.

**Optional — live gates:** `npm run gate-a` proves the deny/allow approval flow against the running server and writes a verifiable bundle; `npm run gate-b` re-checks the persisted events for canary and raw-PII absence.

### Verifying a release receipt

Gate A writes the complete evidence bundle consumed by the verifier. A bare receipt is intentionally insufficient because it carries no persisted approval evidence.

```bash
# Live mode — refetches the named session and requires the bundle's turn list
# to equal the session's actual persisted turns:
TRUEFORGE_BASE_URL=http://localhost:8891 npm run verify-receipt -- gate-a-bundle.json
# verify-receipt: PASS receipt=r-<uuid> query=q-<uuid>

# Offline mode — no server needed; checks the bundle's embedded events and
# says so on stderr (weaker: embedded events come with the bundle):
npm run verify-receipt -- gate-a-bundle.json
```

## Known limitations

What the evidence chain does and does not prove is recorded honestly in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## AI-assisted development disclosure

This project is built with AI coding assistants (Claude Code and Codex as pair programmers, Qodo for pull-request review). Every change is human-reviewed before merge, and the team owns and can explain the architecture and all technical decisions. All data in this repository is synthetic; no real personal data is used anywhere.

## Status

Phase 5 of the build window complete. All five components are wired:

- **Phase 1** - Vault SQLite database: synthetic support-ticket data with canary row and small-cell case.
- **Phase 2** - Deterministic ReleaseContract library: allowlists, group-size enforcement, canonical hashing.
- **Phase 3** - Vault MCP server: five-tool boundary (describe, prepare, chart, validate, release). No raw-row tool.
- **Phase 4** - TrueForge agent wiring: root prompt, Ask User Questions, pinned-valid OpenUI clearance/denial/receipt cards, and `require_approval_for_tools: ["release_result"]`.
- **Phase 5** - Session-bound `verify-receipt` evidence: live token-paginated event fetch, exact approval/release witness checks, and canary/raw-boundary gates. The verifier ships 89 dedicated tests (53 verify, 16 event-fetch, 10 live-session, 10 boundary) covering the full fail-closed enumeration: malformed receipts, missing/unavailable/partial events, unknown event types, mismatched session/turn IDs, hash mismatches, approval-ordering violations, duplicate approval and decision events, and canary presence.

Dynamic subagents are deliberately disabled in this pinned build: TrueForge 0.1.4 children inherit the root's Vault tools, so enabling them would violate the root-only `release_result` invariant.

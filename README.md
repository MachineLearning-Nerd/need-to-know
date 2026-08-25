# Need-to-Know

A data-steward agent on TrueForge that can analyze sensitive synthetic records behind a Vault MCP boundary, but cannot execute a release until a deterministic contract validates it and a human approves it through TrueForge native approval.

> The agent can analyze the mission, but it cannot release what the mission does not authorize.

Built for the TrueForge Agent Harness Hackathon (2026-08-24 → 2026-08-30). All data is synthetic.

## How it works

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

Instructions for running the Vault MCP server and the TrueForge agent land as those pieces merge (this repo is being built in public during the hackathon window — see Status).

## AI-assisted development disclosure

This project is built with AI coding assistants (Claude Code and Codex as pair programmers, Qodo for pull-request review). Every change is human-reviewed before merge, and the team owns and can explain the architecture and all technical decisions. All data in this repository is synthetic; no real personal data is used anywhere.

## Status

Day 2 of the build window. Current phase: project bootstrap (tooling, CI, docs). The Vault MCP server, release-contract library, and TrueForge agent wiring follow as separate pull requests.

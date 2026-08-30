# Need-to-Know — submission write-up

## The one invariant

For one typed synthetic release tool, deterministic code authorizes one fixed
purpose and audience, TrueForge pauses the real release action for a human
decision, and a receipt links the resulting synthetic transition to persisted
events that a judge can verify.

Everything in this repository exists to make that sentence true, provable,
and honest about its edges.

## Why each piece is necessary

- **The vault boundary** (five MCP tools, no raw-row query) makes the unsafe
  action *unavailable*, not merely discouraged: identifiers and free text
  cannot leave through the public tool schema at all.
- **The deterministic contract** decides what may be released — fixed
  purpose/audience, allowlisted aggregate columns, k ≥ 3, content hashes over
  the exact payload — so no LLM verdict sits anywhere on the authorization
  path. The model proposes; deterministic code disposes.
- **Native approval on the real action** pauses `release_result` for a human,
  and the vault revalidates the full tuple and both hashes at execution time.
  The approval reference is structural, not cryptographic; the execution-time
  revalidation is what binds the human's decision to the exact artifact.
- **Persisted-event verification** (`verify-receipt`) refuses to trust a bare
  receipt: offline mode recomputes hashes and walks the root-thread prepare →
  validate → approval → release trail in the embedded events. Live mode also
  checks the frozen inline agent spec's security-relevant fields and refetches
  the server's stored turns and events.
- **In a passing run, the sandbox** runs exactly one post-release step —
  recomputing the released payload's sha256 from the canonical bytes the
  vault supplies — and Gate A independently recomputes that digest from the
  persisted command bytes, so neither the model's prose nor the sandbox's
  stdout is taken on faith.

## TrueForge feature coverage

| Feature | How it is used | Evidence |
| --- | --- | --- |
| MCP server integration | Vault registered as the agent's only MCP server; five typed tools | `scripts/setup-trueforge.ts`, gate runs |
| Native tool approval | `require_approval_for_tools: ["release_result"]`; turn pauses for the human on the real action | Gate A allow sessions in [RUNS.md](RUNS.md); denial sessions prove zero release |
| Ask User Questions | Missing mission fields and exception requests pause with exact pinned options before any vault call | Gate A missing-purpose and exception paths |
| Generative UI (OpenUI) | Vault-authored clearance/denial/receipt/chart cards relayed verbatim; byte-for-byte relay is gate-checked | Gate A relay assertion |
| Sandbox | One pinned post-release hash recomputation over released canonical bytes | Gate A sandbox proof chain; attempts 9–13 |
| Event persistence | The verifier and every gate assert on refetched persisted events, not the live stream | `src/verify/`, gates A–C |
| SSE reconnect | Abort mid-turn, resume by sequence number, stitched stream equal to the persisted turn | `npm run reconnect-proof` |
| Inline agent spec | Sessions snapshot the manifest; live verification requires its security-relevant fields to match the pinned build | `src/verify/live.ts` |
| Custom UI (`@truefoundry/trueforge-ui`) | Clearance Console: evidence rail from vault tool responses, approval bar showing the exact pending tuple and hashes | `console/` |
| Dynamic subagents | Deliberately disabled — 0.1.4 children inherit vault tools, which would break root-only release; the verifier rejects non-root chains | [LIMITATIONS.md](LIMITATIONS.md) |
| Skills | Unused by design — the release flow is one fixed mission; no skill is attached and no credit is claimed | Agent manifest |
| Code Mode | Unused — MCP tools are called directly, not driven through sandboxed code | Agent manifest |
| Sandbox file downloads | Unused — the digest check reads stdout from persisted events; no artifact leaves the sandbox | Gate A proof chain |
| MCP OAuth / header auth | Unused — the vault is a local loopback MCP fixture | `scripts/setup-trueforge.ts` |
| Context management | Available but not exercised — sessions are short and bounded, so compaction never triggers | — |

Every TrueForge feature invoked by the submitted flow is evidenced above;
capabilities the flow does not use are explicitly dispositioned rather than
silently omitted.

## The honest numbers

Thirteen scripted full-demo attempts are recorded in [RUNS.md](RUNS.md):
**12 clean, 1 failed** (attempt 3, a relay-variance Gate A failure — exactly
the drift that check exists to catch). The final five (attempts 9–13) are
consecutive clean runs of the integrated sandbox build, and their complete
evidence bundles are committed under [`evidence/`](../evidence/) — each
verifies offline from a clean clone with no model key.

## What this does not claim

In the language of [LIMITATIONS.md](LIMITATIONS.md) and
[THREAT_MODEL.md](THREAT_MODEL.md): approval is evidenced structurally, not
identity-bound; OpenUI relay provenance is detected after the run, not
suppressed at render time; pre-release sandbox use is detected, not
runtime-blocked, and no hardened-isolation claim is made; offline
verification is weaker than live; gate assertions are tuned to the pinned
model. For one typed synthetic release tool, we demonstrate a
consent-integrity-inspired invariant; we do not implement Weng's full
property.

## AI-assisted development

Built with AI coding assistants (Claude Code and Codex as pair programmers,
Qodo for pull-request review). Every change was human-reviewed before merge
across task-sized PRs with a public review trail (see the Qodo
evidence section in the [README](../README.md)). All data is synthetic.

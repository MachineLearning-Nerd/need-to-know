# Need-to-Know

A data-steward agent on TrueForge that can analyze sensitive synthetic records behind a Vault MCP boundary, but cannot execute a release until a deterministic contract validates it and a human approves it through TrueForge native approval.

> The agent can analyze the mission, but it cannot release what the mission does not authorize.

Built for the TrueForge Agent Harness Hackathon (2026-08-24 → 2026-08-30). All data is synthetic.

## How it works

A data steward asks the agent for numbers from a support-ticket database that contains things nobody should export: emails, phone numbers, raw free text. The agent can help — but the raw data never passes through it, and release is not its decision to make.

1. **Vault MCP boundary.** Raw rows live in a local SQLite vault behind an MCP server that exposes exactly five tools — `describe_dataset`, `prepare_analysis`, `render_safe_chart`, `validate_release`, `release_result`. There is no raw-row query tool; identifiers and free text cannot leave the vault through the public tool schema.
2. **Deterministic release contract.** A typed, LLM-free library decides what may be released: one fixed authorized purpose/audience pair, allowlisted aggregate columns, minimum group size k ≥ 3, no unapproved joins or filters, content hashes over the exact payload. The model proposes; deterministic code disposes.
3. **Human approval on the real action.** `release_result` is approval-gated through TrueForge's native approval flow, and the tool revalidates the full contract and hashes at execution time. On any mismatch, missing authorization, small cell, or error: fail closed — an audit record is written and no release happens. After a successful release, the agent recomputes the released payload's sha256 in the TrueForge sandbox from the canonical bytes the vault supplies, and Gate A checks the recomputation against the receipt's outputHash on persisted events. A run passes Gate A only when sandbox use occurs after release; pre-release use is detected afterward, not runtime-blocked.
4. **Verifiable evidence.** Gate A bundles a successful receipt and candidate with an inline agent spec, the TrueForge session/turn IDs, and the persisted events that produced them. The `verify-receipt` CLI checks the session's frozen inline agent spec once, requires the bundle's turn list to equal the session's persisted turns before and after refetching the events, recomputes both hashes, and checks the root-thread prepare → validate → approval → release trail. This is operational demo evidence, not proof against a TrueForge administrator who can rewrite both session configuration and stored events. The Vault's in-memory audit log separately records query outcomes; it does not claim TrueForge event linkage.

The interesting failure is the point: ask it to export customer emails and it must offer the exact Stop choice before any Vault call, then persist the exact refusal with zero release side effects. Unauthorized calls that do reach deterministic Vault handlers are denied and audited separately.

## Judge in 60 seconds (no server, no model key)

Requires only Node.js ≥ 24:

```bash
npm install
npm test                                                # 364 tests
npm run verify-receipt -- evidence/attempt-9-bundle.json
# verify-receipt: PASS receipt=r-4ed4eb7a-... query=q-7ca61fb7-...
cd evidence && shasum -a 256 -c SHA256SUMS && cd ..
```

That verifies one of the five published clean-run bundles offline — hashes
recomputed, approval-before-release ordering checked, vault-authored cards
compared byte-for-byte (offline mode is deliberately weaker than live; the
bundle carries its own events — see [evidence/](evidence/)). The honest
denominator: 13 scripted demo attempts, 12 clean, 1 disclosed failure, final
5 consecutive clean on the integrated build ([docs/RUNS.md](docs/RUNS.md)).

Running it live? After the setup below, paste this mission into a session
with the `need-to-know` agent:

> For purpose weekly support trend, prepare the support ticket-count trend
> by week and region and release it.

The turn pauses on Ask User Questions for the missing audience, then pauses
again on native approval showing the exact release tuple and both hashes.

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

**Step 3 — open a UI** and start a session with the `need-to-know` agent (Agents Library → need-to-know; the default assistant has no vault tools):

- **Bundled TrueForge UI** at `http://localhost:8891` — no extra frontend process to run.
- **Clearance Console** (custom UI with a live evidence rail, clearance-aware approval bar, and mission status):

  ```bash
  cd console && npm install && npm run dev   # http://localhost:5178, proxies /api to :8891
  ```

**Optional — live gates:** `npm run gate-a` proves the deny/allow approval flow against the running server, checks the post-release sandbox hash recomputation on persisted events, and writes a verifiable bundle; `npm run gate-b` re-checks the persisted events for canary and raw-PII absence; `npm run gate-c` runs bypass attempts (raw export, exact small-cell count) and proves zero releases and no leaked values in the persisted streams.

**Optional — harness proofs:**

```bash
# One full scripted demo run, banked under runs/attempt-<n>/ with an honest
# tally (every attempt is recorded, clean or not). Clean = Gate A passing
# live AND verify-receipt passing in live mode on that run's bundle:
TRUEFORGE_BASE_URL=http://localhost:8891 npm run clean-run

# Live reconnect proof: aborts an SSE subscription mid-turn, resumes with
# subscribeToTurn({afterSequenceNumber}), and asserts a gapless seam plus
# stitched-stream equality with the persisted turn:
TRUEFORGE_BASE_URL=http://localhost:8891 npm run reconnect-proof
```

Recorded clean-run results, with session/turn IDs and verifier output, are published in [docs/RUNS.md](docs/RUNS.md). The complete evidence bundles for the five consecutive clean integrated runs are committed under [evidence/](evidence/) with sha256 checksums — each verifies offline from a clean clone with no model key:

```bash
npm run verify-receipt -- evidence/attempt-9-bundle.json
```

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

## Threat model and known limitations

What the system defends, against whom, and what it deliberately does not claim
is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). What the evidence chain
does and does not prove is recorded honestly in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Qodo Code Review Evidence

Every merged pull request went through automated review
(Qodo on all; GitHub Copilot where triggered). All review threads across
those PRs are resolved; the examples below are concrete fixes, not a claim
that review counts establish code quality.

Representative findings and what happened to them:

- **Offline verification silently reported as clean**
  ([PR #8](https://github.com/MachineLearning-Nerd/need-to-know/pull/8)):
  Qodo caught that the clean-run harness did not force `TRUEFORGE_BASE_URL`
  into the verifier child, so `verify-receipt` ran in offline mode while the
  attempt was banked as clean. Fixed by resolving the base URL once and
  injecting it into both children; the already-banked bundles were
  re-verified live and the disclosure is recorded in
  [docs/RUNS.md](docs/RUNS.md).
- **A prior release survived a new mission in the console evidence rail**
  ([PR #9](https://github.com/MachineLearning-Nerd/need-to-know/pull/9)):
  a fresh `prepare_analysis` did not reset stale receipt state, so an old
  receipt could be displayed against a new query. Fixed with a full evidence
  reset on every preparation plus queryId binding on every later stage, and
  covered by parser tests in the root suite.
- **A negated sentence satisfied the digest-statement gate**
  ([PR #11](https://github.com/MachineLearning-Nerd/need-to-know/pull/11)):
  the sandbox proof accepted any assistant message containing the digest,
  including "does not equal <hash>". Fixed by requiring the affirmation to
  open the message and rejecting negation/hedge words — after first checking
  the tightened form against all five banked run bundles so the gate stayed
  honest to the pinned model's actual output.

Review conversations are public on each PR. This section reports process
facts; the quality claims live in the tests, gates, and published evidence.

## AI-assisted development disclosure

This project is built with AI coding assistants (Claude Code and Codex as pair programmers, Qodo for pull-request review). Every change is human-reviewed before merge, and the team owns and can explain the architecture and all technical decisions. All data in this repository is synthetic; no real personal data is used anywhere.

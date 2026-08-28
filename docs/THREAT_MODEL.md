# Threat model

What Need-to-Know defends, against whom, and — just as deliberately — what it
does not claim. Companion to [LIMITATIONS.md](LIMITATIONS.md), which records
the known gaps in the evidence chain.

## Assets

- **Raw synthetic rows** in the vault SQLite database: customer identifiers,
  emails, phone numbers, free text, and a canary row whose values must never
  appear outside the vault process.
- **The release decision**: whether an aggregate leaves the vault, under which
  purpose/audience, and the receipt that records it.
- **The evidence chain**: persisted TrueForge events plus the vault's audit
  log, which reviewers use to check what actually happened.

## Trust boundaries

| Component | Trust | Why |
| --- | --- | --- |
| Vault process (SQLite + MCP server + contract) | Trusted | Holds raw rows; all enforcement is deterministic code inside it. Loopback-only, five-tool surface, no raw-row tool exists. |
| Model / agent | Untrusted | Treated as a confused-deputy channel: it can propose, relay, and phrase, but every decision it could corrupt is re-checked deterministically inside the vault. |
| TrueForge harness | Trusted for persistence and pauses, not for binding | It stores events and stops the turn for approval. Its approval carries a tool-call reference, not the arguments or a hash — see "structural, not cryptographic" below. |
| Human approver | Decision maker | Approves or denies the paused `release_result` with the tuple and hashes displayed; the deployment does not verify *who* is at the keyboard (see LIMITATIONS). |
| Verifier (`verify-receipt`) | Independent checker | Recomputes hashes and cards from the bundle and the server's persisted events; trusts the TrueForge instance it queries, so it is operational evidence, not proof against a TrueForge administrator. |

## What is enforced deterministically (not asked of the model)

- **No raw-row egress path**: the tool schema has no query that returns row
  values; sensitive columns cannot be named as dimensions; small cells are
  suppressed inside the vault before any candidate exists.
- **Mission authorization**: one fixed purpose/audience pair, checked inside
  `prepare_analysis` before any query runs; everything else is denied and
  audited.
- **Release integrity**: `release_result` revalidates the stored candidate,
  the full approved tuple, and both content hashes at execution time. Any
  mismatch fails closed with an audit record and zero state transitions —
  replay included (one receipt per query, ever).
- **Malformed input**: rejected at the tool schema before a handler runs;
  torn connections and oversized or non-JSON bodies neither apply state nor
  wedge the server.
- **Root-only release**: dynamic subagents are disabled in the manifest, and
  the verifier independently rejects any release chain whose calls, approval,
  or user decision sit outside the root thread.

## What is detected after the fact (not prevented at runtime)

- **Card fidelity**: all OpenUI cards are vault-authored; the gates compare
  the persisted stream byte-for-byte against recomputed cards. The pinned UI
  has no pre-render hook, so an altered relay is caught by verification, not
  suppressed on screen.
- **Refusal shape**: bypass prompts must produce the exact Stop refusal with
  zero vault calls; this is proven on persisted events per run.

## Approval binding: structural, not cryptographic

TrueForge's `tool.approval_required` references the pending tool call; the
runtime executes the same persisted parameters the approval referenced, so a
client cannot swap arguments through the approval API. That is **structural**
binding. TrueForge does not cryptographically bind the approval to the payload
or its hash — what makes the human decision artifact-bound here is the vault's
own execution-time revalidation of the tuple and hashes the human saw.

For one typed synthetic release tool, we demonstrate a consent-integrity-
inspired invariant; we do not implement Weng's full property. This project
does not claim to implement Consent Integrity, defeat lure-in-the-loop
attacks, resist prompt injection in general, or provide a trusted path.

Bounded display of structured release data (fixed row cap, deterministic
suppression marker, hashes outside the scrollable region) follows the
mitigation class prescribed by
[EIP-7730](https://eips.ethereum.org/EIPS/eip-7730); it is applied here, not
invented here.

## Out of scope, on purpose

- **No sandbox**: the chart renderer is deterministic in-vault code; no
  code-execution surface exists on the release path, and no
  isolated-execution claim is made (the platform seam is separately
  evidenced; see LIMITATIONS).
- **Approver identity, TrueForge-administrator adversaries, and offline
  bundle provenance** are documented gaps, not silent ones — see
  [LIMITATIONS.md](LIMITATIONS.md).
- All data is synthetic; no real personal data exists anywhere in the system.

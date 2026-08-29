# Known limitations

Honest boundaries of what the evidence chain proves. The companion
[THREAT_MODEL.md](THREAT_MODEL.md) states what the system defends and what it
deliberately does not claim; this document records the known gaps.

## Approval is evidenced structurally, not identity-bound

The session-bound receipt evidence chain evidences a user approval action: the
persisted session carries the approval gate for the exact `release_result`
call, a single user `allow` decision between the gate and the response, and the
gated response witnessing the released payload. It does not prove *who*
approved or *why*:

- Standalone TrueForge 0.1.4 runs with auth disabled, so no approver identity
  exists anywhere in the runtime to record.
- The approval decision object carries only `{ status: "allow" | "deny" }`;
  there is no reason field to capture or persist.

This will not be built in this submission: it is a runtime boundary of the
pinned build, not a gap in the vault or verifier. An identity-bearing
deployment would tighten the same structural checks without changing them.

## Denied attempts are audited, not session-linked in the vault

The vault's audit log records every denied or failed release attempt with its
reason and zero side effects, but the vault is deliberately decoupled from
TrueForge and never learns session or turn IDs. TrueForge-side linkage for the
deny path is asserted live by Gate A (denial marker in the gated response, no
receipt material in the stream). Its session ID is published for every attempt
in [RUNS.md](RUNS.md), while the vault audit remains deliberately unlinked to
TrueForge session and turn IDs.

## Subagents are disabled, deliberately

The original design called for advisory subagents (planner, privacy
reviewer, evidence reviewer). TrueForge 0.1.4 child agents inherit the
root's full tool set — including the vault MCP tools — so a child could
trigger `release_result`, and no narrowed-permission claim would be true.
Rather than prompt-shaping children and sampling their behaviour over
repeated runs, this deployment removes the surface: the manifest disables
`dynamic_sub_agents`, the prompt forbids creating them, and the verifier
independently rejects any release chain whose calls, approval gate, or user
decision sit outside the root thread (`approval_source_mismatch`). The
root-only guarantee is therefore enforced deterministically on every
verified bundle instead of demonstrated statistically.

## The sandbox is post-release only, and its isolation is not the claim

The sandbox is used for exactly one step, after a receipt exists: recomputing
the released payload's sha256 from the canonical bytes the chart response
carries, and comparing it to the receipt's outputHash. Only already-released
data ever enters it; the chart itself remains a deterministic in-vault
renderer, and no code execution sits anywhere on the pre-release path. Gate A
asserts all of this on persisted events — exactly one exec, the exact pinned
command, exit code 0, the digest witnessed and restated, and zero sandbox
activity in every session that never releases.

Two honest boundaries. First, the standalone build's local sandbox executes
on the host — it is the platform's seam, not a hardened isolation boundary,
so the check's value is the independently witnessed recomputation, not
isolation strength. Second, the model relays the canonical bytes from the
chart response into the exec command, so a model that mangles them fails the
gate (exact-command check) rather than producing a false PASS — the gate
recomputes the digest from the persisted command bytes itself before
trusting anything the sandbox printed.

## OpenUI relay provenance is detected after the run

The vault deterministically authors clearance, denial, receipt, and chart
OpenUI blocks. On the successful release path, Gate A refetches persisted
events, binds the clearance, receipt, and chart blocks to their root Vault MCP
responses, and fails if the assistant changed one or emitted an extra OpenUI
fence. Denial blocks are covered by deterministic handler and renderer tests;
the live off-mission Stop path intentionally calls no Vault tool. This is
post-run evidence, not a pre-render control: the pinned standalone TrueForge
0.1.4 UI exposes no manifest or API hook that can inspect assistant output
before its Markdown renderer displays an OpenUI fence.

Preventing an altered assistant block from entering the DOM requires a future
UI to suppress assistant-authored OpenUI and render only validated,
correlated Vault tool responses. Until then, native approval and tool-response
surfaces remain the runtime evidence; Gate A detects but cannot undo a rendered
mismatch.

## Gate assertions are tuned to the pinned model

Several live-gate checks encode exact behaviour of the pinned model
(zai/glm-5.2 at temperature 0) rather than general properties: the Stop path
requires an exact terminal confirmation with no interim prose and no persisted
reasoning text, and the receipt block must appear in the same message as the
chart call. These passed live and fail loudly on drift, but a model or runtime
change (for example, one that persists reasoning content) will fail the gates
for behaving differently, not for leaking. Likewise, the verifier compares
vault-authored cards byte-for-byte, so any future wording change to the card
renderer invalidates bundles produced before it. Both are deliberate
strictness under a pinned build, not general-purpose checks.

## Offline verification is weaker than live

`verify-receipt` without `TRUEFORGE_BASE_URL` checks the bundle's embedded
events, which come from the same party as the receipt. The CLI announces this
mode on stderr; only live mode authenticates the named session against the
server's persisted state.

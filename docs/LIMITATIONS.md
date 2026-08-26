# Known limitations

Honest boundaries of what the evidence chain proves. The Phase 9 threat-model
pass expands this document; these entries are recorded now because they were
identified during the Phase 4/5 completeness review.

## Approval is evidenced structurally, not identity-bound

The receipt proves a human-in-the-loop approval *happened*: the persisted
session carries the approval gate for the exact `release_result` call, a
single user `allow` decision between the gate and the response, and the gated
response witnessing the released payload. It does not prove *who* approved or
*why*:

- Standalone TrueForge 0.1.4 runs with auth disabled, so no approver identity
  exists anywhere in the runtime to record.
- The approval API carries only `{ status: "allow" | "deny" }`; there is no
  reason field to capture or persist.

This will not be built in this submission: it is a runtime boundary of the
pinned build, not a gap in the vault or verifier. An identity-bearing
deployment would tighten the same structural checks without changing them.

## Denied attempts are audited, not session-linked in the vault

The vault's audit log records every denied or failed release attempt with its
reason and zero side effects, but the vault is deliberately decoupled from
TrueForge and never learns session or turn IDs. TrueForge-side linkage for the
deny path is asserted live by Gate A (denial marker in the gated response, no
receipt material in the stream) and its session IDs land in the regenerated
gate run artifacts rather than in a committed record. The published clean-run
records planned for Phase 9 will durably record deny-path session and turn IDs
alongside verifier output.

## Offline verification is weaker than live

`verify-receipt` without `TRUEFORGE_BASE_URL` checks the bundle's embedded
events, which come from the same party as the receipt. The CLI announces this
mode on stderr; only live mode authenticates the named session against the
server's persisted state.

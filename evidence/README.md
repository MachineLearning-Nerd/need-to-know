# Verifiable run evidence

The complete Gate A evidence bundles for the five consecutive clean
integrated runs recorded in [docs/RUNS.md](../docs/RUNS.md) (attempts 9–13),
plus each run's live verifier output as captured at run time.

Each bundle contains the release receipt, the approved candidate, the
session/turn identifiers, and the persisted TrueForge events for the allow
session — everything the offline verifier reads. The host-local path in each
bundle's `sandbox_id` field is privacy-redacted as documented below.

## Verify them yourself (no model key needed)

```bash
npm install
npm run verify-receipt -- evidence/attempt-9-bundle.json
# verify-receipt: PASS receipt=r-4ed4eb7a-... query=q-7ca61fb7-...
```

Offline mode checks the bundle's embedded events and recomputes both content
hashes, the approval-before-release ordering, the root-thread chain, and the
vault-authored cards byte-for-byte. It is weaker than live mode — the
embedded events come with the bundle — which is why each attempt's live
verifier output (`attempt-N-verify-live.txt`), produced against the running
server's persisted state at run time, is published alongside. With a running
TrueForge holding these sessions, re-run a live check from the repository root:

```bash
TRUEFORGE_BASE_URL=http://localhost:8891 npm run verify-receipt -- evidence/attempt-9-bundle.json
```

`SHA256SUMS` pins all five bundles and five captured live-verifier outputs:
`shasum -a 256 -c SHA256SUMS` from this directory must pass.

## Scope notes

- All data is synthetic. The only email-like string in any bundle is
  `you@example.com`, a placeholder inside TrueForge's own
  `get_openui_instructions` documentation response — not vault data.
- Before publication, the path prefix in each host-local `sandbox_id` was
  replaced with `<redacted-host-path>`. The sandbox and session ULIDs are
  retained. The verifier serializes the field during its whole-event canary
  scan but does not otherwise interpret it. Gate A's separate sandbox-proof
  check also does not depend on it; the deterministic redaction leaves the
  outcomes for these five bundles unchanged.
- Attempts 1–8 (pre-sandbox build) are recorded with identifiers and
  verifier lines in [docs/RUNS.md](../docs/RUNS.md); their bundles predate
  the sandbox integration and are not republished here.

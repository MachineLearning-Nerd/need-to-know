# Verifiable run evidence

The complete Gate A evidence bundles for the five consecutive clean
integrated runs recorded in [docs/RUNS.md](../docs/RUNS.md) (attempts 9–13),
plus each run's live verifier output as captured at run time.

Each bundle contains the release receipt, the approved candidate, the
session/turn identifiers, and the full persisted TrueForge events for the
allow session — everything the verifier consumes.

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
TrueForge holding these sessions, `TRUEFORGE_BASE_URL=http://localhost:8891`
re-runs the live check.

`SHA256SUMS` pins every file: `shasum -a 256 -c SHA256SUMS` from this
directory must pass.

## Scope notes

- All data is synthetic. The only email-like string in any bundle is
  `you@example.com`, a placeholder inside TrueForge's own
  `get_openui_instructions` documentation response — not vault data.
- Attempts 1–8 (pre-sandbox build) are recorded with identifiers and
  verifier lines in [docs/RUNS.md](../docs/RUNS.md); their bundles predate
  the sandbox integration and are not republished here.

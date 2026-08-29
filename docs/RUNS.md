# Recorded clean runs

Every scripted full-demo attempt, in order, with nothing omitted. A **clean**
attempt means Gate A passed live (all four uncoached sessions: deny,
missing-purpose, exception, allow) AND `verify-receipt` passed against the
same live server on the bundle that attempt just produced. The harness
(`npm run clean-run`) banks a not-clean record before the run starts, so an
interrupted attempt can never vanish from the denominator.

**Tally: 7 of 8 attempts clean, including the final 5 consecutive
(attempts 4–8).** Attempt 3 failed one Gate A assertion and is recorded
below like every other attempt.

All runs used TrueForge `0.1.4` at `http://localhost:8891` with model
`zai/glm-5.2` at temperature 0. Turn IDs listed are the allow session's;
the other three sessions each paused exactly once on the expected Ask User
Question. Raw artifacts (bundle, gate result, and verifier output when
produced) live under `runs/attempt-<n>/`, which is deliberately not committed.
This ledger publishes the recorded identifiers and verifier outputs; fresh
artifacts can be regenerated and re-verified with the commands in the README.

Verification-mode note: attempts 1, 2, and 4 originally ran the verifier in
offline mode (the harness did not yet force `TRUEFORGE_BASE_URL` into the
verifier child — found by review on the Phase 7 PR). After the fix, their
banked bundles were re-verified in live mode against the running server and
passed; the live PASS lines below are from that re-verification. Attempts
5–8 verified live on first run.

## Attempt 1 — CLEAN

- Started 2026-08-27T02:24:02.792Z, 139 s.
- Sessions: deny `01m10gg4k9k9mrqn41dvbr0gs8`, missing-purpose `01m10gh6n8d66f1zypygzp5f6e`, exception `01m10gjap0j3v469nn2fya0gyf`, allow `01m10gjw3mj0vst04p9dsngm28`.
- Allow turns: `01m10gjw3pgcvakysejq01zm2e.local`, `01m10gk1se3z0qxg8ewrcb0xs5.local`, `01m10gkz8d9wfrhrcmhagwa8hv.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-a4cbfb79-8039-44b2-9494-e313a982e06e query=q-5d3688ee-14cd-48a5-9c9e-3781ea3f7e13`

## Attempt 2 — CLEAN

- Started 2026-08-27T02:26:27.880Z, 165 s.
- Sessions: deny `01m10gmj8v8kkgdrdz44gmkdwj`, missing-purpose `01m10gns6xgacvwwv8e493tsaw`, exception `01m10gqs9q28pf93qfmsa4q06c`, allow `01m10gr5nx7mfpggt7dmqnzc4m`.
- Allow turns: `01m10gr5p4rtyzkrw9k6b6205m.local`, `01m10grcfn0x652ca0rw7zrt8s.local`, `01m10gs702w07jtk7m36yyavqb.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-c2d43c0b-2d16-462d-aaaa-f14146a3ac6a query=q-ae3fd751-ba71-4a1a-b999-55d96abbb9d3`

## Attempt 3 — NOT CLEAN

- Started 2026-08-27T02:29:18.223Z, 125 s.
- Gate A failed one assertion: *"persisted allow stream relays every
  vault-authored OpenUI block verbatim"* — the model varied its relay of a
  vault-authored card in this run, which is exactly the drift that check
  exists to catch (see the relay-provenance entry in
  [LIMITATIONS.md](LIMITATIONS.md)). No verifier run; a receipt was issued
  and the release itself completed under approval, but the attempt is not
  clean.
- Sessions: deny `01m10gsrnc0bpedfnpfwgfxarb`, missing-purpose `01m10gtq8r9mx6jrcv4wr1kahv`, exception `01m10gw1mqyteyh3vfnpqby4s4`, allow `01m10gw9e1sqzdq2mx1h2ym27z`.
- Allow turns: `01m10gw9e3pag6cdzswgy9qe6v.local`, `01m10gwfm22d4m5x29cdhnqpd3.local`, `01m10gx1f06420c9w4479yp7d3.local`.
- Receipt: `r-df74e838-6e9e-4438-85be-8876c3f2ee05`.

## Attempt 4 — CLEAN

- Started 2026-08-27T02:31:58.445Z, 111 s.
- Sessions: deny `01m10gyn3tn4vdsbhp3yz98czb`, missing-purpose `01m10gzkz1m7gfd9ep66tf4n3x`, exception `01m10h0e84k0x0cqsrjg5y0tn9`, allow `01m10h0jq8zar6t63v5a8p7smc`.
- Allow turns: `01m10h0jqcpvmrzyr89r3majwb.local`, `01m10h0prjbb8ywxbkgddsh6e4.local`, `01m10h1fmm8dxcwdetdjk181jc.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-eae8daee-8ae3-4512-9271-e24d9b414ceb query=q-cf6046e0-9121-47ad-8423-f79e5209cb16`

## Attempt 5 — CLEAN

- Started 2026-08-27T04:15:21.325Z, 166 s.
- Sessions: deny `01m10pvyhb11ak7391wjw3h3am`, missing-purpose `01m10pxg61q2y5y8emy8v961tm`, exception `01m10pz5hfvcvza2pnxh24te1y`, allow `01m10pzjcjhndh3f47nbmta70c`.
- Allow turns: `01m10pzjcmswnkyg94q16590e4.local`, `01m10pzsq7j3wvxexyxhfy8qwg.local`, `01m10q0jbt5533jm3qghfngwe6.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-8d999ef4-cd99-4431-89a3-627484d1d9fe query=q-b86ec6c9-2902-41d9-97bd-b6a88a719e71`

## Attempt 6 — CLEAN

- Started 2026-08-27T04:29:39.323Z, 160 s.
- Sessions: deny `01m10qp4ft44zt15hy6rd6e3xs`, missing-purpose `01m10qqkhv5kmrvspb4d3q86mv`, exception `01m10qrr0h6462pxpg2zmgpjzy`, allow `01m10qs2ynmwj02tp0d54j9pvb`.
- Allow turns: `01m10qs2ytsc3zbjzknpvna8he.local`, `01m10qscm9t990za7g6ptkx6h5.local`, `01m10qtffw5p2g7ay1hhpn94gv.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-012c0bef-304c-4610-88a4-c71f87284d56 query=q-8d84387f-2c0e-42a8-be36-13710ca265df`

## Attempt 7 — CLEAN

- Started 2026-08-28T09:03:17.627Z, 158 s.
- Sessions: deny `01m13sqx0cfr3dqdpm7g4sxkcj`, missing-purpose `01m13ss5cdrf4gcdjb3b4fpp1s`, exception `01m13stwg4gccszw9jnj77hj8r`, allow `01m13sv6bqygm3zgp76pky9bee`.
- Allow turns: `01m13sv6bw4dbck3xrbv07k511.local`, `01m13svcqmxtdj7j0y0r941qy2.local`, `01m13sw88fddp9wejhseb94sg3.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-6f3eaa51-c777-423c-971d-94ca2d81f678 query=q-b8b21e26-884a-4ded-b334-c5b57c804def`

## Attempt 8 — CLEAN

- Started 2026-08-28T09:08:02.900Z, 155 s.
- Sessions: deny `01m13t0kj8k37apdxsnzjx0hra`, missing-purpose `01m13t22fbn4y6nnej9j0vtaz7`, exception `01m13t3e1xyx2d8q3xhmdm4fxp`, allow `01m13t3qt4hw2yet8m3tjrve43`.
- Allow turns: `01m13t3qtasfc425eg0fne49t8.local`, `01m13t3zqmq0ch3fxy8a7cabpk.local`, `01m13t4van3d3mfda5nx9p4s89.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-d408000f-f120-4f18-a256-da2c836498b7 query=q-a2503246-9a6c-4c18-bde7-93cff8972395`

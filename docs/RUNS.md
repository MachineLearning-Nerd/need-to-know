# Recorded clean runs

Every scripted full-demo attempt, in order, with nothing omitted. A **clean**
attempt means Gate A passed live (all four uncoached sessions: deny,
missing-purpose, exception, allow) AND `verify-receipt` passed against the
same live server on the bundle that attempt just produced. The harness
(`npm run clean-run`) banks a not-clean record before the run starts, so an
interrupted attempt can never vanish from the denominator.

**Tally: 12 of 13 attempts clean.** Attempt 3 failed one Gate A assertion
and is recorded below like every other attempt. Attempts 1–8 ran the
pre-sandbox build (final 5 consecutive: attempts 4–8); attempts 9–13 are
five consecutive clean runs of the integrated build, where Gate A
additionally asserts the post-release sandbox hash recomputation on
persisted events (see the section below).

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

## Integrated sandbox build — attempts 9–13, five consecutive CLEAN

From attempt 9 onward the deployment enables the TrueForge sandbox for one
post-release step: the agent recomputes the released payload's sha256 from
the canonical bytes in the chart response, and Gate A asserts on persisted
events that exactly one exec ran the exact pinned command after the chart
response with exit code 0, that the digest (independently recomputed by the
gate) equals the receipt's outputHash, and that no session that failed to
release touched the sandbox.

### Attempt 9 — CLEAN

- Started 2026-08-29T04:04:36.730Z, 165 s.
- Sessions: deny `01m15v1q7g5q8jdmqqtjz4qkds`, missing-purpose `01m15v2y8desqqa35prpy5jf9a`, exception `01m15v4e9bcg6f452sm64b1tzz`, allow `01m15v4m6wr4yecghca0v1vmsh`.
- Allow turns: `01m15v4m71k69nmgckf40nx1dk.local`, `01m15v4s53gygasyk848yb88xs.local`, `01m15v5ht4fgc00xe4yt9kp821.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-4ed4eb7a-2b07-4df3-97e3-1c8693b29098 query=q-7ca61fb7-d04e-44b4-91a9-fff6d132b80d`

### Attempt 10 — CLEAN

- Started 2026-08-29T04:07:21.703Z, 163 s.
- Sessions: deny `01m15v6ras527c29kmwkay047k`, missing-purpose `01m15v85new0jf7w6t4f2rwn5p`, exception `01m15v9a6bkczyx6hcbptysjsn`, allow `01m15v9mf547w4181pvwqfek8h`.
- Allow turns: `01m15v9mfa09qj3d7027f0jcq2.local`, `01m15v9sq17wrddgq1vb2sd3c8.local`, `01m15vam4fdxw26nrmjch9kz2f.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-5f1366da-c86b-4c39-a097-6d642b44c58b query=q-4139b41d-c54a-41f3-8744-bf3d6dfdb3b7`

### Attempt 11 — CLEAN

- Started 2026-08-29T04:10:04.659Z, 173 s.
- Sessions: deny `01m15vbqgw1apcsf3sf5p19t4n`, missing-purpose `01m15vd671atn3cxr11rxqay6h`, exception `01m15veha1571xvmm1wpakc4x0`, allow `01m15ver81mj2xhwasz8ex2zs9`.
- Allow turns: `01m15ver84yjz7b7ce0jnyf3k4.local`, `01m15vevxk3252qhgwtqbtdc9b.local`, `01m15vfnss4zpt9em3pfgyxhe9.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-2822d607-f0a6-47b2-b89b-430f68f7b66a query=q-7c6eaeba-ffee-49a0-bde7-9c7db5648d4e`

### Attempt 12 — CLEAN

- Started 2026-08-29T04:12:58.212Z, 130 s.
- Sessions: deny `01m15vh0zvwnjewmgbvcx0ycgq`, missing-purpose `01m15vj1kgw95bhgv264dq0q2e`, exception `01m15vk9xhfhh8g4mtqxzjbz6x`, allow `01m15vkf4e5q5eymm7jdr2qda8`.
- Allow turns: `01m15vkf4kssmrq53aadntx030.local`, `01m15vknza9wwfd1fqgp76t89p.local`, `01m15vm6rdjnynqjfh5zhx7z9a.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-877fbbc0-251c-48b5-b0f0-e5f9feba05bf query=q-166a463b-1ec8-4073-b6b2-a2ba0e28ca35`

### Attempt 13 — CLEAN

- Started 2026-08-29T04:15:08.743Z, 143 s.
- Sessions: deny `01m15vn0e4fbe2vwprmfxad039`, missing-purpose `01m15vp4ajty3gj5zgeekm43ve`, exception `01m15vq9zft1zg4sr583y1g9rz`, allow `01m15vqk3nrnfmf2bg3wxetg57`.
- Allow turns: `01m15vqk3tbx2467gptf86tpf5.local`, `01m15vqqjjcq0yqz4efd4t4ptw.local`, `01m15vrc647490wn8q99x7av07.local`.
- Verifier (live): `verify-receipt: PASS receipt=r-03cb7314-4a41-4731-85fc-b71f7ad49e5a query=q-7c66f9ac-9f3c-4d66-9185-124a6f6cdaa0`

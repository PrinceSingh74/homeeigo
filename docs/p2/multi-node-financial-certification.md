# Multi-Node Financial Harness — Certification

**Date:** 2026-06-13 · **Method:** execution — `scripts/multi-node-financial-harness.ts` spawns **separate OS processes** (real `Bun.spawn`, not in-process `Promise.all`). Each node has its OWN in-memory lock, so cross-process safety rests entirely on the DB guards (`pg_advisory_xact_lock`, `FOR UPDATE`, `idempotencyKey`, SERIALIZABLE, unique indexes). Isolated `homigo_test` only.

## Scenarios & results (final run)

| Scenario | Load | Result | Verdict |
|---|---|---|---|
| A — idempotency (same top-up) | 6 nodes × 15 = **90 concurrent settles** | balance 500/500, completed 1, journals 1 | ✅ ONE credit |
| A — idempotency (same top-up) | 10 nodes × 25 = **250 concurrent settles** | balance 500/500, completed 1, journals 1 | ✅ ONE credit |
| B — no lost update (one wallet) | 8 nodes × 5 = **40 concurrent credits** | balance 4000/4000, completed 40/40 | ✅ every credit once |
| B — no lost update (one wallet) | 8 nodes × 10 = **80 concurrent credits** | balance 8000/8000, completed 80/80 | ✅ every credit once |
| Global ledger integrity (delta) | after the storm | introduced ledger-class issues = **0** (baseline 1 = pre-existing test-DB drift, not from the harness) | ✅ no corruption |

**Verdict: MULTI-NODE CERTIFIED** — settlement idempotency and wallet-balance increments are correct across separate processes; in-memory locks are bypassed and the DB guards alone hold. Existing single-process attack (`attack-wallet-race`) still passes (no regression).

## Bug found & fixed (this harness earned its keep)

**Finding — `nextWalletTxnNumber()` creation race (multi-node).** Top-up creation derives the human-readable `transactionNumber` as `max(existing)+1` via a read query, then inserts. Under concurrent creation from separate processes, all racers read the same max → compute the same number → collide on the `transactionNumber` unique index → **P2002**, and the top-up creation hard-fails. Reproduced: 8 concurrent nodes settled only ~11/40 credits (the rest died on P2002). This is a *liveness* defect on creation — **not** a correctness defect: every credit that did complete was exact (`balance == completed × amount`, zero introduced ledger drift), so no double-credit or lost update ever occurred.

**Fix** (`wallet.service.ts addMoney`): the insert is now wrapped in a retry loop that, on a P2002 whose `meta.target` is the `transactionNumber`, regenerates a fresh number and retries (up to 25× with jittered backoff). The existing idempotencyKey-collision short-circuit (genuine duplicate request → return the racer's row) is preserved and now disambiguated via `meta.target`.

**Re-verified after fix:** 40/40 and 80/80 credits complete; balances exact; 0 introduced ledger issues. The single-process wallet-race attack still shows 1 credit at 250 concurrent (no regression).

## Harness notes
- `.env.test` `connection_limit` lowered 75 → 5 (75 per-process × N workers exhausted Postgres `max_connections=100`, which is shared with the live `homigo_db` backend). Workers also retry transient `P2037`/`P2034`/`P2028`.
- The harness refuses to run unless `NODE_ENV=test` (financial writes must hit `homigo_test` only); no production/live data touched.

**Rollback:** `git checkout -- src/services/wallet.service.ts` (drops the transactionNumber retry) and restore `.env.test` connection_limit if desired.

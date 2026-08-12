# Paise Cutover Readiness Plan (PLAN ONLY — no execution)

**Date:** 2026-06-10 · **Rule:** do NOT remove Float columns, do NOT modify production balances, do NOT run destructive migration. This document is a plan + verification gates only.

## Current observed state
- The schema carries money in **two representations side by side**: legacy `Float` (e.g. `walletBalance`, `baseAmount`, `amount`) **and** new `BigInt` paise columns (e.g. `walletBalancePaise`, `baseAmountPaise`, `amountPaise`) across ~15 models (User, Provider, Booking, Payment, WalletTransaction, Earning, Withdrawal, LedgerEntry, GiftCard, etc.).
- **Dual-write status:** NOT VERIFIED — must be confirmed before any read switch (see Phase A).
- A global `BigInt → JSON` serializer is in place (`load-env.ts`), so BigInt fields serialise safely (non-destructive; already shipped, fixed Google-login).
- Financial integrity currently **100/100 PASS**; liabilities snapshotted (wallet ₹9,389, provider ₹12,480, gift-card ₹1,800, HCoin ₹420).

## Safe cutover sequence (execute in STAGING first, never prod-first)

### Phase A — Dual-write verification
- Audit every write path that sets a Float money field and confirm it ALSO sets the matching `*Paise` (paise = `Math.round(rupees * 100)`).
- Gate: a script that, for the last N writes, asserts `Paise == round(Float*100)` for 100% of rows. 0 mismatches required.

### Phase B — Backfill verification (read-only checker first)
- For historical rows where `*Paise` is 0/null but Float > 0, backfill `Paise = round(Float*100)` in an **idempotent, batched, non-destructive** job (writes only the paise column; never touches Float).
- Gate: post-backfill, `COUNT(*) WHERE Paise != round(Float*100)` = 0.

### Phase C — 1,000,000 transaction simulation (staging)
- Replay/generate 1M synthetic money operations against a STAGING copy; after each, assert Float and Paise agree.
- Gate: **0 drift** across all 1M.

### Phase D — Drift detection (continuous)
- Add a periodic reconciler: `SUM(round(Float*100)) == SUM(Paise)` per money table; alert on any non-zero delta. Wire into the existing financial-integrity validator.
- Gate: 0 drift sustained over a soak window.

### Phase E — Read-switch readiness (NOT the switch itself)
- Only when A–D are green: flip reads to `*Paise` behind a feature flag, table by table, with the Float column **retained** as a shadow for rollback.
- Rollback: flip the flag back to Float reads (instant; no data change). Legacy Float columns are NOT dropped in this plan.

## Explicit guardrails
- ❌ No `DROP COLUMN` / no Float retirement in this plan.
- ❌ No balance mutation. Backfill writes ONLY the paise mirror of an existing Float value.
- ✅ Every phase has a read-only verification gate that must pass before the next.
- ✅ Full backup + integrity-100 snapshot exists before any write.

## Status
**Readiness = PLAN COMPLETE; execution NOT started (by design).** The destructive parts (read switch, column retirement) require staging dry-runs + 0-drift proof + explicit go-ahead, per the rules.

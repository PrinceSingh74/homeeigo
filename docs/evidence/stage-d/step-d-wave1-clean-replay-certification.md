# Stage D — Wave-1 Clean Replay Certification (Remediation 2)

**Date:** 2026-08-04  
**Status:** **PASS — D-REMEDIATION EXECUTION CERTIFIED**  
**STAGE_D_RC_SHA:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`

---

## Executive Result

| Gate | Status |
|------|--------|
| D_REMEDIATION_ANALYSIS | PASS |
| WAVE_1_RELEASE | PASS |
| CLEAN_REPLAY | **PASS (31/31)** |
| D_REMEDIATION_EXECUTION | **PASS** |
| STAGING_WAVE1_APPLIED | NO |

---

## Remediation 2 — Root Cause & Fix

### Forensic: `wallet_transfers`

| Finding | Detail |
|---------|--------|
| Prisma model | `WalletTransfer` @ `schema.prisma` — sender/recipient FK to users, amount + amountPaise |
| Runtime usage | `transfer.service.ts`, `financial-ledger.service.ts` (not Stage-D harness) |
| Migration chain | **Zero** `CREATE TABLE wallet_transfers` in any migration before 09280000 |
| Failure | 09280000 `ALTER TABLE wallet_transfers` on clean replay → 42P01 |

### Superseded 09260000 vs 09280000 diff

| 09260000 (excluded) | 09280000 (before fix) | Gap |
|---------------------|----------------------|-----|
| `users.wallet_balance_paise` ADD | UPDATE/trigger only | Missing ADD COLUMN |
| `providers.wallet_balance_paise` ADD | UPDATE/trigger only | Missing ADD COLUMN |
| — | `wallet_transfers` ALTER | Table never created |

### Minimal remediation applied to `09280000`

1. **Phase 0:** Subsume 09260000 `wallet_balance_paise` on users/providers
2. **Phase 0:** Create `WalletTransferStatus` enum + `wallet_transfers` table with indexes/FKs
3. **Phase 0:** Stage-D schema orphans (`email_verification_*`, `services.premium_only`, `bookings.addons`)

Commits: `f11ee89` (wallet_transfers + 09260000 subsume), `c31f154` (Stage-D orphans)

---

## Git Identity

| Field | SHA |
|-------|-----|
| WAVE_1_MIGRATION_COMMIT_SHA | `d7ac1cf29770edd6fc0a7a576b8ac8efc87981ff` |
| REMEDIATION_2_RC (STAGE_D_RC_SHA) | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| Clean worktree | `%TEMP%\homigo-stage-d-wave1-c31f154` |

---

## Clean Replay

| Field | Value |
|-------|-------|
| REPLAY_INSTANCE | Local Docker `homigo-postgres` |
| REPLAY_DATABASE | `homigo_wave1_replay` (fresh empty) |
| Migrations | **31/31 PASS** |
| `prisma migrate status` | Database schema is up to date |

---

## Physical Wave-1 Verification

All PASS — see `wave-1-schema-inventory.json` for machine-readable inventory.

| Check | Result |
|-------|--------|
| users.email_encrypted | PASS |
| User encryption | PASS |
| Address encryption | PASS |
| Payment idempotency | PASS (DB-enforced unique) |
| Wallet hardening | PASS |
| Money paise (36 columns) | PASS |
| Enterprise CHECK constraints | PASS |
| Assignment/broadcast | PASS (DROP INDEX no-op on clean DB) |
| Booking wait-time BIGINT | PASS |

---

## Prisma Critical-Path Compatibility

Probe: `apps/backend/scripts/stage-d-wave1-prisma-probe.ts`

| Probe | Result |
|-------|--------|
| user.findFirst+addresses (D1) | PASS |
| provider.findFirst+location+user (D1) | PASS |
| service.findFirst (D1) | PASS |
| booking.findFirst (D2-D5) | PASS |
| payment / wallet / assignment / outbox / walletTransfer | PASS |

**STAGE_D_PRISMA_COMPATIBILITY: PASS** — P2021/P2022: NONE

---

## Schema Parity

| Gate | Result |
|------|--------|
| WAVE_1_STAGE_D_SCHEMA_PARITY | **PASS** |
| FULL_APPLICATION_SCHEMA_PARITY | **DEFERRED** (15 deferred migrations + feature tables) |

---

## Safety

Authoritative staging DB: **NOT MODIFIED**  
Production: **UNTOUCHED**

---

## Final Gate

```
============================================================
STAGE D — D-REMEDIATION CLEAN REPLAY PASS ✅
============================================================

WAVE-1 MIGRATIONS: 8/8 CERTIFIED
REMEDIATION: 09280000 FIXED
TOTAL AUTHORITATIVE MIGRATIONS: 31
CLEAN DATABASE REPLAY: 31/31 PASS
STAGE-D PRISMA COMPATIBILITY: PASS
CRITICAL P2021/P2022: NONE

SAFE TO PREPARE THE SEPARATE CONTROLLED WAVE-1 STAGING MIGRATION GATE.
DO NOT APPLY WAVE-1 TO STAGING AUTOMATICALLY.
```

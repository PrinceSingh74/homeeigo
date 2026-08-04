# Stage D — Wave-1 Clean Replay Certification

**Date:** 2026-08-04  
**Scope:** STAGING PREPARATION / ISOLATED TEST DATABASE ONLY  
**Production impact:** NONE  
**Authoritative staging DB modified:** NO  
**Result:** **D-REMEDIATION EXECUTION NOT CERTIFIED** — clean replay blocked

---

## Executive Result

| Gate | Status |
|------|--------|
| D_REMEDIATION_ANALYSIS | PASS |
| WAVE_1_RELEASE | PASS (8/8 committed) |
| CLEAN_REPLAY | **FAIL** |
| D_REMEDIATION_EXECUTION | **BLOCKED** |
| STAGING_WAVE1_APPLIED | NO |

---

## Git Identity

| Field | Value |
|-------|-------|
| BASE_PHASE0_RC | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| STAGE_D_BASELINE | `95fbb69721b673a0634cb01e6e5bc282f6cdb36f` |
| WAVE_1_MIGRATION_COMMIT_SHA | `d7ac1cf29770edd6fc0a7a576b8ac8efc87981ff` |
| STAGE_D_RC_SHA | `d7ac1cf29770edd6fc0a7a576b8ac8efc87981ff` |
| WAVE_1_EVIDENCE_COMMIT_SHA | pending |
| origin/main | `d3dee5d3b9abe5da31be396053adff293db6859b` |

Clean worktree: `%TEMP%\homigo-stage-d-wave1-d7ac1cf` (detached HEAD `d7ac1cf`, porcelain empty)

---

## Wave-1 Manifest

| Category | Count | Detail |
|----------|-------|--------|
| Expected migrations | 8 | Matches `wave-1-migration-manifest.json` |
| Committed migrations | 8 | All approved folders staged explicitly |
| Excluded superseded | 2 | `20260609260000_money_paise_dual_write`, `20260612000000_assignment_one_sent_per_job` |
| Remaining deferred | 15 | Untracked on disk, not in Wave-1 commit |

### Actual repository folder names (Wave-1)

1. `20260609180000_p4_encryption_audit`
2. `20260609220000_p0_p1_concurrency_rbac`
3. `20260609250000_wallet_pending_hardening`
4. `20260609280000_money_paise_full_dual_write`
5. `20260610120000_enterprise_db_hardening`
6. `20260610140000_address_pii_encryption`
7. `20260616120000_assignment_broadcast_dispatch`
8. `20260711120000_booking_wait_time_bigint`

### Supersession evidence

| Excluded | Superseded by | Evidence |
|----------|---------------|----------|
| `20260609260000_money_paise_dual_write` | `20260609280000_money_paise_full_dual_write` | 09260000 adds only `wallet_balance_paise` on users/providers; 09280000 adds full paise dual-write across all money tables with triggers and backfill |
| `20260612000000_assignment_one_sent_per_job` | `20260616120000_assignment_broadcast_dispatch` | 16120000 `DROP INDEX IF EXISTS assignment_attempts_one_sent_per_job`; 12000000 creates that index — mutually exclusive semantics |

---

## Prisma Execution Order (31 authoritative migrations)

Chronological folder order (Prisma `migrate deploy`):

1. `20260527105812_init`
2. `20260527160000_refresh_token_last_activity`
3. `20260527184532_auth_system_updatesauth_system_updates`
4. `20260528180000_add_provider_badges`
5. `20260529114745_part_6a_realtime_tracking`
6. `20260529120000_add_partner_registration`
7. `20260529140000_sensitive_field_lookup_hashes`
8. `20260530120000_user_devices_push_tokens`
9. `20260608120000_membership_premium_engine`
10. `20260608140000_referral_fraud_engine`
11. `20260608160000_prelaunch_compliance`
12. `20260608180000_membership_enterprise_10`
13. `20260608200000_membership_finalization`
14. `20260608210000_financial_ledger`
15. `20260608220000_financial_core`
16. `20260608230000_finance_ops_finalization`
17. `20260608240000_finance_ops_10_finalization`
18. `20260608250000_enterprise_observability`
19. `20260608250000_p0_security_financial_atomicity`
20. `20260608260000_p1_webhook_dedup_state_machine`
21. `20260608270000_finance_integrity_10_finalization`
22. `20260608280000_finance_integrity_10_phase2`
23. `20260609180000_p4_encryption_audit`
24. `20260609220000_p0_p1_concurrency_rbac`
25. `20260609250000_wallet_pending_hardening`
26. `20260609280000_money_paise_full_dual_write` ← **FAILED**
27. `20260610120000_enterprise_db_hardening`
28. `20260610140000_address_pii_encryption`
29. `20260616120000_assignment_broadcast_dispatch`
30. `20260711120000_booking_wait_time_bigint`
31. `20260731120000_event_foundation`

**Note:** On clean replay, Wave-1 migrations (23–30) run before `event_foundation` (31) due to timestamp ordering. Wave-1 migrations do not depend on event tables; this ordering is safe for schema objects.

No duplicate timestamps. Excluded superseded migrations not in authoritative set.

---

## SQL Safety Review (8 Wave-1 migrations)

| Migration | Classification | Destructive / Risky ops |
|-----------|----------------|-------------------------|
| 09180000 | ADDITIVE, CONSTRAINT_CHANGE, INDEX_CHANGE | `DROP CONSTRAINT users_email_key/phone_number_key`; `ALTER COLUMN email/phone DROP NOT NULL` — required for encryption migration; empty-DB safe |
| 09220000 | ADDITIVE, DATA_BACKFILL, CONSTRAINT_CHANGE | `UPDATE payments SET idempotency_key`; `SET NOT NULL`; unique index — empty DB: UPDATE no-op, safe |
| 09250000 | ADDITIVE, INDEX_CHANGE | Enum value EXPIRED; partial unique indexes — empty-DB safe |
| 09280000 | ADDITIVE, DATA_BACKFILL, TYPE_CHANGE | Triggers + bounded UPDATE backfill — **FAILS on empty DB** (see blocker) |
| 10120000 | CONSTRAINT_CHANGE, INDEX_CHANGE | CHECK constraints on paise columns — requires 09280000 paise columns |
| 10140000 | ADDITIVE | Address encrypted columns — requires `data_encryption_status` enum from 09180000 |
| 16120000 | INDEX_CHANGE (DROP) | `DROP INDEX IF EXISTS` — no-op on clean DB (index never created) |
| 071120000 | TYPE_CHANGE | `INT → BIGINT` on wait_time_ms — empty-DB safe |

**SQL Safety Result:** PASS for individual migration intent; **replay blocked by 09280000 defect**, not by destructive ops.

---

## Quality Gates (clean worktree @ `d7ac1cf`)

| Gate | Command | Result |
|------|---------|--------|
| prisma validate | `bunx prisma validate` (DATABASE_URL set) | PASS |
| prisma generate | `bunx prisma generate` | PASS |
| TypeScript | `bunx tsc --noEmit` | PASS |
| staging-safety tests | `bun test src/lib/__tests__/staging-safety.test.ts` | 9/9 PASS |
| event tests | `bun test src/events/__tests__/event-foundation.test.ts event-bus.test.ts` | 12/12 PASS |
| secret scan (migrations) | grep for credentials/URLs in 8 SQL files | PASS |

---

## Migration Replay

| Field | Value |
|-------|-------|
| REPLAY_INSTANCE | Local Docker `homigo-postgres` (isolated, not GCP staging) |
| REPLAY_DATABASE | `homigo_wave1_replay` (fresh CREATE DATABASE) |
| Starting state | EMPTY (0 public tables) |
| Expected migrations | 31 |
| Applied | 25 |
| Pending | 5 (not reached) |
| Failed | 1 (`20260609280000_money_paise_full_dual_write`) |
| Duration before failure | ~8s |
| CLEAN_REPLAY_31_OF_31 | **FAIL** |

### Failure detail

```
Migration name: 20260609280000_money_paise_full_dual_write
Database error code: 42P01
ERROR: relation "wallet_transfers" does not exist
```

**Root cause:** `09280000` executes `ALTER TABLE "wallet_transfers"` but **no migration on disk** (Phase-0, Wave-1, or deferred) contains `CREATE TABLE "wallet_transfers"`. The table exists in `schema.prisma` (`WalletTransfer` model) but was never added to the migration chain — schema orphan.

### Secondary latent defect (not reached)

`09280000` UPDATE/trigger blocks reference `users.wallet_balance_paise` and `providers.wallet_balance_paise` without `ADD COLUMN` in that migration. Those columns are created only in excluded superseded `09260000`. Even if `wallet_transfers` existed, backfill would likely fail next unless columns were pre-created.

---

## WAVE_1_DEPENDENCY_GAP

```
REMAINING_STAGE_D_SCHEMA_BLOCKER:
  migration: 20260609280000_money_paise_full_dual_write
  object: wallet_transfers (table)
  evidence: ALTER TABLE at line 43; zero CREATE TABLE matches in entire prisma/migrations/
  stage_d_path_impact: Indirect — migration replay cannot complete; Prisma P2022 on *_paise columns persists
  resolution: Engineering must either (a) add CREATE TABLE wallet_transfers to an earlier migration,
              (b) make 09280000 conditional/skip wallet_transfers if table absent, or
              (c) add wallet_balance_paise ADD COLUMN to 09280000 (subsume 09260000 fully)
  action: Human approval required — do NOT silently expand Wave-1 without review
```

---

## Partial Replay Verification (25/31 applied)

Structures from migrations that **did** apply:

| Check | Result | Evidence |
|-------|--------|----------|
| users.email_encrypted | PASS | `text`, nullable, no default |
| User encryption fields | PASS | email_encrypted, phone_encrypted, data_encryption_status=PARTIAL default |
| payments.idempotency_key | PASS | column NOT NULL; unique index `payments_idempotency_key_key` |
| Address encryption | NOT REACHED | migration 10140000 pending |
| Wallet hardening | PASS | expires_at, idempotency_key on wallet_transactions |
| *_paise columns | NOT REACHED | migration 09280000 failed mid-apply |
| Enterprise constraints | NOT REACHED | migration 10120000 pending |
| Assignment/broadcast | NOT REACHED | migration 16120000 pending |
| Booking wait-time BIGINT | NOT REACHED | migration 071120000 pending |

---

## Prisma Compatibility

| Check | Result |
|-------|--------|
| STAGE_D_PRISMA_COMPATIBILITY | **FAIL** — replay incomplete; *_paise and address encryption columns missing |
| Critical-path P2022 | Expected on User/Address/Booking/Payment full-row selects |
| Critical-path P2021 | N/A (tables exist for applied migrations) |

---

## Harness Compatibility (dry analysis)

`stage-d-staging-certification.ts` touches: User, Address, Service, Provider, Booking, Payment, Earning, WalletTransaction, AssignmentJob, AssignmentAttempt, EventOutbox, Tracking.

| Gate | Schema dependency | Replay DB state |
|------|-------------------|-----------------|
| D1 | User encryption + Address encryption + Provider/User paise | **PARTIAL** — encryption OK; paise/address encryption missing |
| D2–D8 | Full Wave-1 money + event_foundation columns | **BLOCKED** |

HARNESS_SCHEMA_COMPATIBILITY: **FAIL**

---

## Deferred Schema Analysis

Remaining 15 deferred migrations do not create `wallet_transfers`. The blocker is a **migration-chain orphan**, not a missing deferred Wave-2 migration.

WAVE_1_STAGE_D_SCHEMA_PARITY: **FAIL**  
FULL_APPLICATION_SCHEMA_PARITY: **DEFERRED** (expected; 15+ migrations remain)

---

## Safety

| Check | Result |
|-------|--------|
| Authoritative staging DB modified | NO |
| Production modified | NO |
| Production migration | NO |
| Authoritative DB targeted | NO (`homigo-staging-step6a-pitr-20260803` untouched) |

---

## Event State (recorded, unchanged)

Per execution brief: staging events may be ON from Stage-D partial rollout (`00021-h64`). This gate did not mutate staging. Event flags unchanged by this execution.

---

## Verdict

**D-REMEDIATION CLEAN REPLAY: NOT CERTIFIED**

Do **NOT** apply Wave-1 to authoritative staging until `09280000` clean-replay defect is remediated and 31/31 replay passes.

Safe next step: engineering review of `WAVE_1_DEPENDENCY_GAP` above, then re-run this gate.

# Stage C Step 6B — Migration Chain Remediation Certification

**Certification date:** 2026-08-03  
**Scope:** STAGING ONLY — project `homigo-497619`  
**Production impact:** NONE CONFIRMED  
**Result:** **PASS — migration chain replays cleanly through `event_foundation`**

---

## NEW RC SHA (Step 6B Remediation)

| Field | Value |
|-------|-------|
| **APPLICATION_RC_SHA** | `e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| **Image tag** | `asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:e459175c72b1ece6e6246e5d69f559f23cd0a23e` |
| **Image digest** | `sha256:3c3138aa0bee7405c43193abcf93ef947be3db5878b953735e91437f6ab5eefa` |
| **Remediation commits** | `afb5cd6` → `2491b7b` → `e459175` (3 commits on `main`) |
| **Prior RC (Step 5 deploy, unchanged on Cloud Run)** | `262befa14e249b51f94a5ba43cd692a8c5919db1` |

### Remediation commit summary

| SHA | Change |
|-----|--------|
| `afb5cd60b77236a0bda70648e8bbe63ec438a04d` | `part_6a`: 6× `DROP INDEX IF EXISTS`; defer `email_logs` / `partner_background_checks` indexes to `add_partner_registration` |
| `2491b7bb5667bfa85228e54d4e1f25d45d48c91e` | `membership_premium_engine`: add `ReferralStatus` + referral tables; `referral_fraud_engine`: `CommissionStatus` default `PENDING` |
| `e459175c72b1ece6e6246e5d69f559f23cd0a23e` | `financial_ledger`: add `HCoinTxnType` + H-Coin tables before `finance_integrity_10_phase2` |

---

## Six DROP INDEX Statements — Semantics (part_6a)

| Index | Origin | Remediation | Intended semantics |
|-------|--------|-------------|-------------------|
| `providers_aadhar_number_key` | Created in `add_partner_registration` (later) | `DROP INDEX IF EXISTS` | Remove plaintext uniqueness; hash-based lookup in `sensitive_field_lookup_hashes` |
| `providers_pan_number_key` | Created in `add_partner_registration` (later) | `DROP INDEX IF EXISTS` | Same |
| `providers_bank_account_number_key` | `init` | `DROP INDEX IF EXISTS` | Remove before encrypted/hash migration |
| `providers_tax_id_key` | `init` | `DROP INDEX IF EXISTS` | Same |
| `providers_upi_id_key` | `init` | `DROP INDEX IF EXISTS` | Same |
| `users_kyc_document_number_key` | `init` | `DROP INDEX IF EXISTS` | Same |

**Historical note:** `IF EXISTS` makes empty-DB replay idempotent. Already-applied databases do not re-run this migration; live `homigo-staging-db` partial state is unchanged (no cutover).

---

## Quality Gates (remediation RC)

| Gate | Result |
|------|--------|
| `bunx prisma validate` | PASS |
| Staging safety tests (`staging-safety.test.ts`) | 9/9 PASS |
| Secret scan (migration SQL / evidence) | PASS — no credentials in artifacts |
| Cloud Build (clean worktree `e459175`) | SUCCESS (~3m49s) |

---

## Clean Empty DB — Replay ALL 23 Migrations

| Field | Value |
|-------|-------|
| Replay instance | `homigo-staging-migration-replay-20260803` |
| Database | `homigo_staging_db` (dropped/recreated before each replay) |
| Job | `homigo-staging-replay-migrate` |
| Successful execution | `homigo-staging-replay-migrate-wl6qd` |
| Migrations in RC | **23** (git-tracked only) |
| Final migration reached | **`20260731120000_event_foundation`** |
| Exit code | **0** — `All migrations have been successfully applied.` |

### Post-replay status

| Check | Result |
|-------|--------|
| `prisma migrate status` | **Database schema is up to date!** (23 found, 0 pending) |
| Execution | `homigo-staging-replay-migrate-s9clw` |

---

## Event Foundation

Migration `20260731120000_event_foundation` applied successfully. Creates:

- `EventOutboxStatus` enum
- `event_outbox`
- `event_consumer_receipts`
- `event_dead_letters`
- `scheduled_jobs`
- Booking ETA label columns on `bookings`

**Event flags on Cloud Run (unchanged):** `EVENTS_OUTBOX_ENABLED=false`, `EVENTS_CONSUMERS_ENABLED=false`

---

## Schema vs `schema.prisma`

| Check | Result |
|-------|--------|
| Migration chain replay (23) | **PASS** |
| `prisma migrate status` on replay DB | **PASS** — up to date |
| Full `schema.prisma` parity (all models) | **DOCUMENTED GAP** — `schema.prisma` at RC includes models/tables from **uncommitted** migrations (48 dirs on disk, 23 tracked in git). This is expected for Phase 0 RC scope: certify the **committed 23-migration chain** through `event_foundation`, not the full working-tree migration backlog. |

Shadow-DB `prisma migrate diff --from-migrations (23) --to-schema-datamodel` confirms remaining gap is **untracked migrations 24–48**, not defects in the remediated chain.

---

## Live Staging (unchanged)

| Resource | State |
|----------|-------|
| Cloud Run revision | `homigo-backend-staging-00017-wfk` (SHA `262befa`) |
| Live DB | `homigo-staging-db` — partial Step 6 failure preserved |
| PITR clone | `homigo-staging-step6a-pitr-20260803` — retained |
| Replay clone | `homigo-staging-migration-replay-20260803` — retained |
| Production | **NOT TOUCHED** |

---

## Step 6B Verdict

**STEP 6B: PASS**

Migration chain remediation is complete. Clean empty-database replay applies all **23** committed migrations including **`20260731120000_event_foundation`**. NEW RC SHA: **`e459175c72b1ece6e6246e5d69f559f23cd0a23e`**.

**Next (out of scope for 6B):** cutover plan for live `homigo-staging-db`, optional Cloud Run deploy of new RC, commit/push evidence to remote.

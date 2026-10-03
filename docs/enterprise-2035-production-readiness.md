# HOMEEIGO — Enterprise 2035 Production Readiness

---

## 0. The governing fact

**There is no production deployment of HOMEEIGO, and no production runtime was observed.**

What exists is a complete local development stack (backend + 3 web apps + Postgres + Redis + Prometheus/Grafana/Alertmanager + a staging Postgres/pgbouncer pair), a production `Dockerfile` that has been build- and boot-verified, Cloud Run and Kubernetes manifests, and a staging-deploy GitHub Actions workflow.

Every "production certification" document in the repository root — and there are more than a dozen, several claiming finality — describes readiness *assessments*, not a running production system. This document supersedes them.

---

## 1. Requirement tiers

### Tier A — required for CODING (all satisfied)

| Requirement | State |
|---|---|
| Local DB + Redis | ✅ Docker Compose, healthchecked |
| Backend boots | ✅ live on :3000, `/health` 200 |
| All apps typecheck | ✅ 6/6 exit 0 |
| Migrations run | ✅ 125 applied |
| Test harness | ✅ 218 backend + 68 frontend spec files |
| CI | ✅ tsc, migration safety, DDL guard, log governance, targeted tests |
| Seed data | ✅ present (and contaminating — see §4) |

### Tier B — required for STAGING

| Requirement | State | Gap |
|---|---|---|
| Deployable image | ✅ | `Dockerfile` multi-stage, non-root, reads `$PORT`; project memory records it caught 3 real deploy bugs |
| Staging infra | ◐ | staging Postgres + pgbouncer containers exist; no app deployment |
| Staging deploy pipeline | ✅ | `.github/workflows/staging-deploy.yml` |
| Migration integrity | ❌ | **3 rolled-back migrations — history ≠ schema (DB-4)** |
| Secrets management | ❌ | plaintext `.env` with real credentials |
| `ALLOWED_ORIGINS` | ❌ | absent from `.env` and `.env.example`; sole input to production CORS |
| Dev bypasses disabled | ❌ | `LOAD_TEST_MODE=1`, `HOMIGO_ALLOW_PAYMENT_MOCKS=1` active |
| `PII_MASTER_KEY` | ❌ | absent — silent default derivation caused a prior incident |
| Observability wired to the deployment | ◐ | stack runs locally; staging Grafana/Prom/AM containers exist |
| Smoke tests post-deploy | ✅ | extensive `smoke:*` scripts |

### Tier C — required for PRODUCTION

| Requirement | State | Gap |
|---|---|---|
| Production runtime | ❌ | **does not exist** |
| Managed Postgres with PITR | ❌ | Docker Postgres; 2 local `.dump` files only |
| Off-host backups | ❌ | `S3_BUCKET` absent; backups on the dev machine |
| Restore drill | ◐ | `verify-restore-report.json` exists (2026-09-06); not re-run |
| Autovacuum / DB hygiene | ❌ | **never run on any table; 329 MB table holding 1 row** |
| Audit retention | ❌ | 575k PII-bearing rows, no policy |
| Object storage | ❌ | 8,746 files / 21 MB on local disk |
| Email delivery | ❌ | `RESEND_API_KEY` empty; `/ready` reports `email: not configured` |
| Sentry in production | ◐ | DSN set; dev is deliberately a no-op; production path unproven |
| Alert routing to humans | ◐ | Alertmanager + rules exist; no verified on-call destination |
| Load testing at target scale | ❌ | never run with rate limiting enabled |
| Rollback procedure | ◐ | documented; unexercised against a live deployment |
| Runbooks | ✅ | `docs/INFRA_RUNBOOK.md`, war-room docs |
| SLO/SLA | ❌ | none defined |
| Capacity plan | ❌ | none |
| DPDP/GDPR consent withdrawal | ❌ | endpoint unreachable from any client |
| Mobile store readiness | ◐ | icons present, EAS configured; `EXPO_ACCESS_TOKEN` absent; never device-tested |

---

## 2. Production blockers, ranked

### BLOCKER-1 (P0) — migration history cannot rebuild the schema
3 of 125 migrations are recorded failed + rolled back, yet their objects exist. A fresh production database built from this history **will not match** the current schema. Everything else in Tier C is downstream of this.

**Exit:** generate a verified baseline, reconcile the 3 entries, add a CI job that applies migrations to an empty DB and diffs against `schema.prisma`.

### BLOCKER-2 (P0) — no secret management, real credentials in `.env`
Twilio (real, `SMS_ENABLED=true`), Maps, Sentry, AWS, Razorpay test keys in plaintext. Two prior incidents already occurred from this exact setup: real SMS sent from tests, and chaos backends polluting the production Sentry project.

**Exit:** Secret Manager for all non-local credentials; rotate the Twilio token; sandbox-only keys on developer machines.

### BLOCKER-3 (P0) — dev bypasses live in the environment
`LOAD_TEST_MODE=1` **disables the global rate limit**. `HOMIGO_ALLOW_PAYMENT_MOCKS=1` enables payment mock paths.

**Exit:** `assertProductionConfig()` hard-fails on either when `APP_ENV != dev`; pre-deploy check over all non-dev env files.

### BLOCKER-4 (P0) — no durable, off-host backup
Two `.dump` files on the developer's disk (48 MB from 2026-08-16, 64 MB from 2026-08-29). No PITR, no off-host copy, no recent restore drill.

**Exit:** managed Postgres with PITR; automated off-host backup; scheduled restore drill with a recorded RTO/RPO.

### BLOCKER-5 (P1) — database hygiene is unmanaged
Autovacuum has **never run** on any inspected table. ~⅓ of the 1,060 MB database is dead space. 575k audit rows have no retention. This will compound, not stay static.

### BLOCKER-6 (P1) — `ALLOWED_ORIGINS` unset and undocumented
Sole input to the production CORS allowlist; absent from both `.env` and `.env.example`.

### BLOCKER-7 (P1) — money-state integrity gaps
- 53 payments stranded in `REFUNDING` for 16–35 days (recovery sweep gated off).
- ₹52,939 wallet drift across 24 users, **with no invariant asserting the balance equals its transactions**.
- 18 completed bookings with no earning row.

The ledger itself is perfect. These are balance-column and lifecycle gaps, and each needs an automated invariant before production.

### BLOCKER-8 (P1) — compliance surface unreachable
`POST /api/compliance/consent/withdraw` and `GET /api/compliance/request/*` have no client consumer. DPDP/GDPR require both.

### BLOCKER-9 (P1) — no production email
`RESEND_API_KEY` empty. Receipts, refund notices, verification and password reset all depend on it.

### BLOCKER-10 (P2) — never load-tested with rate limiting on
Harness exists (`load-test:100|500|1000`, k6 scripts). Prior work recorded the ceiling as CPU-bound, measured with `LOAD_TEST_MODE=1` — i.e. with rate limiting disabled.

---

## 3. What is genuinely production-grade today

Stated plainly, because the blocker list above is not the whole picture.

| Area | Evidence |
|---|---|
| **Double-entry ledger** | 975 journals, global balance exactly 0, 0 NULL paise, 0 orphan payments |
| **Auth & authorization** | Runtime-verified 401s incl. forged JWT; 3 revocation mechanisms; single-query verification |
| **Admin RBAC** | 199 rules, fails closed 3 ways, every denial audited |
| **Webhook handling** | Authenticate-before-parse, content-hash idempotency, no config disclosure |
| **Server-authoritative pricing** | Client sends ids + quantities only |
| **Event backbone** | Outbox + consumers verified advancing under load |
| **Leader election** | Redis lease with Postgres advisory fallback — **observed failing over correctly in production runtime** |
| **Schema rigour** | 1,838 CHECK constraints, 171 FKs, 34 triggers |
| **Migration safety gates** | 0 destructive statements in 125 migrations; prebuild + CI guards |
| **Log governance** | 3 barriers making a repeat of the 699 MB log explosion structurally impossible |
| **Concurrency hardening** | Documented fixes for payout races, notification double-send, FK lock contention, consumer idempotency |
| **Container** | Multi-stage, non-root, `$PORT`-aware, boot-verified |
| **Code discipline** | 0 TODO/FIXME/HACK in production source; 6/6 typecheck clean; self-describing limits throughout |

---

## 4. Test-data contamination

The live `homigo_db` mixes fixture and real-shaped data:
- 11 users hold non-zero wallet balances with **zero** wallet transactions.
- Project memory records 231 fixture bookings (~34 %), including 14 CREDITED.
- Project memory records a prior incident where an over-broad dedupe deleted ~3,939 completed bookings via `prisma db execute` hitting the live DB.

**Consequence for this audit:** every business-volume figure quoted (704 bookings, 419 payments, 882 users) describes a contaminated development database, not a production baseline.

**Action before staging:** build a clean, seeded, reproducible dataset and stop treating `homigo_db` as both the dev sandbox and the integrity reference.

---

## 5. Environments

| Concern | State |
|---|---|
| `NODE_ENV` | `development` |
| `APP_ENV` | `dev` |
| Env vars read by source | **212** |
| Documented in `.env.example` | **124** |
| Read by source but undocumented | **120** |
| Documented but never read | **33** (e.g. `ENABLE_AI`, `ENABLE_LIVE_TRACKING`, `ENABLE_PREMIUM_FEATURES`, `POSTHOG_KEY`, `AXIOM_TOKEN`) |

An operator provisioning from `.env.example` would miss 120 variables and set 33 that do nothing. Several missing ones are safety-critical: `ALLOWED_ORIGINS`, `TRUST_PROXY`, `BLOCK_BOOT_ON_INTEGRITY_FAIL`, `AGENTS_ENABLED`, `HOMIGO_ALLOW_EXTERNAL`.

---

## 6. Ordered path to production

**Phase 1 — Make the schema reproducible (blocks everything)**
1. Reconcile the 3 rolled-back migrations; produce a verified baseline.
2. CI job: apply migrations to an empty DB, diff against `schema.prisma`.
3. `VACUUM FULL` the bloated tables; fix autovacuum; apply audit retention.

**Phase 2 — Make the environment safe**
4. Secret Manager; rotate Twilio; sandbox keys locally.
5. Hard-fail on `LOAD_TEST_MODE` / `HOMIGO_ALLOW_PAYMENT_MOCKS` outside dev.
6. Document all 212 env vars; delete the 33 phantoms; require `ALLOWED_ORIGINS` and `PII_MASTER_KEY` in production config assertion.

**Phase 3 — Make the data trustworthy**
7. Wallet-balance invariant in the financial-integrity run; reconcile the 24 drifting users.
8. Enable `REFUND_AUTO_RECOVERY_ENABLED`; drain the 53 stranded refunds.
9. Reaper for the 111 zombie ETL rows; earning backfill for the 18 bookings.
10. Clean reproducible seed dataset; stop using `homigo_db` as the integrity reference.

**Phase 4 — Stand up staging for real**
11. Deploy the image to staging; managed Postgres with PITR; off-host backups; restore drill with recorded RTO/RPO.
12. Configure Resend; verify email end-to-end.
13. Point Sentry at a staging project; prove an event arrives.
14. Route Alertmanager to a real destination; prove one alert reaches a human.

**Phase 5 — Prove it holds**
15. Load test 100/500/1000 with rate limiting **on**; record p50/p95/p99.
16. WebSocket fan-out at realistic connection counts.
17. Mobile device certification on physical hardware (USB dev build).
18. Define SLOs and a capacity plan.

**Phase 6 — Close compliance**
19. Wire consent withdrawal and DSR status into the customer app.
20. Verify deletion propagates to the audit tables.

Only then is a production cutover defensible.

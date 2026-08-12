# HOMIGO — P2 Operational Validation Report

> Evidence-based. Each item is COMPLETED / PARTIAL / FAILED / NOT VERIFIED.
> "PARTIAL" here means **the validation mechanism is built and runs, but the
> live execution producing pass/fail evidence requires infrastructure not
> present in this session** (no `k6`/`pg_dump`/`aws`, no running DB/Redis/API).
> Run commands and evidence paths are given so each item can be certified
> COMPLETE in staging/CI. **Nothing is assumed to pass.**

Legend: ✅ COMPLETED · 🟡 PARTIAL · ❌ FAILED · ⚪ NOT VERIFIED

| # | Item | Mechanism | Live evidence here | Status |
|---|---|:--:|:--:|:--:|
| 1 | DR Restore Drill | ✅ built | ⚪ (no pg tools/DB) | 🟡 |
| 2 | S3 Backup Validation | ✅ built | ⚪ (no AWS creds) | 🟡 |
| 3 | Sentry Delivery | ✅ built | ⚪ (no DSN) | 🟡 |
| 4 | Grafana Coverage | ✅ built | ✅ 100% (9/9) | ✅ |
| 5 | Alertmanager Reliability | ✅ built | ✅ 9/9 + channels | ✅ |
| 6 | Booking Load Test | ✅ built | ⚪ (no k6/API) | 🟡 |
| 7 | Payment Load Test | ✅ built | ⚪ (no k6/API) | 🟡 |
| 8 | Wallet Load + Integrity | ✅ built | ⚪ (no DB) | 🟡 |
| 9 | Multi-Node / Cluster | ✅ built | ⚪ (no Redis) | 🟡 |
| 10 | Penetration Testing | ✅ built | 🟡 ran; needs live API | 🟡 |

---

## 1. Disaster-Recovery Restore Drill — 🟡 PARTIAL

- **Evidence:** `scripts/p2-validation/dr-restore-drill.ts`; runbook `P2_DR_RUNBOOK.md`; evidence `docs/p2/evidence/dr-restore-drill.md` (currently ABORTED: no scratch DB / pg tools here).
- **Risk:** Unrehearsed restore → unknown RTO and undetected corruption.
- **Impact:** Recovery may exceed 30 min or lose ledger/wallet/membership consistency.
- **Fix:** Timed drill restores into an isolated DB and verifies bookings, payments, wallets, HCoins, memberships, ledger table, and **no negative balances**; emits RTO/RPO/Recovery reports. Production restore steps documented.
- **Verification:** `DR_SCRATCH_DATABASE_URL=… bun run p2:dr` → RTO ≤ 30m, RPO ≤ 15m, integrity PASS.
- **Rollback:** Drill never writes prod (guard-railed); drop the scratch DB.
- **Success criteria:** RTO ≤ 30 min, RPO ≤ 15 min, zero corruption (see DR-001/DR-002).

## 2. S3 Backup Validation — 🟡 PARTIAL

- **Evidence:** `scripts/p2-validation/s3-backup-validation.ts`; `docs/p2/evidence/s3-backup-validation.md` (NOT VERIFIED: `AWS_S3_BUCKET` unset here).
- **Risk:** Offsite backups could be unencrypted, unversioned, non-replicated, or unrecoverable.
- **Impact:** Total data loss if the only copy is corrupt or in a failed region.
- **Fix:** Validates backup creation, bucket+object SSE, versioning, lifecycle rules, cross-region replication, and **proves recoverability** by downloading the newest dump, asserting the `PGDMP` magic header, and matching SHA-256/size.
- **Verification:** `AWS_S3_BUCKET=s3://homigo-backups bun run p2:s3` → all checks PASS, `recoverable=true`.
- **Rollback:** Read-only against S3; nothing to roll back.
- **Success criteria:** 100% recoverability proven (restore_capability + checksum_validation PASS).

## 3. Sentry Delivery Validation — 🟡 PARTIAL

- **Evidence:** `scripts/p2-validation/sentry-synthetic.ts`; `docs/p2/evidence/sentry-validation.md` (NOT VERIFIED: no `SENTRY_DSN`).
- **Risk:** Production exceptions silently undelivered → blind on-call.
- **Impact:** Payment/auth/webhook failures unnoticed; MTTR balloons.
- **Fix:** Emits a synthetic failure per category (database, payment, webhook/integration, auth, security) via the existing `observability` module with a unique marker + release tag; optionally confirms delivery + grouping via the Sentry REST API. Frontend/mobile snippets + source-map note included.
- **Verification:** `SENTRY_DSN=… SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… bun run p2:sentry` → delivery confirmed.
- **Rollback:** None (synthetic events only; tag-filter to delete in Sentry if desired).
- **Success criteria:** ≥1 grouped issue per category visible in Sentry with the run marker + release.

## 4. Grafana Dashboard Validation — ✅ COMPLETED

- **Evidence:** `scripts/p2-validation/grafana-coverage.ts`; `docs/p2/evidence/grafana-coverage.md` — **coverage 44% → 100% (9/9 domains)** after extending the dashboard (panels 8–11: API p50/p95/p99 latency, wallet+HCoin, finance settlements/payouts/refunds/chargebacks, integrity stat).
- **Risk (pre-fix):** Finance/wallet/integrity metrics emitted but invisible → blind to money-movement anomalies.
- **Impact:** Drift/leakage undetectable on dashboards.
- **Fix:** Added panels for every previously-dark domain; validator harvests dynamic ops gauges (`setOpsGauge`) to avoid false negatives.
- **Verification:** `bun run p2:grafana` → exit 0, coverage 100%, missing/gap lists empty for required domains.
- **Rollback:** Revert the dashboard JSON additions (panels 8–11).
- **Success criteria:** All 9 required domains COVERED (emitted **and** dashboarded) — met.

## 5. Alertmanager Validation — ✅ COMPLETED

- **Evidence:** `scripts/p2-validation/alert-reliability.ts`; `docs/p2/evidence/alert-reliability.md` — required conditions **4/9 → 9/9**; severities critical/warning/escalation routed; Slack + email + PagerDuty + escalation receiver now configured.
- **Risk (pre-fix):** No alerts for DB outage, high latency, webhook failure, disk/CPU pressure; webhook-only delivery (single transport).
- **Impact:** Major incidents (DB down, latency, webhook failures) silent; one transport failure silences all alerts.
- **Fix:** Added rules `DatabaseDown`/`BackendDown` (`up{job=…}==0`), `HighRequestLatency` (p95 histogram), `WebhookFailureSpike` (`ops_alerts_total{alertType="webhook_failure"}`), `FinanceIntegrityFailure`, `ReconciliationMismatch`, and `DiskPressure`/`CpuPressure`/`MemoryPressureNode` (node_exporter, scrape job added). Added Slack/email/PagerDuty receivers + tuned escalation (`group_wait: 0s`, faster repeat).
- **Verification:** `bun run p2:alerts` → exit 0, 9/9 covered, all used severities routed, Slack+email present.
- **Rollback:** Revert `homigo-alerts.yml`, `alertmanager.yml`, `prometheus.yml` additions.
- **Success criteria:** Every required alert defined + routed + multi-channel delivery — met (runtime Slack/email/escalation **delivery** to be confirmed once Alertmanager runs in staging).

## 6. Real Booking Load Test — 🟡 PARTIAL

- **Evidence:** `scripts/load-test/k6/booking.js` (+`lib.js`); stages ramp to 100/500/1000 VUs via `-e STAGE=`; SLO thresholds p95<500ms, p99<1200ms, error<1%; writes `docs/p2/evidence/k6-booking-<stage>.json`.
- **Risk:** Unknown capacity / DB contention / race conditions under real concurrency.
- **Impact:** Outage or corrupted bookings at launch traffic.
- **Fix:** k6 flow — search services → view provider → (authed, staging-only) create→accept→complete→rate. Safe-by-default (read flows; mutations gated by `ALLOW_WRITES=1`).
- **Verification:** `k6 run -e STAGE=1000 -e BASE_URL=… scripts/load-test/k6/booking.js` → thresholds pass; pair with `p2:wallet-integrity` after to confirm no race-induced drift.
- **Rollback:** Load test only; run against staging.
- **Success criteria:** p95 < 500ms and error rate < 1% at 1000 VUs; capacity estimate recorded in the k6 summary.

## 7. Real Payment Load Test — 🟡 PARTIAL

- **Evidence:** `scripts/load-test/k6/payment.js`; `docs/p2/evidence/k6-payment-<stage>.json`.
- **Risk:** Order-creation contention, webhook backpressure, signature-verify regressions under load.
- **Impact:** Lost/duplicate payments; refund orchestration failures.
- **Fix:** Validates order creation (staging), **webhook bad-signature rejection under load** (no test keys needed), payment-history reads, concurrent attempts.
- **Verification:** `k6 run -e STAGE=500 -e LOGIN_EMAIL=… scripts/load-test/k6/payment.js`.
- **Rollback:** Staging only.
- **Success criteria:** Bad signatures rejected 100%; p95<500ms; error<1%; capacity estimate recorded.

## 8. Real Wallet Load Test + Integrity — 🟡 PARTIAL

- **Evidence:** `scripts/load-test/k6/wallet.js`; integrity gate `scripts/p2-validation/wallet-integrity-check.ts` (reuses `financialIntegrityService.validate()`); `docs/p2/evidence/wallet-integrity.md` (NOT VERIFIED here: DB down).
- **Risk:** Double-spend, negative balances, ledger drift under concurrent balance ops.
- **Impact:** Direct financial loss / liability mismatch.
- **Fix:** k6 exercises top-up/transfer/cashback/gift-card/HCoin/withdrawal + concurrent balance reads (mutations staging-gated); the integrity gate asserts **no double-spend / no negative balance / no ledger drift** before and after.
- **Verification:** Run wallet k6, then `bun run p2:wallet-integrity` → score 100, all P2 criteria PASS.
- **Rollback:** Staging only.
- **Success criteria:** Zero double-spend, zero negative balances, zero ledger drift.

## 9. Multi-Node Validation — 🟡 PARTIAL

- **Evidence:** `scripts/p2-validation/cluster-validation.ts`; `docs/p2/evidence/cluster-validation.md` (NOT VERIFIED here: no `REDIS_URL`).
- **Risk:** Duplicate job execution, races, split-brain when scaled horizontally.
- **Impact:** Double payouts/notifications, inconsistent state across nodes.
- **Fix:** Against real shared Redis, simulates 2- and 3-node leader election (exactly one winner), 5-round scheduler coordination (no duplicate execution), shared atomic rate-limit accounting, and single WS fan-out delivery with loop-guard — reusing `acquireLock`/`runWithLeaderLock`/`consume`/`roomManager`.
- **Verification:** `REDIS_URL=… bun run p2:cluster` → all checks PASS; for true process isolation run on 2–3 hosts sharing one Redis.
- **Rollback:** Read/transient Redis keys only.
- **Success criteria:** No duplicate execution, no race conditions, no split-brain.

## 10. Penetration Testing — 🟡 PARTIAL (probe set executed; needs live API + creds)

- **Evidence:** `scripts/p2-validation/pentest.ts`; `docs/p2/evidence/pentest.md` with **Risk Matrix**, **Remediation Matrix**, **Executive Security Summary**. In this session the API was unreachable, so network probes are recorded NOT VERIFIED (never assumed pass).
- **Risk:** OWASP Top 10 — broken auth, IDOR, privilege escalation, mass assignment, JWT/OAuth/webhook attacks, rate-limit bypass, injection, file-upload abuse, business logic.
- **Impact:** Account takeover, data exposure, financial fraud.
- **Fix:** Black-box probes asserting secure behavior: missing/malformed/`alg:none`/tampered-signature JWT rejection; non-admin blocked from admin (RBAC); IDOR cross-account; mass-assignment of `role/isAdmin/walletBalance` ignored; webhook no/bad-signature rejection; auth rate-limit + `X-Forwarded-For` bypass resistance; SQLi tautology no-leak; security headers + CORS credential reflection; disallowed file-upload rejection.
- **Verification:** `API_URL=… PENTEST_EMAIL_A=… PENTEST_PW_A=… PENTEST_EMAIL_B=… PENTEST_PW_B=… PENTEST_B_BOOKING_ID=… bun run p2:pentest` → 0 VULNERABLE.
- **Rollback:** Non-destructive probes; run against staging.
- **Success criteria:** Zero VULNERABLE findings; all NOT VERIFIED items resolved with creds + running API.

---

## How to certify everything COMPLETE (single staging pass)

```bash
# In staging (Linux image with pg tools + k6 + aws + DB/Redis/API up):
bun run p2:static                 # grafana + alerts (already PASS)
DR_SCRATCH_DATABASE_URL=… bun run p2:dr
AWS_S3_BUCKET=s3://homigo-backups bun run p2:s3
SENTRY_DSN=… SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… bun run p2:sentry
REDIS_URL=… bun run p2:cluster
k6 run -e STAGE=1000 scripts/load-test/k6/booking.js
k6 run -e STAGE=500  scripts/load-test/k6/payment.js
k6 run -e STAGE=500  scripts/load-test/k6/wallet.js
bun run p2:wallet-integrity
API_URL=… PENTEST_EMAIL_A=… PENTEST_PW_A=… bun run p2:pentest
```
All artifacts land in `docs/p2/evidence/` for the certification record.

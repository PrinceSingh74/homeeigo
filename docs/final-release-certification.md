# HOMEEIGO — Final Enterprise Release Certification

Date: 2026-09-20 · Branch: `cursor/stage-e-step-13-certification` · No commits were made.
Rules applied: a BLOCKED gate is never converted to PASS; production claims need production evidence;
dev `homigo_db` was treated as read-only (SELECT, `pg_dump`, catalog reads only).

Each section gives STATUS / EVIDENCE / TEST / RESULT / REMAINING RISK. The tracking table is
`docs/release-certification-status.md`.

---

### 1. Reconciliation of existing data
- **STATUS:** PASS (classification) · remediation BLOCKED on owner
- **EVIDENCE:** `docs/release-reconciliation-report.md`
- **TEST:** read-only classification of all 153 anomalies on `homigo_db`
- **RESULT:** 146 are test/script fixtures (8 prefixes) and 7 are genuine. Genuine cases: C1, 4 wallet-paid cancellations refunded ₹0; C2, HOMIGO-20260812-00002 stuck REFUNDING; C3, 2 JOB_OWNER mismatches. 0 UNKNOWN. No data was changed.
- **REMAINING RISK:** C1/C2 customers are owed money until an owner approves remediation.

### 2. Business decisions
- **STATUS:** BLOCKED
- **EVIDENCE:** `docs/release-decisions-required.md` (repo search recorded)
- **TEST:** n/a (policy)
- **RESULT:** No authoritative rule exists for D1 (multi-hour scheduling), D2 (admin refund default), D3 (unpaid expiry) or D4 (GST supplier). None was chosen silently.
- **REMAINING RISK:** Behaviour in those four areas is current-code behaviour, not approved policy.

### 3. Four-hour scheduling
- **STATUS:** BLOCKED (D1)
- **EVIDENCE:** `scheduling-contract.characterization.test.ts`
- **TEST:** 8 characterization cases
- **RESULT:** Current behaviour is pinned: a 60-minute slot regardless of duration. Case #10 was corrected: it had only passed on a test DB that lacked the production unique index.
- **REMAINING RISK:** A 4 h booking blocks 1 h of the partner calendar until D1 is decided.

### 4. Admin cancellation
- **STATUS:** PASS
- **EVIDENCE:** `release-concurrency.integration.test.ts`, `admin-booking-integrity`
- **TEST:** admin cancel ‖ captured webhook ×5; cancel ‖ dispatch ×5
- **RESULT:** Exactly one terminal state, one refund of the paid amount, no open offers.
- **REMAINING RISK:** The refund default is policy D2.

### 5. Payment integrity
- **STATUS:** PASS
- **EVIDENCE:** `booking-payment-integrity`, `release-concurrency` (partial refund ‖ replayed capture ‖ replayed verify)
- **TEST:** integration against real Postgres
- **RESULT:** Payment never writes booking status. Replays are idempotent. There is one journal per money event.
- **REMAINING RISK:** Live Razorpay was not exercised (test keys; no production gateway).

### 6. Financial invariants
- **STATUS:** PASS
- **EVIDENCE:** `booking-consistency.service.ts` (+7 checks), journal balance queries
- **TEST:** invariants on both DBs
- **RESULT:** Journals balance exactly (test 5,106 · dev 971, ₹7,09,341.10 debit = credit). 0 duplicate idempotency keys. Every product-format hit is a fixture.
- **REMAINING RISK:** Invariants are verified on dev/test data only.

### 7. Money representation (Float → paise)
- **STATUS:** PASS (analysis) · BLOCKED (execution)
- **EVIDENCE:** `docs/money-representation-migration-plan.md`
- **TEST:** precision scan
- **RESULT:** 0 sub-paise values and 0 twin drift across 59,564 values.
- **REMAINING RISK:** Money is still computed in Float. Execution needs a production DB, backup and window.

### 8. Financial retention guards
- **STATUS:** PASS
- **EVIDENCE:** migration `20260920090000_financial_history_delete_guard`
- **TEST:** `financial-history-guard.integration.test.ts` 5/5
- **RESULT:** Hard deletes of users/partners/bookings with money history are refused (23001). This test also leaked an async dispatch into the next file; fixed.
- **REMAINING RISK:** None known.

### 9. Authentication hardening
- **STATUS:** FAIL (open engineering item)
- **EVIDENCE:** `docs/auth-refresh-cookie-plan.md`, `refresh-token-reuse.integration.test.ts` 2/2
- **TEST:** rotation and reuse over HTTP
- **RESULT:** Reuse revokes the family, bumps the auth epoch and kills every session. The web apps still keep refresh tokens in localStorage.
- **REMAINING RISK:** An XSS can steal a refresh token (bounded by reuse detection). The per-audience HttpOnly cookie migration is not implemented.

### 10. Partner mobile (real device)
- **STATUS:** BLOCKED
- **EVIDENCE:** `adb devices` → none attached
- **TEST:** none possible
- **RESULT:** Not tested on a device. No claim is made.
- **REMAINING RISK:** Native modules, GPS and background behaviour are unverified on hardware.

### 11. Customer mobile (real device)
- **STATUS:** BLOCKED
- **EVIDENCE:** as §10
- **TEST:** none possible
- **RESULT:** Not tested on a device.
- **REMAINING RISK:** As §10.

### 12. Partner web E2E (isolated DB)
- **STATUS:** PASS
- **EVIDENCE:** `e2e-isolated.sh` (backend :3100 → homigo_test; demo accounts seeded there; 0 homigo_db references in the backend log)
- **TEST:** Playwright `login-dashboard`, `journey-partner`
- **RESULT:** 2/2 on 4 consecutive warm runs (8 passes). The first cold run failed once: the post-login redirect stayed on `/login` for 60 s while `next dev` compiled the route on demand. The cause is probable, not proven, and it did not recur.
- **REMAINING RISK:** Only core journeys ran; data-heavy specs were not run on the isolated DB.

### 13. Admin E2E (isolated DB)
- **STATUS:** PASS
- **EVIDENCE:** as §12
- **TEST:** Playwright `login-dashboard`, `journey-admin`
- **RESULT:** 2/2 on 3 runs (Login → Ops Map → Heatmap → Geofence; dashboard).
- **REMAINING RISK:** As §12.

### 14. Load test
- **STATUS:** FAIL (1 of 18 thresholds)
- **EVIDENCE:** k6 run 5; `load.k6.js` thresholds; `pg_stat_activity` sampler
- **TEST:** 60 s, 115 VUs, ~1,721 req/s, 112,182 requests
- **RESULT:**
  - 0 errors in every flow; 17/18 thresholds pass.
  - **Heartbeat p95 = 678 ms, above the 400 ms threshold.** Heartbeat alone is 118 ms, so this is contention on one Bun process.
  - Database: max 6 connections, 0 lock waits. Server memory peaked at 538 MB.
- **REMAINING RISK:**
  - Heartbeat latency under mixed load.
  - Single-node test on a dev laptop; no production hardware.

### 15. Race conditions
- **STATUS:** PASS
- **EVIDENCE:** `release-concurrency`, `p0-financial-races`, `money-matrix`
- **TEST:** wallet ‖ wallet, accept ‖ accept ×4, withdrawal races
- **RESULT:** Exactly-once in every case.
- **REMAINING RISK:** Races are verified in-process against one Postgres, not multi-node.

### 16. Split refund
- **STATUS:** PASS
- **EVIDENCE:** 10× (`split-refund` + `wallet-funded-refund`) under concurrent full-suite load
- **TEST:** 150/150
- **RESULT:** The earlier single failure did not reproduce.
- **REMAINING RISK:** That earlier failure's cause is unproven. Auto-recovery stays gated off.

### 17. Test timeouts
- **STATUS:** PASS (after fix)
- **EVIDENCE:** 2-file probe
- **TEST:** probe
- **RESULT:**
  - bunfig `timeout` is ignored.
  - A preload `setDefaultTimeout` only covers the first file.
  - `--timeout 45000` is now used in `package.json`, every CI step and the runners. The first preload "fix" was found ineffective and reverted.
- **REMAINING RISK:** None known.

### 18. Database protection
- **STATUS:** PASS
- **EVIDENCE:** DDL-target guard, maintenance-target guard, prisma-base barrier, financial guard; setup drift gate
- **TEST:** suites in §24
- **RESULT:** Every write in this pass targeted homigo_test, homigo_mtest or scratch DBs. homigo_db was read only.
- **REMAINING RISK:** Dev servers still run schedulers on homigo_db by design.

### 19. Service catalogue
- **STATUS:** PASS
- **EVIDENCE:** read-only catalogue audit
- **TEST:** taxonomy ↔ backend binding, pricing, config, provider coverage
- **RESULT:** 0 code defects. 24 taxonomy leaves are unbound and show "Coming soon" by design. All 30 live services lack a materials/equipment policy (content).
- **REMAINING RISK:** Content gaps (ops).

### 20. API authorization (IDOR / RBAC)
- **STATUS:** PASS
- **EVIDENCE:** `release-idor-rbac.integration.test.ts` 14/14
- **TEST:** customer-vs-customer, partner-vs-partner from actionable states (with a positive control), role, deactivated account, demoted admin
- **RESULT:** Every attack was refused and no row moved. The first version had 3 vacuous cases; the review caught them and they were fixed.
- **REMAINING RISK:** Coverage is the listed endpoints, not every route.

### 21. Observability
- **STATUS:** BLOCKED (external delivery)
- **EVIDENCE:** `/health`, `/ready`, `/metrics` (344 families); Prometheus → Alertmanager
- **TEST:** live probe
- **RESULT:** The internal pipeline works: a real target-down alert fired and is active in Alertmanager. Slack/pager/Sentry delivery needs credentials.
- **REMAINING RISK:** Nobody is paged in production.

### 22. Failure recovery
- **STATUS:** PASS (suite level)
- **EVIDENCE:** chaos, failure-recovery, refund-recovery, event-failure, outbox and redis-lock suites in §24
- **TEST:** 9 suites
- **RESULT:** All pass.
- **REMAINING RISK:** Live infrastructure chaos (killing Postgres/Redis) was not repeated, because it would disrupt the shared dev stack.

### 23. Backup and restore
- **STATUS:** PASS (local rehearsal) · BLOCKED (production)
- **EVIDENCE:** `pg_dump` of homigo_db (6 s, 65 MB, sha256 recorded) → restore into a scratch DB (11 s)
- **TEST:** exact row counts of 216 tables; ledger/wallet/payment totals; trigger/function/index/constraint/migration counts; drift check
- **RESULT:** Everything identical. The scratch DB was dropped.
- **REMAINING RISK:** No off-host storage, PITR/WAL or production rehearsal.

### 24. Final regression
- **STATUS:** PASS
- **EVIDENCE:** runner scripts; logs in `%TEMP%/suite-h*.log`; no retries (`--retry` never passed)
- **TEST:** H1 clean env · H2 forward · H3 reversed · H4 migrations-only DB
- **RESULT:** H1 (clean env) 2564/0 · H2 2564/0 · H3 (reversed) 2564/0 · H4 (DB built only from 121 migrations) 2562/2. Every run also passed the inject suites (6/0 and 7/0). Earlier in this pass the clean-env run failed 64; fixed in §26.
- **REMAINING RISK:** The 2 maintenance-guard cases hard-code the DB name `homigo_test`, so they cannot run on H4's differently named DB.

### 25. Fresh re-audit
- **STATUS:** PASS
- **EVIDENCE:** independent reviewer (unanchored, read-only)
- **TEST:** code review of every change in this pass
- **RESULT:** 7 findings.
  - Fixed: phone-redaction under-masking (a privacy regression I had introduced), vacuous IDOR cases, forecast fallback mislabelled hourly/weekly, BigQuery opt-in via ambient ADC, a test env leak, and a test with no cleanup.
  - Not changed: the index DROP CONSTRAINT case, which is correct parity.
- **REMAINING RISK:** Log `message` strings are not scrubbed (event names by convention).

### 26. Schema parity (migrations ↔ test ↔ dev)
- **STATUS:** PASS (code) · owner action on dev
- **EVIDENCE:** `docs/schema-parity-report.md`
- **TEST:** `migrate deploy` of all migrations into an empty DB, then the full suite on it; drift check over 2,915 fields
- **RESULT:**
  - Test-DB build defects fixed. They had caused 64 failures on a clean build.
  - The chargeback enum mismatch that would break production filters is fixed by migration `20260920100000`.
  - **Dev homigo_db is missing migration `20260916110000`: every `RefundRequest` read throws P2022.**
- **REMAINING RISK:** Dev history hygiene and dev-only objects need owner decisions.

### 27. Third-party egress from test runtimes
- **STATUS:** PASS (after fix) · owner action
- **EVIDENCE:** netstat egress witness on `bun test` PIDs (self-tested)
- **TEST:** witness across full runs
- **RESULT:**
  - The witness caught api.twilio.com and maps.googleapis.com. The Twilio account had exhausted its 50/day limit, so **real SMS were sent to fixture numbers earlier today**.
  - Barriers were added for Twilio (3 clients), Maps, BigQuery and OpenWeather.
  - Final witness across H1–H4: **0 non-local connections**.
- **REMAINING RISK:** The owner should review Twilio message logs for 2026-09-20.

---

## Final decision: **NOT YET ENTERPRISE RELEASE READY**

The engineering gates that can be closed in code are closed, with runtime evidence. The following are
open, and none of them can honestly be converted to PASS from this environment:

- business decisions D1–D4;
- real-device mobile testing;
- production backup/PITR;
- external alert delivery;
- the Float-money migration;
- the web refresh-token cookie migration;
- the heartbeat p95 load threshold;
- owner remediation of dev data (C1/C2) and the dev schema (P2022).

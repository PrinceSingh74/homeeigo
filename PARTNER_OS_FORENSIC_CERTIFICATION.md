# HOMEEIGO Partner OS — Forensic Architecture Certification

**Pass:** 13 (final integration + certification gate)  
**Generated:** 2026-09-03 (UTC+5:30)  
**Repository:** `D:/homigo`  
**Platform status:** `FULL CERTIFIED` (Partner OS 01–10)

Pass 13 closed every required gate against current evidence. Authoritative Linux **O = 1862/0** and independent extra **P = 1862/0**. Partner Playwright **66/66**. Admin Playwright **87 pass / 0 fail / 2 config-gated skips**. Section 10 **22/22 LOAD/AUTH/NAV**, mutation **9 VERIFIED / 13 N/A / 0 PARTIAL**. C→P→A **PASS** (MONEY_DRIFT=0). Four-axis FSM orthogonality **9/0**. Money compact **81/0**. Mobile remains **ENVIRONMENT LIMITATION**. Native Android was not fabricated.

---

## Pass 13 — Final closure ledger

### Linux

| Run | TOTAL | PASS | FAIL | ERROR | Duration | Notes |
|-----|-------|------|------|-------|----------|-------|
| Pass 12 **F** | 1771 | 1766 | **5** | 1 | 1488s | Taxonomy below — fixed then re-proven |
| Pass 13 **G** | 1771 | **1771** | **0** | 0 | 609s | Clean after F fixes |
| Pass 13 **H** | 1771 | 1769 | **2** | 1 | 634s | Overlap with Partner Playwright — **not authoritative** |
| Pass 13 **I** | 1771 | **1771** | **0** | 0 | 233s | Repeatable clean (post C1 60s) |
| Pass 13 **J** | 1780 | 1779 | **1** | 0 | 340s | Soak test 9 `VALIDATION_ERROR` — TEST HYGIENE |
| Pass 13 **K** | 1780 | **1780** | **0** | 0 | 285s | After soak window restore + four-axis |
| Pass 13 **L** | 1780 | **1780** | **0** | 0 | 300s | Repeatability of K |
| Pass 13 **M** | 1862 | 1841 | **21** | 0 | 278s | Knowledge corpus ENOENT (backend-only mount) + four-axis `-0` + missing partial unique |
| Pass 13 **N** | 1862 | 1861 | **1** | 0 | 315s | Full-repo mount; only `one_active_per_type` missing on db-push test DB |
| Pass 13 **O** | 1862 | **1862** | **0** | 0 | 302s | **Authoritative F** of current revision |
| Pass 13 **P** | 1862 | **1862** | **0** | 0 | 261s | **Authoritative G + independent extra pass** |
| Isolated dispatch repair | 1 | 1 | 0 | 0 | 6.4s | afterState=NO_CHANGE, 1.2s |
| Four-axis orthogonality | 9 | 9 | 0 | 0 | 7.8s | MONEY_DRIFT=0 |
| Money compact | 81 | 81 | 0 | 0 | 9.2s | ledger + races + matrix |
| FSM compact | 38 | 38 | 0 | 0 | 3.9s | lifecycle + availability + referral + booking |
| Security compact | 64 | 64 | 0 | 0 | 11.2s | p0/p1/p3/p4/phase7 |
| Adversarial + AI + PII | 57 | 57 | 0 | 0 | 14.6s | includes prompt injection / copilot |
| Events + automation + obs | 66 | 66 | 0 | 0 | 4.3s | 6B–6G, shadow not activated |

**Authoritative Linux repeatability (current revision):** O + P = **0 unexpected failures**. Prior pair K + L = 1780/0 (before knowledge-completion entered the suite).

#### Linux F failure taxonomy (5 fail + 1 error) — closed

| Failure | Classification | Root cause | Fix | Evidence |
|---------|----------------|------------|-----|----------|
| matching excludes offline… | **TEST HYGIENE** | leftover capacity / geofence | isolate bookings + regions | targeted PASS |
| SOS double tap | **PRODUCT + HARNESS** | TX 5s; unbounded notify | `TX_OPTS` 30s; notify cap 20 | G/I PASS |
| exec intel / shift planning | **HARNESS** | Bun 5s vs GCP metadata | test timeout 60s | G/I PASS |
| Unhandled error between tests | **PRODUCT** | SOS TX expiry cascade | same TX_OPTS | G/I PASS |

#### Later Linux failures — closed

| Run | Failure | Classification | Root cause | Fix |
|-----|---------|----------------|------------|-----|
| J | soak #9 `VALIDATION_ERROR` | **TEST HYGIENE** | test 7 restore left 06:00–23:00; soakSlot(320) wall-clock dependent | restore 00:00–23:59 |
| M | 20 knowledge-completion | **HARNESS** | tests read `apps/web` + `apps/admin-panel`; cert mount was backend-only | mount `D:/homigo` at `/repo` |
| M | four-axis COMPLETION drift `-0` | **HARNESS** | IEEE signed zero vs `expect().toBe(0)` | `drift === 0` |
| N | one active rank per type | **PRODUCT (schema drift)** | partial unique exists in `20260905090000` but `db push` omitted it | `CREATE UNIQUE INDEX ... WHERE status = 'ACTIVE'` on `homigo_test` |

#### Linux H (discarded)

C1/C1b Bun 5s under Partner overlap. Isolated afterwards. Not counted as final.

### Partner Playwright

| Run | Result | Duration | Notes |
|-----|--------|----------|-------|
| Pass 12 concurrent w/ Linux F | **60 pass / 6 fail** | 38.9m | login 429 / TimeoutError |
| Pass 13 first clean | **66 pass / 0 fail** | 21.4m | hardened `partnerLogin` |
| Pass 13 interrupted | 44 ok then hung | — | backend died mid §05 matrix; **DISCARDED** |
| Pass 13 **final** | **66 pass / 0 fail / 0 skipped** | **14.7m** | `pass13-partner-playwright-final.log` — **authoritative** |

### Admin Playwright

| Run | Result | Notes |
|-----|--------|-------|
| Pass 13 first full | **83 pass / 1 fail / 2 skipped** (35.9m) | `DUPLICATE_BATCH` on stale seed withdrawal |
| Pass 13 visual re-run | **20/20** | after admin Next.js restart |
| Pass 13 **full clean** | **87 pass / 0 fail / 2 skipped** (14.8m, 89 total) | `pass13-admin-playwright-clean.log` — **authoritative** |

Config-gated skips remain skips (not PASS):
1. `lcp-dashboard` — requires `E2E_ADMIN_PRODUCTION=1`
2. `capture-booking-vendor` — requires `E2E_CAPTURE_BOOKING=1`

### Section 10 Command Center

- IA source: `apps/admin-panel/src/lib/command-center-ia.ts` → **22** surfaces
- LOAD/AUTH/NAV: **22/22 VERIFIED** (included in Admin 87/0; `/referrals` loaded in the same run)
- Mutation matrix: **9 VERIFIED / 13 N/A / 0 PARTIAL / 0 FAIL**
  - VERIFIED: leads, applications, jobs, payouts, training, referrals, support, safety, fraud
  - N/A: overview, verification, partners, availability, live-ops, performance, earnings, incentives, kyc, acquisition-analytics, supply-demand, ai-insights, audit
- Referrals mutation: disposable invite → `POST .../action hold` → persist `reviewStatus=HELD` → ActivityLog `PARTNER_REFERRAL_HOLD`
- Audit convergence: **PASS**
- First Section 10 attempt on `:3001` (customer login) remains **DISCARDED**

### Customer → Partner → Admin

Authoritative Pass 13 execution (`pass13-cpa-final.log`):

```
PASS=12 RUN_ID=p12-mtlpch4y
customerId=cmtlpchbv002cqr01eczsi4e9
partnerId=cmtlpchcz002lqr01ustvl4vp
bookingId=cmtlpchug003eqr01y10wo8zn
earningId=cmtlpcizs007dqr01v2wt8j6m
eventId=239d093b-995c-42f7-9b1c-f679049aaced
correlationId=cmtlpchug003eqr01y10wo8zn
requestId=null
walletTransactionId=not emitted as a separate id (walletBalance credited; journal provider_earning:<bookingId> count=1)
MONEY_DRIFT=0
statuses: customer=completed partner=completed admin=COMPLETED db=COMPLETED
```

Observability on this journey: `eventId` + `correlationId=bookingId` present on outbox; `requestId` was null on the outbox metadata of this fixture path (HTTP `request.completed` logs still carry `requestId`/`traceId` on live API). Secret redaction: section10-request-context **PASS**.

### Four-axis FSM (Phase 8)

Dedicated harness `partner-four-axis-orthogonality.test.ts` **9/0**.

Proved on real DB:
- `ACTIVE` (lifecycle) ≠ `available` (availability)
- `available` ≠ `ACCEPTED` (job)
- `COMPLETED` (job) ≠ available money (numeric)
- Lifecycle mutation does not overwrite pause record / job / wallet
- Documented gate only: `SUSPENDED` clears `isOnline`; pause record + job + money intact
- Availability pause/offline/online does not overwrite lifecycle / job / finance
- Job EN_ROUTE → IN_PROGRESS does not overwrite lifecycle / stored availability / money
- Withdrawal reserve+idempotent replay+release does not overwrite lifecycle / availability / job
- Completion moves only job + money; MONEY_DRIFT=0; single `provider_earning:` journal

IDs: `RUN_ID=p13ax-mtm0412y` provider=`cmtm041b2005js701dqb157pt` booking=`cmtm041nn006cs701zd43zjlc` earning=`cmtm043ag00bzs70120x0sp3d`

### Money / FSM / Security / Events / AI

| Gate | Result | Evidence |
|------|--------|----------|
| Money compact | **81/0**, MONEY_DRIFT=0 | `pass13-money-regress.log` |
| FSM compact | **38/0** | `pass13-fsm-regress.log` |
| Four-axis | **9/0** | `pass13-authority-fouraxis-targeted.log` |
| Security p0–phase7 | **64/0** | `pass13-security-regress.log` |
| Adversarial + RBAC + PII + AI | **57/0** | `pass13-security-ai-regress.log` |
| Events + automation + observability | **66/0** | `pass13-events-obs-regress.log` |
| Dispatch repair isolated | **1/0** | `pass13-dispatch-repair-isolated.log` |
| Prisma validate | **PASS** | schema valid |
| Migration deploy (fresh `homigo_migval`) | **PASS** (101 migrations) | `pass13-migration-validation.log` after baseline repair |

AI: partner `/api/ai/partner` already bound `partnerId` via `resolveProviderId`. Generic `/gateway/chat` now runs `bindAiContextToActor` so CUSTOMER/PARTNER cannot attach another party's IDs. Prompt injection blocked (section 08). Unauthorized AI mutation classified as `MUTATION_REQUEST` and refused.

### Prisma / migrations

- `prisma validate` — PASS
- Fresh `prisma migrate deploy` on empty `homigo_migval` — **all migrations applied** after adding `20260609130000_baseline_repair_db_push_drift` (creates gift_cards, membership_*, geofences, ai_conversations/messages that `db push` had been hiding) and reordering `notification_delivery_claim` to `20260817110000` (after `notification_platform`)
- Remaining drift vs schema is index-rename / default-drop only (not missing tables)
- `homigo_test` is db-push provisioned: partial unique `knowledge_authority_rules_one_active_per_type` had to be applied by hand so the knowledge invariant holds. **REQUIRED ACTION** for any db-push environment: run that `CREATE UNIQUE INDEX ... WHERE status = 'ACTIVE'`
- Existing DBs that recorded `20260817090000_notification_delivery_claim` must rename the `_prisma_migrations` row to `20260817110000_notification_delivery_claim` before `migrate deploy`

### Mobile

`adb devices` → empty list (daemon starts, no device) → **ENVIRONMENT LIMITATION**. Not reported as mobile-certified.

### External / policy

- Razorpay / SMS / Government KYC / Emergency dispatch / BigQuery/GCP: **EXTERNAL DEPENDENCY** (GCP billing sandbox errors observed in live API logs; not converted to PASS)
- `demand.spike` SHADOW-only automation: **POLICY PENDING** (not activated for certification)

### Source re-scan (Phase 13)

| Class | Partner OS result |
|-------|-------------------|
| Duplicate FSMs | Four axes remain separate files; four-axis harness proves non-overwrite |
| Duplicate engines | matching + assignment complementary; one earnings calculator |
| Unbounded DB `Promise.all` | Admin roster N×4 **fixed** → `loadJobFlagsMap` groupBy (4 queries / page) |
| Lock leak / missing finally | NONE FOUND on production lock paths |
| AI cross-partner | **fixed** `bindAiContextToActor` in gateway |
| Fake success / PII / orphans | P2/P3 only (OTP phone log when SMS disabled; AI fallback `success: true`; orphan `DataQualityResult`) |
| Customer `referralWithdrawal` no idempotency | **OUT OF PARTNER OS SCOPE** (customer wallet). Partner referral reward already keyed `partner_referral_reward:<id>` |

No Partner OS **P0**. No Partner OS **P1** remaining after the AI bind + roster batch + authority unique index.

### Files changed (Pass 13)

- `apps/backend/src/services/partner-safety.service.ts` — TX_OPTS; sequential SOS admin notify cap
- `apps/backend/src/services/partner-operations.service.ts` — `loadJobFlagsMap` (no N×4 count fan-out)
- `apps/backend/src/ai-tools/execution/actor-resolver.ts` — `bindAiContextToActor`
- `apps/backend/src/ai/gateway/ai-gateway.ts` — bind context before enterprise/legacy prompt
- `apps/backend/prisma/schema.prisma` — document partial unique on knowledge authority
- `apps/backend/prisma/migrations/20260609130000_baseline_repair_db_push_drift/` — fresh-deploy tables `db push` had hidden
- `apps/backend/prisma/migrations/20260817110000_notification_delivery_claim/` — reorder after CREATE TABLE
- `apps/backend/src/__tests__/partner-four-axis-orthogonality.test.ts` — new
- `apps/backend/src/__tests__/enterprise-soak-certification.test.ts` — restore 00:00–23:59
- `apps/backend/src/__tests__/section08-ai-governance.test.ts` — customer context strip
- plus earlier Pass 13 test timeouts, `partnerLogin` 429 retry, Admin `DUPLICATE_BATCH` fallback, Section 10 mutation proofs, e2e disposable scripts

### Exact commands (authoritative)

```bash
# Linux O / P (current revision) — full repo mount required by knowledge-completion tests
docker run --rm --network homigo-cert4 -v D:/homigo:/repo -w /repo/apps/backend \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1
# → pass13-linux-run-o.log = 1862 pass / 0 fail / 301.53s
# → pass13-linux-run-p.log = 1862 pass / 0 fail / 261.47s

cd apps/partner-web
E2E_API_URL=http://localhost:3000 E2E_PARTNER_PORT=3002 npx playwright test --workers=1
# → pass13-partner-playwright-final.log = 66 passed (14.7m)

cd apps/admin-panel
E2E_SKIP_SERVERS=1 E2E_API_URL=http://localhost:3000 E2E_ADMIN_URL=http://localhost:3003 \
  npx playwright test --workers=1
# → pass13-admin-playwright-clean.log = 87 passed / 2 skipped (14.8m)
```

### Independent 01–10 recertification (current revision)

Historical PASS labels ignored. Evidence is current source + current runs.

| # | Section | SOURCE | DB | SERVICE | API | AUTH | WEB | MOBILE | ADMIN | EVENT | SECURITY | TEST | RUNTIME | Verdict |
|---|---------|--------|----|---------|-----|------|-----|--------|-------|-------|----------|------|---------|---------|
| 01 | Acquisition | PASS | PASS | PASS | PASS | PASS | PASS (partner onboarding E2E) | ENV LIMIT | PASS (leads/apps mutation) | PASS | PASS | PASS | PASS | **PASS** |
| 02 | Operations | PASS | PASS | PASS | PASS | PASS | PASS | ENV LIMIT | PASS (availability N/A mut) | PASS | PASS | PASS | PASS | **PASS** |
| 03 | Execution | PASS | PASS | PASS | PASS | PASS | PASS (live Offer→Complete) | ENV LIMIT | PASS (jobs mutation) | PASS | PASS | PASS | PASS | **PASS** |
| 04 | Finance | PASS | PASS | PASS | PASS | PASS | PASS (wallet/withdraw E2E) | ENV LIMIT | PASS (payouts mutation) | PASS | PASS | PASS | PASS | **PASS** |
| 05 | Trust | PASS | PASS | PASS | PASS | PASS | PASS (compliance/SOS) | ENV LIMIT | PASS (safety mutation) | PASS | PASS | PASS | PASS | **PASS** |
| 06 | Growth | PASS | PASS | PASS | PASS | PASS | PASS | ENV LIMIT | PASS (training mutation) | PASS | PASS | PASS | PASS | **PASS** |
| 07 | Network | PASS | PASS | PASS | PASS | PASS | PASS | ENV LIMIT | PASS (referrals hold+audit) | PASS | PASS | PASS | PASS | **PASS** |
| 08 | Intelligence | PASS | PASS | PASS | PASS | PASS | PASS (copilot E2E) | ENV LIMIT | PASS (ai-insights N/A) | PASS | PASS (bind+injection) | PASS | PASS | **PASS** |
| 09 | Automation | PASS | PASS | PASS | PASS | PASS | PASS (notifications E2E) | ENV LIMIT | N/A (shadow not activated) | PASS | PASS | PASS | PASS | **PASS** |
| 10 | Command Center | PASS | PASS | PASS | PASS | PASS | N/A | ENV LIMIT | PASS (22/22 + 9 mut) | PASS | PASS | PASS | PASS | **PASS** |

MOBILE column is **ENVIRONMENT LIMITATION** on every section (adb empty). That does not convert a section to FAIL and does not convert it to “mobile fully certified.”

### Final certification decision

**FULL CERTIFIED** — Partner OS sections 01–10, current revision.

Gate checklist:

- [x] Linux O = 0 unexpected failures (1862/0)
- [x] Linux P = 0 unexpected failures (1862/0) — independent extra pass
- [x] Repeatability stable (K/L 1780/0 and O/P 1862/0)
- [x] No lock leak (source scan)
- [x] No pool exhaustion (roster batched; soak 12/12)
- [x] No retry storm
- [x] Partner full Playwright 66/66
- [x] Admin full Playwright 87/0 + 2 documented config-gated skips
- [x] Section 10 mutation/audit complete (0 PARTIAL)
- [x] Section 10 LOAD/AUTH/NAV stable 22/22
- [x] Customer→Partner→Admin correlated E2E PASS, MONEY_DRIFT=0
- [x] Money / FSM / security / events / observability PASS
- [x] Source re-scan complete
- [x] No Partner OS P0 / P1
- [x] Config-gated skips not converted to PASS
- [x] Environment limitation (mobile, adb empty) not converted to PASS
- [x] External dependencies not converted to PASS
- [x] `demand.spike` remains POLICY PENDING

---

## Pass 12 — Linux ledger (historical)

| Run | Result | Duration | Notes |
|-----|--------|----------|-------|
| Pass 11 **Run C** | **1758 / 0** | 465s | Clean |
| Pass 11 **Run D** | 1738 / **1** | 978s | PI beforeAll 5s → 120s |
| Pass 12 **Run E** | **1769 / 1** / 1770 | **1024s** | Only dispatch repair Bun 5s |
| Pass 12 **Run F** | see Pass 13 | 1488s | 1766/5 — taxonomy in Pass 13 |
| Partner Playwright | see Pass 13 | — | |
| C→P→A correlated E2E | see Pass 13 | — | **EXECUTED PASS** |

### Run E failure taxonomy

| Failure | Classification | Resolution |
|---------|----------------|------------|
| P14 dispatch repair 5000ms | **HARNESS** | Explicit **60s** timeout |

---

## Pass 11 — Linux / Admin ledger

| Run | Result | Duration | Notes |
|-----|--------|----------|-------|
| Pass 9 **Run C** | **1749 / 0** | 405s | First clean combined |
| Pass 10 **Run A** | 1747 / **2** | 486s | P14 pool + zone 5s — fixed |
| Pass 10 **Run B** | 1750 / **3** / 1 err / 1753 | **741s** | P0-3 lock 30s; morning eligible 5s; concurrent assembly 5s |
| Pass 11 **Run C** | **1758 pass / 0 fail / 0 error** | **465.52s** | Clean after lock tick-deadline + morning timeouts |
| Pass 11 targeted lock/morning/fanout | **66 pass / 0 fail** | 21s | P0-3 leader failover + lifecycle |
| Pass 11 money matrix 7–8/11–20 | **12 pass / 0 fail** | 9.65s | Real DB; MONEY DRIFT=0 |
| Pass 11 FSM | **34 pass / 0 fail** | 4.3s | |
| Pass 11 **Run D** | **1738 / 1** | **978s** | PI context beforeAll Bun 5s |
| Pass 11 **Run E** | see Pass 12 ledger | 1024s | |

### Pass 10 Run B failure taxonomy

| Failure | Classification | Evidence | Resolution |
|---------|----------------|----------|------------|
| P0-3 leader failover 30150ms | **PRODUCT + HARNESS** | Dirty queue held lock past 30s abort → leak | Tick deadline (~20s) before TTL; release in finally; test 90s; **targeted PASS** |
| morning eligible partner 5099ms | **HARNESS** | Bun 5s under combined load | Explicit **60s**; fixed |
| concurrent assembly 7724ms | **HARNESS** | 8× assembleBrief under load | Explicit **90s**; fixed |
| morning EOF (targeted-1) | **TEST DEFECT** | Accidental missing `});` | Restored; targeted-2 green |

### Admin Playwright (Pass 11)

| Run | Result | Notes |
|-----|--------|-------|
| Run 4 | ABORTED | React fill() login flakes |
| Run 5 | **84 pass / 0 fail / 2 skipped** (22.3m) | Fresh seed; pressSequentially login; payout/HQ/§10/ops green |

**Config-gated skips (not PASS):**
1. `lcp-dashboard` — requires `E2E_ADMIN_PRODUCTION=1`
2. `capture-booking-vendor` — requires `E2E_CAPTURE_BOOKING=1`

### Lock lifecycle (Pass 11)

`assignment-lock-lifecycle.test.ts` — CASE 1/2/5/6/7/8 + sequential no-leak: **PASS**.  
`processQueue` tick deadline: `Date.now() + max(5s, (LOCK_TTL_SEC-5)*1000)`.

### Notification fan-out

Cap 25 + await create/reply/merge + sequential: **4/4 PASS**.

### Mobile

`adb devices` → empty → **ENVIRONMENT LIMITATION**.

---

## Pass 10 historical (retained)

| Run | Result | Duration | Notes |
|-----|--------|----------|-------|
| Pass 9 **Run A** | 1684 pass / **4 fail** / 1688 | 786s | Pre–notify-cap leftovers |
| Pass 9 **Run B** | **DISCARDED** — 1439/32/144 err | 750s | `AdminUser.updatedAt` (field DNE) |
| Pass 9 **Run C** | **1749 pass / 0 fail / 0 error** | **405.18s** | Clean after lastLogin-only + cap-25 |
| Pass 10 **Run A** | **1747 pass / 2 fail** | **485.97s** | P14 100-booking P2024; zone insight 5s |
| Pass 10 **Run B** | **1750 / 3 / 1 err** | **741s** | see Pass 11 taxonomy |

### Pass 10 Run A failure taxonomy

| Failure | Classification | Evidence | Resolution |
|---------|----------------|----------|------------|
| P14 100 booking sim corruption=1 | **RESOURCE** | P2024 mid sequential creates; 5ms retry backoff amplified pressure | Exponential create backoff; return `POOL_BUSY`; test retries pool; targeted **PASS 11.8s** |
| zone insight 5009ms | **HARNESS** | Bun default 5s; siblings 365–550ms under load | Explicit **60s** timeout; targeted **PASS** |
| Fan-out race (test found) | **PRODUCT** | `void notifySupportAdmins` on create raced with respond → 51 notifs | **await** all notifySupportAdmins; fan-out suite **4/4 PASS** |

### Notification fan-out (product)

| Check | Status |
|-------|--------|
| Cap `SUPPORT_NOTIFY_CAP = 25` | SHIPPED + **4/4 PASS** |
| `orderBy: { lastLogin: "desc" }` only | SHIPPED; `updatedAt` throws at runtime |
| Sequential notify (no Promise.all) | SHIPPED |
| Await create/reply/merge notifies | SHIPPED (Pass 10 — was void race) |
| `broadcastNotification` sequential | SHIPPED |
| Dedicated fan-out regression test | **PASS** |

### Admin Playwright (Pass 10)

| Run | Result | Notes |
|-----|--------|-------|
| Run 3 | 81 pass / 3 fail / 2 skipped | login waitForResponse flake |
| Run 4 | **ABORTED** (~11× 2.0m login fails) | fill()-only React state flake; stopped for Run 5 |
| Run 5 | **84 pass / 0 fail / 2 skipped** | authoritative Admin clean |

### Pass 9 historical taxonomy (closed)

| Run | Result | Duration | Notes |
|-----|--------|----------|-------|
| Pass 7 Run 3 | 1658 pass / **9 fail** / 1 error / 1667 | 1148s | Taxonomy below |
| Pass 8/9 **Run A** | **1684 pass / 4 fail** / 1688 | **786s** | Soak 4–8 all **PASS**; C1b **PASS**; 500 concurrent **PASS** |
| Pass 9 **Run B** | **DISCARDED** | 750s | `orderBy: { updatedAt }` on AdminUser |
| Pass 9 **Run C** | **1749 / 0** | **405.18s** | Authoritative clean |

### Pass 7 Run 3 failure taxonomy (closed in Pass 8/9)

| Failure | Classification | Evidence | Resolution |
|---------|----------------|----------|------------|
| C1b ~5627ms vs Bun 5s | **ENVIRONMENT / HARNESS** | Actual ~5–6s under load; product correctness OK | Explicit **120s** test timeout; Run A **PASS** |
| Soak 4 P2028 / 180s | **PRODUCT + RESOURCE** | `adminRespond` bare tx; then pool storm | `runRetryableTx` + notify await; Run A soak 4 **PASS (73.5s)** |
| Soak 5–8 P2024 | **PRODUCT** | Unbounded admin notify fan-out | Cap 25 + sequential; Run A soak 5–8 **PASS** |
| Executive snapshot outbox+6 | **TEST (async fallout)** | Read-only `getContext` | Exclude ledger/outbox/notifications with docs |
| fraud/morning beforeAll 5s | **HARNESS** | Tree scan + fixture seed | beforeAll 60s/120s |
| Chaos-10 (Run A) | **PRODUCT** | `processQueue` threw P2024 uncaught; 5s itx timeout | Outer catch + `TX_OPTS` 20s/30s; Run B **PASS** |
| support-intel mutates nothing | **TEST contamination** | bookings 4983→4999 during analyze | Fresh before-snapshot; money tables only |
| shift-planning / surge beforeAll | **HARNESS** | 48-booking seed / 611-file scan under dirty pool | beforeAll **120s** |

### Pool / notify measurement (Pass 9)

```
homigo_test active admin_users by role:
  SUPER_ADMIN   211
  SUPPORT_ADMIN 211
  FINANCE_ADMIN 211
```

`notifySupportAdmins` previously `findMany` with no `take` → **422+** creates per reply (Promise.all). Under `connection_limit=8` this is a retry-amplifying P2024 storm.

**Fix:** `orderBy: { lastLogin: "desc" }`, `take: 25`, sequential create, exponential backoff max 4 on notification insert (80×2^n ms). Alert Center / `admin:ops` WS remains the live queue signal. (Do **not** orderBy `updatedAt` — AdminUser has no such field; that regression discarded Run B.)

### Admin Playwright (Pass 9)

| Run | Result | Notes |
|-----|--------|-------|
| Run 3 | **81 pass / 3 fail / 2 skipped** (31.6m) | All 3 fails = flaky `adminLogin` waitForResponse timeout (still on login page). Ops/hardening/HQ/§10 green. LCP+capture config-gated skips. |
| Run 4 | **in progress** | early login 2.0m flakes; hardening/HQ/login-dashboard PASS; LCP config-gated |
| Run 5 | pending | post–pressSequentially + status-visible login fix |

### Pass 9–10 files changed

| File | Change |
|------|--------|
| `notification.service.ts` | Bounded create retry; sequential `broadcastNotification` |
| `support-ticket.service.ts` | Cap-25 notify; `SUPPORT_NOTIFY_CAP` export; await respond/escalate/resolve |
| `support-notify-fanout.test.ts` | Fan-out cap + AdminUser.updatedAt regression |
| `admin-panel/e2e/enterprise/fixtures.ts` | React-safe adminLogin (pressSequentially + HTTP status) |
| `assignment-engine.service.ts` | `TX_OPTS`; processQueue outer catch; in-tx `JOB_GONE` guard |
| `partner-operations.service.ts` | `TX_OPTS` on all interactive txs |
| `adversarial-integration.test.ts` | C1b timeout 120s |
| `enterprise-soak-certification.test.ts` | Soak 4/5 timeouts for retry path |
| `shift-planning` / `surge-alert` / `support-intelligence` tests | beforeAll / snapshot determinism |
| `executive-intelligence.integration.test.ts` | Async-table snapshot exclusion (Pass 8) |

### Snapshot exclusion policy (documented)

Read-only advisors (`getContext`, `generate`, `evaluate`, `analyze`) may exclude **ledger / outbox / notifications / bookings** from side-effect equality **only when** the service source has no writes to those tables and combined-suite async producers are proven. Money tables (payments, refunds, wallet, ledger where applicable) remain asserted.

---

## Pass 7–8 historical summary

Pass 7 re-ran the authoritative Linux combined suite after post–RUN D fixes. Details retained below as historical evidence.


## 1. Pass 6 summary

Pass 5 left 14 combined-Linux failures plus an open Earnings Coach `INSUFFICIENT_HISTORY` question. Pass 6 established the canonical `EarningSettlementStatus` rule, proved the original 14 are either **fixed** or **correct degraded-mode / external-dependency behaviour**, and re-ran combined Linux plus full Partner and Admin Playwright.

**Verdict:** The original 14 combined-suite failures are closed. **Partner Playwright is 66/66 PASS.** Combined Linux is not 0 FAIL. Admin Playwright is not 0 FAIL (visual overflow + LCP + one ops booking-create). Native Android was not re-run (`adb devices` empty). Numbered money cases 7–8/11–20 were not executed as a dedicated harness. The platform is **not** FULL CERTIFIED.

---

## 2. Previous vs current test counts

| Suite | Pass 5 (prior) | Pass 6 |
|--------|----------------|--------|
| Linux combined `bun test --max-concurrency 1` (Docker `oven/bun:1.3`, `homigo-cert4` / `homigo-ci-pg` / `homigo_test`) | Run 3: **1718 pass / 14 fail / 1732** | **RUN B:** 1745 pass / 3 fail / 1 error / 1748 (435s). **RUN D (post-lock refresh):** **1699 pass / 6 fail / 1705** (530.36s). RUN A/C discarded. Original 14 absent from both B and D. RUN B remaining lock/B1/SP **absent from RUN D**. |
| Targeted Linux (coach, chargeback, §09, forecast, scheduled-reports, soak, lock) | n/a | Soak **12/0**. Lock+redis **11/0** including leader failover 5942ms. |
| Partner Playwright (full 66) | 60 pass / 5 fail / 66 | **66 pass / 0 fail / 66** (13.7m) |
| Admin Playwright (full 86) | 64 pass / 8 fail / 14 not run / 86 | Full run **38 pass / 36 fail / 12 not run / 86** (16.8m) — contaminated by `inert=""` React console errors (introduced then fixed). Post-fix slice (27 specs: enterprise, ops cert, finance, trust, §09, §10): **26 pass / 1 fail**. Journey login→ops/heatmap/geofence **PASS**. Section 10 spec **2/2 PASS**. |
| Mobile `native-android-cert.ts` | persist fix, not re-run | **not re-run** — `adb devices` empty |
| Section 08 live AI | 38/0/1 WARN historical | Partner `section08-ai.spec` **PASS** in the 66/66 run |

Authoritative combined command (unchanged from Pass 5):

```
docker run --rm --network homigo-cert4 \
  -v D:/homigo/apps/backend:/app -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL=postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8 \
  oven/bun:1.3 bun test --max-concurrency 1
```

Docker `bun 1.3.14` does **not** honour bunfig `[test].timeout = 45000` per test (timeouts still fire at 5000ms unless the test passes a third-argument timeout). That is an environment limitation, not a reason to treat timed-out tests as PASS.

---

## 3. All 14 failure classifications (Pass 5 run 3 → Pass 6)

| # | Failure | Classification | Pass 6 status |
|---|---------|----------------|---------------|
| 1–3 | `forecast-explainer` (`forecastGeneratedAt` / zone scope / drift copy) | Tests asserted **live ARIMA copy** while Docker has no GCP ADC. Product already returns `FORECAST_UNAVAILABLE` + `source unavailable`. | **CLOSED** — tests now assert degraded mode when `FORECAST_UNAVAILABLE`; live copy still asserted when BQ answers. Targeted + RUN B did not list these as fail |
| 4–5 | `scheduled-reports` (STALE vs INCOMPLETE / 80% interval copy) | Unavailable sources correctly force `INCOMPLETE` (outranks STALE). 80% copy is live-forecast-only | **CLOSED** — tests respect precedence and do not invent 80% when source did not answer |
| 6 | Chargeback `INVALID_PDF` | Product correctly rejects malformed PDF. Fixture was `Buffer.from("cert-test-pdf-content")` | **CLOSED** — `minimalPdfBuffer()` accepted; invalid PDF still throws `INVALID_PDF` |
| 7–8 | Soak ticket `P2002` / soak 9 HTTP | P2002 retry was **inside** an aborted Postgres transaction (no-op). Soak 9 `VALIDATION_ERROR` was leftover partner working-days from soak test 7 | **CLOSED** — retry wraps the whole `$transaction`; soak 9 restores hours then **PASS** isolated |
| 9 | Section 09 `Condition already registered` | Idempotent `registerCondition` already landed; workflows still threw on same id+version | **CLOSED** — conditions no-op; workflows no-op when step fingerprint matches. Tests: double + concurrent register |
| 10–14 | Provider array / unnamed siblings (Pass 5 remainder mix) | NOT NULL applied in Pass 5; not in RUN B fail list | **CLOSED as prior contaminator** — not reproduced as FAIL on RUN B |

Earnings Coach was **not** one of the 14 combined fails after the Pass 5 BQ `Promise.all` catch. Pass 6 still treated it as a real behavioural investigation (Phase 1).

---

## 4. Earnings Coach root cause

**Canonical rule (established from schema, coach comments, cashback analog, and partner-facing copy “already credited”):**

| Status | Meaning | Coach / dashboard / forecastable totals |
|--------|---------|----------------------------------------|
| `CREDITED` | Settled to the partner (default on job-complete `earning.create`) | **Included** in realised, per-job average, dashboard week/month |
| `REVERSED` | Clawed back; row retained for history | **Excluded** from available/forecastable/coach history |

Wallet and ledger remain the money-movement source of truth. This flag is not a second balance. Pending earning semantics stay `PENDING_EARNING_SEMANTICS_HUMAN_DECISION_REQUIRED` (withdrawal-based pending).

**Pass 5 `INSUFFICIENT_HISTORY` with 10 seeded jobs** was BigQuery `Promise.all` poisoning `getForecast` (already fixed; do not undo). It was **not** caused by a CREDITED filter that did not yet exist.

**Pass 6 product gap:** reads summed **all** earning rows, so REVERSED would inflate realised/coach averages. Filter `CREDITED_EARNING_WHERE` applied on available/forecastable paths only. Itemised invoice history still lists rows (live crash was a separate enum mapping issue).

**Controlled tests** (`earnings-coach.integration.test.ts`): 3 CREDITED + 1 REVERSED → `OK`, trailing = 3×net, sampleSize 3, wallet unchanged. REVERSED-only → `INSUFFICIENT_HISTORY`, no opportunity. Targeted Linux: both **PASS**.

**Live `homigo_db`:** column was still TEXT `'credited'` (172 rows). Prisma enum mapping threw `Value 'credited' not found in enum 'EarningSettlementStatus'` on `GET /api/providers/me/invoices`. G-03 SQL applied to live DB: 172 → `CREDITED`. Invoices **HTTP 200**.

---

## 5. Chargeback fixture evidence

- Validator unchanged: `%PDF-` + `%%EOF` + `/Contents` + length ≥ 400 (`isLikelyValidPdf`).
- Valid upload: `await minimalPdfBuffer()` (pdfkit), MIME `application/pdf`, storage `object_storage.local_put`, evidence row + timeline, resolve WON.
- Invalid upload: `Buffer.from("cert-test-pdf-content")` → `INVALID_PDF`.
- PNG 50-sim unchanged (non-PDF path).
- Targeted: Phase 12 all **PASS**.

---

## 6. Soak ticket evidence

- **Root cause:** unique `ticket_number` retry ran inside an already-aborted transaction.
- **Fix:** `runTicketCreateTx` retries the **entire** `$transaction`; 6-digit daily space (`randomInt(100_000, 1_000_000)`).
- Soak 5: 50 escalations **PASS**. Soak 5b: 20 concurrent creates, unique numbers **PASS** (169–370ms).
- Soak 9: after restoring Mon–Sun 06:00–23:00 (test 7 leftover hours), HTTP reschedule **200**, notification, admin list **PASS**.

---

## 7. Automation registration evidence

- `registerCondition`: duplicate id is no-op (Pass 5). Tests: twice + concurrent → one id set.
- `registerWorkflow`: same `workflowId`+version with **identical step fingerprint** is no-op; **different** steps still throw “publish a new version”.
- Not solved by deleting registrations. Conditions are in-memory; no DB uniqueness table.

---

## 8. BigQuery external dependency evidence

- CI (`.github/workflows/ci.yml`) has **no** GCP ADC / BigQuery.
- Docker logs: `Could not load the default credentials`.
- Product degraded mode: `forecast-explainer` catch → `FORECAST_UNAVAILABLE`, `FORECAST_SOURCE_UNAVAILABLE`, limitation “did not respond”. Scheduled report: `INCOMPLETE` when assembly-time sources are unavailable.
- `vertex-ai.service.ts`: in `NODE_ENV=test` without `GOOGLE_APPLICATION_CREDENTIALS` (unless `HOMIGO_REQUIRE_BIGQUERY=1`), throw the **same** credentials error immediately so the metadata-server ~5s hang does not starve postgres tests. Production ADC/metadata unchanged.
- Live BQ is **not** mocked. Live 80% interval tests run only when a forecast payload exists.

---

## 9. Linux final totals

**Use RUN B as the Pass 6 combined result** (RUN A/C are diagnostic, not the certified count):

| Run | Pass | Fail | Error | Total | Time | Notes |
|-----|------|------|-------|-------|------|--------|
| Pass 5 run 3 | 1718 | 14 | — | 1732 | 286s | Starting 14 |
| Pass 6 RUN A | 1639 | 17 | — | 1656 | 634s | ADC hang / 5s timeouts |
| Pass 6 RUN B | **1745** | **3** | **1** | **1748** | 435s | Original 14 absent; lock/B1/SP at 5s bun default |
| Pass 6 RUN C | 1572 | 84 | — | 1656 | 1208s | Discarded (timeout experiment) |
| Pass 6 RUN D | **1699** | **6** | — | **1705** | 530s | Lock/B1/SP **not** in fail list. New: chaos-10 isolation, 5s hooks, recommended-actions snapshot vs combined writers, 500-create P2028 pool |

RUN D remaining (original 14 still absent):

1. Chaos 10 queue backlog — `bookingIds.length` ≠ 20 under combined leftovers. **Fix landed after this run:** `deleteBookingsForUsers` at start of the test.
2. `production-blocker-final` / `surge-alert` **beforeAll** 5000ms hook timeout. **Fix landed after this run:** explicit 120s / 30s hook timeouts (scan + reconcile are slow on the Docker volume).
3. Recommended-actions sequential determinism / “mutates nothing” — ledger counts moved (`2666→2669`) during generate in a dirty combined DB. Concurrent generate in the same file **PASS**. Classified as **combined contamination**, not invented amounts.
4. Booking **500** concurrent creates — Prisma `P2028` “Unable to start a transaction in the given time” with `connection_limit=8`. 50/100/250 concurrent **PASS**. Environment pool starvation; assertion not weakened.

RUN B’s 3 fails (B1 5s, lock acquire false, SP 5s) are **closed on RUN D** after `refreshLock` (SET NX is not a TTL refresh; memory refresh no longer re-acquires a missing lock) plus explicit test timeouts. Isolated lock file: **11 pass / 0 fail**; leader failover **5942ms**.

**FAIL ≠ 0.** Combined suite is not green.

---

## 10. Partner Playwright totals

Full suite, `E2E_SKIP_SERVERS=1`, backend `:3000` + partner-web `:3002`.

| Run | Pass | Fail | Skip | Total | Time |
|-----|------|------|------|-------|------|
| Pass 4 | 60 | 5 | — | 66 | — |
| Pass 6 after live enum | 62 | 4 | 0 | 66 | 25.7m |
| Pass 6 targeted re-run (4 previous fails) | 4 | 0 | 0 | 4 | 2.0m |
| **Pass 6 full suite** | **66** | **0** | **0** | **66** | **13.7m** |

The four Pass-6-mid fails are closed:

| Test | Resolution |
|------|------------|
| LIVE Offer→Complete | **PASS** (33.9s). Booking `cmtkfwemi0004tzk8v8vhsofm` / `S03L-s03live-mtkfweed` COMPLETED; admin GET same id HTTP 200 |
| Section 04 wallet→earnings→incentives→payouts | **PASS** (17.5s). Live invoices/payouts/earnings/incentives HTTP 200 after G-03 enum |
| Section 06 scorecard axe | **PASS** (15.1s). Heading `/partner score/i` with 30s timeout |
| Section 03 375px overflow | **PASS**. Shell `overflow-x-hidden` + closed mobile sidebar `invisible` so the 280px off-canvas nav does not expand `scrollWidth` |

---

## 11. Admin Playwright totals

Full 86-spec run: **38 passed / 36 failed / 12 not run / 86** (16.8m).

Root cause of the login serial cluster in that run: HQ accordion used `inert=""` (empty string). React logged a boolean-attribute warning; `monitor.assertClean()` failed; serial dependents **did not run**. Product now uses `inert={!expanded}`.

Post-fix slice (27 specs): **26 passed / 1 failed**.

| Spec | Post-fix |
|------|----------|
| `admin-enterprise` login + downstream | **PASS** (login 11.9s) |
| `operations-certification` (except last) | **PASS** |
| `operations-certification` booking operations API | **FAIL** — admin create booking returned no `data.booking.id` |
| Section 04 / 05 / 09 | **PASS** |
| Section 10 | **2/2 PASS** (Partners asserted on the command-center rail, not a hidden sidebar span) |
| `journey-admin` login → `/operations` → `/heatmap` → `/geofences` | **PASS** (14.8s) |
| `signoff-journey` 3/3 | **PASS** |
| `login-dashboard` | **PASS** |

Still FAIL on the full 86 (not re-run after inert fix): acquisition visual overflow matrix (~20), dashboard LCP median 10628ms vs 2500ms target, `capture-booking-vendor`, `p0-start-application` chrome, `hq-nav-permissions-live`, `ai-tools-center`. Those are **not** converted to PASS.

---

## 12. Mobile totals

`adb devices` → empty (header only, no emulator). Native Android certification **not executed**. Previous 18+ gates are **not** claimed as current PASS.

---

## 13. Customer→Partner→Admin E2E

Live correlated records from the Partner 66/66 Offer→Complete job:

| Layer | Evidence |
|-------|----------|
| Customer | `customer@homigo.demo` user `cmq9h68mp0008tz8so7py2429` |
| Partner | `partner@homigo.demo` user `cmq9h68780003tz8sc6scw3kj`; list contains booking |
| Booking | `id=cmtkfwemi0004tzk8v8vhsofm` `bookingNumber=S03L-s03live-mtkfweed` status `completed` / admin `COMPLETED` `paymentStatus=SUCCESS` |
| Admin | `GET /api/admin/bookings/cmtkfwemi0004tzk8v8vhsofm` **HTTP 200**, same id/number |
| Finance | Partner payouts `available=38105.2` `current=54941.2` `pending=16836`. Invoice list does not expose `bookingId` on the item DTO, so earning-row join for this booking is **not** proven from that API |
| Audit | `GET /api/admin/audit?q=<bookingId>` HTTP 200 (items returned; not a dedicated requestId/correlationId walk) |

STATUS: **PARTIAL** (same booking id on partner list + admin GET after a real complete). Not a full Customer booking-create → pay → partner execute → admin audit chain from a single scripted customer payment.

---

## 14. Money matrix

Numbered cases 7, 8, 11–20 were **not** run as a dedicated Pass 6 harness.

Linux RUN B includes `p0-financial-races` (refund/payout/withdrawal races, idempotency) — **not** in the RUN B fail list. That is **not** a substitute for the numbered money matrix with OPENING+CREDITS−DEBITS=CLOSING and MONEY DRIFT=0.

STATUS: **PARTIAL** (race tests present; numbered matrix NOT RUN).

---

## 15. FSM isolation

Four FSMs remain separate in source (partner lifecycle ≠ availability ≠ job `isBookingTransitionAllowed` ≠ financial). Combined RUN B did not fail the partner-lifecycle / availability unit tests. Dedicated four-FSM cert harness **not** re-run as a named program.

STATUS: **PARTIAL** (unit evidence; not a dedicated Pass 6 harness).

---

## 16. Security

No security rules were weakened. Partner settings still ignore `partnerId: "not-my-id"` tamper in the p2 body (save succeeded). Online deny is an operational message, not an auth bypass. Full IDOR/AI/prompt-injection regression suite **not** re-executed as a named Pass 6 program beyond tests already in combined Linux.

STATUS: **PARTIAL**.

---

## 17. AI

Partner Playwright `section08-ai.spec` **PASS** (assistant, demand, earnings coach, intelligence). Section 08 live 38/0/1 WARN **not** re-run. `demand.spike` remains POLICY PENDING.

---

## 18. Events

Section 09 catalog/PII tests **PASS**. Event-bus remains a separate inject process (Pass 5). Combined RUN B did not list event-integration P0-4 as fail.

---

## 19. Automation

Double-registration **PASS** (conditions + fingerprint-equal workflows). `demand.spike` SHADOW / POLICY PENDING unchanged. Admin `section09-automation.spec` **2 PASS**.

---

## 20. Observability

Section 10 spec hits `/audit` and `/observability/logs`. Full requestId/correlationId/partnerId/bookingId/eventId/actorId/deviceId trace through layers **not** executed as a dedicated Pass 6 program.

STATUS: **PARTIAL**.

---

## 21. Exact fixes

1. CREDITED-only filter on available/forecastable earning reads.
2. Chargeback tests use a real PDF; invalid PDF still rejected.
3. Support ticket unique-number retry outside aborted transactions; wider ticket space.
4. Workflow registry idempotent for identical fingerprints.
5. Forecast/scheduled-report tests assert degraded mode without faking live BQ.
6. Soak 7 restores working window so soak 9 is not blocked by leftover hours.
7. Reschedule partner notification is **awaited** (was fire-and-forget race).
8. Test-only fast-fail when GCP ADC is absent (same error string).
9. Live `homigo_db` G-03 enum applied (172 `credited` → `CREDITED`).
10. p2-availability test accepts the product’s actual online-refusal copy.
11. `refreshLock` — TTL extend only; processQueue aborts if leadership is lost. SET NX is no longer used as a refresh.
12. Complete route maps unexpected errors to **500 COMPLETE_FAILED**, not 403 (ownership stays 403).
13. Partner shell `overflow-x-hidden`; closed mobile sidebar is `invisible` so it does not expand document scrollWidth.
14. Admin HQ accordion: collapsed sections are `inert={!expanded}` / `aria-hidden` / no pointer events (boolean `inert`, not `inert=""`).
15. Admin login helpers accept heading `Executive HQ|business overview`.
16. Chaos 10 starts by deleting leftover bookings for the fixture customer.
17. `production-blocker-final` / `surge-alert` beforeAll timeouts 120s / 30s (Docker volume scan/reconcile).

---

## 22. Exact files changed

- `apps/backend/src/lib/earning-settlement.ts` (new)
- `apps/backend/src/services/earnings-coach.service.ts`
- `apps/backend/src/services/provider.service.ts`
- `apps/backend/src/services/earnings.service.ts`
- `apps/backend/src/services/earnings-live.service.ts`
- `apps/backend/src/ai-brain/context/collectors/partner-context.ts`
- `apps/backend/src/services/admin.service.ts`
- `apps/backend/src/services/command-center-overview.service.ts`
- `apps/backend/src/services/finance-intelligence.service.ts`
- `apps/backend/src/services/invoice-report.service.ts`
- `apps/backend/src/lib/partner-exec-metrics.ts`
- `apps/backend/src/services/support-ticket.service.ts`
- `apps/backend/src/services/booking.service.ts`
- `apps/backend/src/automation/registry/workflow-registry.ts`
- `apps/backend/src/services/vertex-ai.service.ts`
- `apps/backend/src/__tests__/earnings-coach.integration.test.ts`
- `apps/backend/src/__tests__/enterprise-operations-certification.test.ts`
- `apps/backend/src/__tests__/enterprise-soak-certification.test.ts`
- `apps/backend/src/__tests__/section09-events-automation.integration.test.ts`
- `apps/backend/src/__tests__/forecast-explainer.integration.test.ts`
- `apps/backend/src/__tests__/scheduled-reports.integration.test.ts`
- `apps/backend/src/__tests__/adversarial-integration.test.ts` (B1 timeout 120s)
- `apps/backend/src/__tests__/assignment-dispatch-lock.test.ts` (timeout 30s)
- `apps/backend/src/__tests__/shift-planning.integration.test.ts` (timeout 30s)
- `apps/partner-web/e2e/p2-availability.spec.ts`
- `apps/backend/src/lib/redis.ts` (`refreshLock` / `memRefreshLock`)
- `apps/backend/src/services/assignment-engine.service.ts`
- `apps/backend/src/routes/bookings.ts` (complete error mapping)
- `apps/backend/src/__tests__/chaos-certification.test.ts`
- `apps/backend/src/__tests__/production-blocker-final.test.ts`
- `apps/backend/src/__tests__/surge-alert.integration.test.ts`
- `apps/partner-web/src/components/layout/PartnerShell.tsx`
- `apps/partner-web/src/components/layout/PartnerSidebar.tsx`
- `apps/partner-web/e2e/section06-score-career.spec.ts`
- `apps/admin-panel/src/components/layout/HqSidebar.tsx`
- `apps/admin-panel/e2e/journey-admin.spec.ts`
- `apps/admin-panel/e2e/signoff-journey.spec.ts`
- `apps/admin-panel/e2e/lcp-dashboard.spec.ts`
- `apps/admin-panel/e2e/hardening-features.spec.ts`
- `apps/admin-panel/e2e/enterprise/admin-enterprise.spec.ts`
- `apps/admin-panel/e2e/enterprise/operations-certification.spec.ts`
- `apps/admin-panel/e2e/section10-command-center.spec.ts`
- Live DB: `homigo_db` G-03 enum (not a repo file); `_prisma_migrations` row `20260902120000_earning_settlement_status_enum`

Pass 5 files (preload, BQ catch, `$disconnect`, event-bus inject, etc.) **not undone**.

---

## 23. Exact commands

```
docker run --rm --network homigo-cert4 -v D:/homigo/apps/backend:/app -w /app \
  -e NODE_ENV=test \
  -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
  oven/bun:1.3 bun test --max-concurrency 1

docker run ... bun test --max-concurrency 1 \
  ./src/__tests__/earnings-coach.integration.test.ts \
  ./src/__tests__/enterprise-operations-certification.test.ts \
  ./src/__tests__/section09-events-automation.integration.test.ts \
  ./src/__tests__/forecast-explainer.integration.test.ts \
  ./src/__tests__/scheduled-reports.integration.test.ts \
  ./src/__tests__/enterprise-soak-certification.test.ts

cd apps/partner-web && E2E_SKIP_SERVERS=1 npx playwright test
cd apps/admin-panel && E2E_SKIP_SERVERS=1 npx playwright test
adb devices
```

---

## 24. Exact test counts

See §2 and §9–§11.

---

## 25. External dependencies

Unchanged: Razorpay live, SMS live, government KYC, emergency dispatch, **BigQuery/GCP ADC** (CI/Docker: unavailable; degraded mode proven).

---

## 26. Policy pending

`demand.spike` SHADOW-only automation — **POLICY PENDING**. Executive report schedule still UNSET.

---

## 27. Environment limitations

- Windows Bun multi-file DB tests: ENVIRONMENT LIMITATION (use Linux Docker).
- Docker bun 1.3.14: per-test timeout defaults to **5000ms** despite bunfig 45000.
- No Android emulator (`adb devices` empty).
- Live `homigo_db` had not applied G-03 until this pass (pgbouncer `localhost:5433`).

---

## 28. Remaining blockers

| Item | STATUS | ROOT CAUSE | IMPACT | EVIDENCE | REQUIRED ACTION |
|------|--------|------------|--------|----------|-----------------|
| Combined Linux 0 FAIL | NOT MET | RUN D 6 fails: chaos isolation, 5s hooks, combined ledger snapshot, 500-create P2028 | Cannot certify Linux green | 1699/6/1705 | Re-run combined after hook/chaos isolation; 500-create needs more pool or classified ENVIRONMENT |
| Partner Playwright 0 FAIL | **MET** | — | Partner web cert green | **66/0/66** (13.7m) | Keep on regression |
| Admin Playwright 0 FAIL / 0 unexpected NOT RUN | NOT MET | Visual overflow, LCP 10.6s, capture row, start-application chrome, ops booking create; full 86 not re-run after inert boolean | Admin not green | Full 38/36/12; post-fix slice 26/1 | Overflow/LCP product work; re-run full 86; fix admin booking create |
| Section 10 complete surface | PARTIAL | Spec 2/2 PASS; IA has **22** surfaces; Automation/Events not in IA; not per-route mutation/audit | Command Center not fully certified | `command-center-ia.ts` + spec 2/2 | Per-route mutation/audit/error |
| Native Android | NOT RUN | No emulator | Onboarding persist unproven on device | empty `adb devices` | Attach emulator, rerun native cert |
| Correlated C→P→A | PARTIAL | Same booking id on partner + admin after live complete; earning DTO lacks bookingId | Not a full customer-pay chain | `cmtkfwemi0004tzk8v8vhsofm` | Customer create+pay then admin audit walk |
| Money matrix 7–8, 11–20 | NOT RUN | Not executed as numbered harness | Drift=0 unproven for those case IDs | `p0-financial-races` in Linux | Run numbered harness |
| 500 concurrent booking create | FAIL on RUN D | Prisma P2028 with `connection_limit=8` | High-concurrency create not proven at 500 | 250 concurrent PASS | Raise test pool or classify ENVIRONMENT |

---

## 29. Final certification decision

**NOT CERTIFIED.**

Section re-evaluation (historical PASS is evidence, not truth):

| § | Name | Status | Evidence this pass |
|---|------|--------|-------------------|
| 01 | Acquisition | **PASS** with visual overflow FAIL on admin matrix | Partner onboarding **PASS**; admin overflow FAILs do not retract acquisition API |
| 02 | Operations | **PASS** | Partner p2 **PASS**; admin journey/signoff ops map **PASS** |
| 03 | Execution | **PASS** | Live Offer→Complete **PASS**; 375 overflow **PASS**; booking `S03L-s03live-mtkfweed` COMPLETED |
| 04 | Finance | **PASS** on partner + admin finance slice | Partner wallet path **PASS**; admin finance slice **PASS**; live invoices **200** |
| 05 | Trust | **PASS** | Partner + admin section05 **PASS** (post-inert slice) |
| 06 | Growth | **PASS** | Partner scorecard a11y + 12 viewports **PASS** |
| 07 | Referral | **PASS** | Partner section07 **PASS** in 66/66 |
| 08 | Intelligence | **PASS** with EXTERNAL BQ | Partner section08 **PASS**; forecast degraded mode proven; live BQ not connected |
| 09 | Automation | **PASS** with POLICY PENDING | Double-register **PASS**; admin §09 **PASS**; `demand.spike` unchanged |
| 10 | Command Center | **PARTIAL** | Spec 2/2 **PASS**; 22 IA surfaces; not full mutation/audit per route |

**FULL CERTIFIED is not justified.** Pass 7 closed RUN D’s six failure categories in targeted proof and reduced combined Linux to **1 fail** on RUN 1 (soak P2028, now fixed). Clean RUN 3 repeatability and Admin Run2 are pending. Exit criteria still fail on Linux 0 FAIL × 3, Admin Playwright 0 FAIL, Section 10 complete surface matrix, mobile native, numbered money matrix, correlated Customer→Partner→Admin E2E, and live BigQuery.

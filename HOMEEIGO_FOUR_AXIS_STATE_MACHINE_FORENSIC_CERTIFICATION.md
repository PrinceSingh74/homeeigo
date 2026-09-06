# HOMEEIGO — Four-Axis State Machine Forensic Certification

**Date:** 2026-09-05  
**Freeze:** final reproducibility loop  
**Branch:** `cursor/stage-e-step-13-certification`  
**Canonical contract:** `apps/backend/src/lib/partner-four-axis.ts`

## Outcomes (do not merge, do not inflate)

| Label | Status |
|---|---|
| **A. IMPLEMENTATION ALIGNED** | **YES** |
| **B. PRODUCT-SURFACE PROVEN** | **PARTIAL** |
| **C. FOUR-AXIS CERTIFIED** | **NO** |

```
FOUR-AXIS IMPLEMENTATION: PROVEN
FULL PRODUCT:             STRONGLY PROVEN EXCEPT NATIVE MOBILE UI
FOUR-AXIS CERTIFICATION:  OPEN DUE TO MOBILE ENVIRONMENT LIMITATION
```

Native mobile UI is mandatory under this document’s policy. No waiver exists. No native run occurred.

---

## A. IMPLEMENTATION ALIGNMENT

**YES.**

Four independent machines. Never one enum.

```
PARTNER lifecycle
     ├─ AVAILABILITY
     └─ JOB
          └─ FINANCE
```

| Axis | Canonical vocabulary |
|---|---|
| Partner | `APPLIED → VERIFIED → TRAINING → ACTIVE → PAUSED → UNDER_REVIEW → SUSPENDED → REACTIVATED` |
| Availability | `OFFLINE → AVAILABLE → OFFERED → ACCEPTING → EN_ROUTE → ON_JOB → PAUSED` |
| Job | `OFFERED → ACCEPTED → EN_ROUTE → ARRIVED → STARTED → IN_PROGRESS → COMPLETED` |
| Money | `EARNING_POSTED → PENDING → AVAILABLE → WITHDRAWAL_REQUESTED → PROCESSING → PAID` |

Homonyms (`PAUSED`, `OFFERED`, `EN_ROUTE`, `AVAILABLE`) are namespaced. `Partner.SUSPENDED` is not availability. `Job.COMPLETED` is not money.

**Gates only, never storage merge**

- Dispatch requires `lifecycleState: ACTIVE` (`DISPATCH_LIFECYCLE_WHERE`). `APPLIED + isApproved` is not eligible.
- `Job.COMPLETED` is the only job hop that may post finance.
- Lifecycle `PAUSED` / `SUSPENDED` may clear `isOnline` only. They do not write job or money.

**Illegal write rejection (re-proven this freeze)**

| Attempt | Result |
|---|---|
| Partner `APPROVED` / `KYC_PENDING` / `VERIFICATION` | `INVALID_TRANSITION` (raw target; no silent canonicalize to `ACTIVE`) |
| Availability `SUSPENDED` / `ACCEPTING_JOB` | `AXIS_MIX` / not an availability value |
| Job `EARNINGS_POSTED` | `AXIS_MIX`; completed job stays `COMPLETED` |

**Orthogonality + money integrity (this freeze)**

- 12/12 PASS — `p13ax-mto5z7d8`
- MONEY_DRIFT = 0
- Independent snapshot: `Partner=ACTIVE`, `Availability=ON_JOB`, `Job=IN_PROGRESS`, `Money=AVAILABLE`
- After complete: `Job=COMPLETED`, finance posted separately, job never `EARNINGS_POSTED`

---

## B. FULL PRODUCT CERTIFICATION

### B1. FSM — PASS (re-run this freeze)

- **OS:** Windows 11
- **Runtime:** Bun 1.3.14 (`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`)
- **Command:** `bun test src/__tests__/partner-four-axis.test.ts src/__tests__/partner-lifecycle-fsm.test.ts src/__tests__/partner-availability-fsm.test.ts src/__tests__/partner-job-fsm.test.ts src/__tests__/partner-finance-fsm.test.ts src/__tests__/section03-job-action-policy.test.ts src/__tests__/partner-career-policy.test.ts --max-concurrency 1`
- **Result:** **51 pass / 0 fail / 185 expects / 521ms**

### B2. Orthogonality — PASS (re-run this freeze)

- **OS:** Linux Docker `oven/bun:1.3`
- **DB:** `homigo-ci-pg` / `homigo_test` / `connection_limit=8`
- **Command:** `bun test src/__tests__/p0-security-hardening.test.ts src/__tests__/p0-financial-races.test.ts src/__tests__/customer-partner-admin-correlated-e2e.test.ts src/__tests__/partner-four-axis-orthogonality.test.ts --max-concurrency 1`
- **Bundle result:** **104 pass / 0 fail / 382 expects / 10.39s**
- **Orthogonality:** **12/12**
- **RUN_ID:** `p13ax-mto5z7d8`

```
{"PHASE":"FOUR_AXIS_INDEPENDENT_SNAPSHOT","RUN_ID":"p13ax-mto5z7d8",
 "partner":"ACTIVE","availability":"ON_JOB","job":"IN_PROGRESS","money":"AVAILABLE"}
```

```
{"PASS":13,"PHASE":"FOUR_AXIS_ORTHOGONALITY","RUN_ID":"p13ax-mto5z7d8",
 "lifecycle":"ACTIVE","availability":"available","job":"COMPLETED","MONEY_DRIFT":0}
```

### B3. Pass 12 correlated journey — PASS (re-run this freeze)

- **RUN_ID:** `p12-mto5z4d7`
- **Result:** customer / partner / admin / DB all `COMPLETED`
- **MONEY_DRIFT:** 0
- **correlationId = bookingId**

### B4. Security + financial races — PASS (re-run this freeze)

Same 4-file Linux bundle: **104/104**.

### B5. Partner Web Playwright

| Run | Result | Status |
|---|---|---|
| Historical first full shot | **65/66** (onboarding `step1` 500 under RAM + concurrent Linux `bun test`) | PARTIAL — keep this row |
| Isolated retry of that 1 | PASS | Not a clean 66/66 |
| Interrupted `--watch` run | 50/14/2 | Backend `ECONNREFUSED` |
| **Clean last-mile** | **66 passed / 0 failed / 0 skipped** (26.5m) | **PASS** |

Command for the clean run: `E2E_SKIP_SERVERS=1 npx playwright test --trace on` in `apps/partner-web` against Next `:3002` + non-watch backend `:3000`.

No Partner Web source change this freeze. 66/66 remains valid.

### B6. Admin Playwright

**88 passed / 2 skipped / 0 failed** (32.4m).

Skipped (not product FAIL): `capture-booking-vendor` (manual), `lcp-dashboard` (stale `next start`). Roster filter remains `account_restricted`, not `Availability.SUSPENDED`.

No Admin/shared-UI change this freeze. 88/2 skip retained.

### B7. Full backend regression

| Run | Pool | Result |
|---|---|---|
| Historical first shot after schema repair | 8 | **2018 pass / 1 fail** — chaos-10 `P2024` |
| Isolated chaos-10 | 20 | PASS — not pool-8 green |
| Isolated chaos-10 after dispatch bound | 8 | PASS |
| **Final full suite** | **8** | **2019 pass / 0 fail / 140 files / 624.22s** |

Root cause of the historical fail: unbounded fire-and-forget `dispatchBookingNow` on create. Fix: `MAX_INLINE_DISPATCH = 2`. Product semantics unchanged.

No backend business-logic change this freeze. 2019/0 at pool 8 remains valid.

### B8. API / events / automation

Live responses qualify domain:

| Surface | Axis field |
|---|---|
| Lifecycle service | `axis: "LIFECYCLE"` |
| Operations snapshot | `axis: "AVAILABILITY"` |
| Booking job actions | `axis: "JOB"`, `jobState` |
| Finance center | `axis: "FINANCE"` |

Events stay namespaced: `homigo.partner.lifecycle.changed`, `homigo.partner.availability.updated`, `homigo.partner.en_route` / `arrived`, `homigo.partner.earnings.posted` (`PARTNER_EARNINGS_POSTED` is a **finance event**, not a job status). `PUT /me/online` body is `{ online: boolean }` only.

Event/scheduled-job tests passed inside the 2019/0 full suite.

Non-failing log noise: `assignment_attempts` unique `(job_id, provider_id)` during concurrent offer retries. Tests still passed.

### B9. ML / Phase 14

**73/73** after `ml_model_versions` / Phase 14–15 schema repair (prior last-mile). Unchanged this freeze.

### B10. Mobile API

**5/5 PASS** (prior). Not native UI.

### B11. Final global scan (this freeze)

Live write scan of `apps/backend/src/{lib,services,routes}`, `apps/partner-web/src`, `apps/admin-panel/src`, `homigo-partner-mobile/src`:

| Token / pattern | Class |
|---|---|
| Prisma / lead `KYC_PENDING` / `VERIFICATION` / `APPROVED` | HISTORICAL persistence aliases or **lead CRM** domain |
| Lifecycle service write of those tokens | Rejected — `INVALID_TRANSITION` |
| `accepting_job` | LEGACY ALIAS → `ACCEPTING` |
| Admin `account_restricted` | UI LABEL for lifecycle/restriction |
| `PARTNER_EARNINGS_POSTED` | CANONICAL finance event |
| `status: "EARNINGS_POSTED"` job write | None in live source |
| `Availability.SUSPENDED` / `ACCEPTING_JOB` write | None; `AXIS_MIX` |
| `finance.ts` `APPROVED` (mobile) | CANONICAL **payout** label, not Partner lifecycle |
| `android.bundle.js` `EARNINGS_POSTED` job stage | DEAD artifact |
| Homonym `status === "EN_ROUTE"` in job-action-policy | CANONICAL job axis |

**No unresolved live four-axis implementation violation.**

---

## C. TOOLCHAIN / OS / ENVIRONMENT LIMITATIONS

Do not collapse these into product FAIL.

| Item | Fact | Product vs environment | Cert impact |
|---|---|---|---|
| Windows Bun collector | Empty collect / segfault on heavy Prisma files unless `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` and often Linux | Toolchain | Linux is the supported Prisma runner |
| Linux Docker | Repo-root mount + `homigo-cert-linux-nm` + `homigo-ci-pg` | Resolution | 12/12, 104/104, 2019/0 |
| Next historical OOM / second server | Webpack/turbopack + Playwright spawn | Environment | Solved by `E2E_SKIP_SERVERS=1`, one Next |
| Backend `--watch` mid-E2E | Login `ECONNREFUSED` | Runner | 50/14 interrupted run; non-watch API for 66/66 |
| Journey screenshot lock | Windows `UNKNOWN: open journey-partner.png` | Environment | Timestamped filename |
| Chaos `P2024` at pool 8 | Unbounded inline dispatch | **Application** (fixed) | Historical 2018/1; final 2019/0 |
| Pool contract | App default 8 / prod 15; CI `.env.test` 5; this cert command 8 | Config | Pool-20 ≠ pool-8 |
| Admin `next start` | `routesManifest.dataRoutes is not iterable` | Stale `.next` | LCP skipped |
| Native Android | Class C — §E | Environment | Blocks CERTIFIED |
| Dirty working tree | ~1084 short-status lines including unrelated Admin/docs/artifacts | Repo hygiene | Cert subject is the classified subset in §D, not the entire dirty tree |
| `apps/backend/nul` | Windows reserved name | Environment leftover | Tools cannot open it |

---

## D. CERTIFICATION SUBJECT REVISION

**HEAD:** `0a86cd2613431037469db77243fe61395bdfaa94`  
`fix(prisma): apply notification delivery claim after the deliveries table is created`

HEAD alone is **not** the certified implementation.

**Subject = HEAD + the uncommitted four-axis / dispatch-bound working tree below.**

The full `git status` is dirty far beyond this subject (~1084 lines: Admin UI, docs, e2e artifacts, metrics, etc.). Those files are **UNRELATED** to four-axis certification. They were not reset. They are not claimed as the certified delta.

| Path | Git | Class |
|---|---|---|
| `apps/backend/src/lib/partner-four-axis.ts` | untracked | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/lib/partner-lifecycle-fsm.ts` | untracked | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/lib/partner-availability-fsm.ts` | modified | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/lib/partner-job-fsm.ts` | untracked | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/lib/partner-finance-fsm.ts` | untracked | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/services/partner-lifecycle.service.ts` | untracked | FOUR-AXIS IMPLEMENTATION |
| `apps/backend/src/services/assignment-engine.service.ts` | modified | DISPATCH FIX |
| `apps/backend/src/services/booking.service.ts` | modified | DISPATCH FIX |
| `apps/backend/src/__tests__/partner-four-axis.test.ts` | untracked | TEST |
| `apps/backend/src/__tests__/partner-four-axis-orthogonality.test.ts` | untracked | TEST |
| `apps/backend/src/__tests__/partner-lifecycle-fsm.test.ts` | untracked | TEST |
| `apps/backend/src/__tests__/partner-job-fsm.test.ts` | untracked | TEST |
| `apps/backend/src/__tests__/partner-finance-fsm.test.ts` | untracked | TEST |
| `apps/backend/src/__tests__/partner-availability-fsm.test.ts` | modified | TEST |
| `apps/backend/scripts/setup-test-db.ts` | modified | TEST (late additive migrations) |
| `apps/partner-web/e2e/journey-partner.spec.ts` | modified | TEST (timestamped screenshot) |
| `.cursor/rules/partner-four-axis.mdc` | untracked | DOCUMENTATION |
| `HOMEEIGO_FOUR_AXIS_STATE_MACHINE_FORENSIC_CERTIFICATION.md` | untracked | DOCUMENTATION |

This freeze did **not** change production or mobile-integration code. Re-runs above are the current four-axis evidence.

---

## E. MOBILE NATIVE CERTIFICATION STATUS

**NOT RUN — ENVIRONMENT LIMITATION**

**Class C — objectively unavailable.**

| Fact | Evidence |
|---|---|
| adb 37.0.1 | Present (`Android Debug Bridge version 1.0.41`) |
| `adb devices -l` | Empty after daemon restart |
| `emulator.exe` | Missing (`Sdk\emulator` is `.installer` only) |
| Installed SDK | **platform-tools only** |
| Android platforms | Missing |
| Android build-tools | Missing |
| System images | Missing |
| AVD `Homigo_API36` | Config residue; `SystemImage.getPackage()` is **null** |
| Referenced image paths | Do not exist |
| Docker Android image | None |
| WSL | `docker-desktop` only |
| CI `mobile-startup` | typecheck + Node scripts — **no emulator job** |
| `sdkmanager.bat` | Present; unused. Installing emulator + images would be new multi-GB provisioning |

Mobile API 5/5 and Expo-web Playwright are **not** native UI proof. `e2e/native-android-cert.ts` was not executed.

**No waiver has been granted.**

---

## F. OPEN CERTIFICATION GATE

**Native mobile UI execution.**

This is an environment limitation, not a product defect, and not a PASS.

**Required future prerequisite**

A real Android emulator or physical device, or an approved CI mobile runner, with the HOMEEIGO Expo / React Native partner app executable, such that `adb devices` shows a runtime and `e2e/native-android-cert.ts` (or equivalent native UIAutomator / device E2E) can run:

Onboarding → lifecycle → availability → offer → accept → en route → arrive → start → in progress → complete → earnings / wallet / withdrawal / notifications

and prove the same four-axis snapshot and negatives on device.

Until that exists, policy forbids `FOUR-AXIS CERTIFIED`.

---

## G. UI STATE ISOLATION AUDIT

Objective: four independent domains in UI, **not** one screen per state. No production code changed. Prior Web 66/66 and Admin 88/2 skip retained (not re-run).

Screens may show multiple axes at once. Forbidden: one generic `status` for all four.

| Surface | API / field | Axis | Render |
|---|---|---|---|
| Register / onboarding | onboarding draft steps | Partner apply path | Steps, not a job/money status |
| Scorecard | `GET /me/lifecycle` → `lifecycleState` + nested `availability.currentStatus` | Partner **and** Availability | Two labeled fields: Lifecycle / Availability |
| Compliance | `/me/compliance` `status` VERIFIED/EXPIRING | **Compliance domain**, not Partner.VERIFIED | Restriction copy |
| Dashboard ops / `/availability` | `/me/operations` `operationalStatus`, `availabilityState`, `axis: AVAILABILITY` | Availability | Online / Paused / Offline; Go Online / Pause |
| Same card `isSuspended` | operations `isSuspended` + `suspendedMessage` | Partner restriction **projection** | **Account restricted** — not Availability.SUSPENDED |
| Requests / job detail / Route Center | booking `status` + timestamps → `job-action-policy` `stage` | Job | Offer→Complete; never `EARNINGS_POSTED` |
| Dashboard schedule `statusLabel` | `PartnerBooking.status` only | Job | Upcoming / In progress / Completed |
| Earnings / Wallet / Payouts | `walletBalance`, `availableBalance`, payout row status | Money (numeric + payout FSM) | Withdraw gated on **balance**, not availability |
| Zustand `partner-store.status` | auth idle/authenticated | Auth | Not a Partner OS axis |
| Admin vendor | `lifecycleState` vs `currentStatus` | Partner vs Availability | Separate lines; suspend is lifecycle action |
| Admin roster | filter `account_restricted` | Lifecycle/restriction | Label **Account restricted** |
| Mobile HQ / availability / wallet | same `/operations`, `/lifecycle`, `/wallet` | Same contract | Lifecycle · availability copy; Account restricted vs Paused; `formatPayoutStatus` is payout |
| Mobile `job-action-policy.ts` | same as Web | Job | `COMPLETED` is job; `EARNING_POSTED` is money |

**Homonym distinction**

| Pair | UI |
|---|---|
| Partner.PAUSED vs Availability.PAUSED | Scorecard `lifecycleState`; Availability card “Paused · New offers are paused” |
| Partner.SUSPENDED vs Availability | “Account restricted”; Admin `account_restricted` |
| Availability.OFFERED / EN_ROUTE vs Job | Ops card vs booking `status` / job CTAs |
| Availability.AVAILABLE vs Money AVAILABLE | Ops “Online / Available for jobs” vs ₹ `availableBalance` |
| Job.COMPLETED vs Money | Job badge Complete; wallet/payout separate |

**Forbidden live UI vocab:** no `EARNINGS_POSTED` / `KYC_PENDING` / Partner `APPROVED` as canonical UI state. `accepting_job` is a **legacy alias** mapped to `accepting` in `OperationsStatusCard`. Payout `APPROVED` → “Requested” (payout domain).

**Actions:** Go Online / Pause → availability; Accept/Complete → job policy; Suspend → Admin lifecycle; Withdraw → wallet amount. Payment can **gate** job start; it does not become the job status.

**Representative combinations:** Scorecard + ops + requests + wallet can show `ACTIVE` / `ON_JOB` / `IN_PROGRESS` / numeric AVAILABLE independently. Suspended shows Account restricted + availability offline + completed jobs + wallet — not one badge.

No live four-axis UI collapse found. Native mobile **NOT RUN**.

---

## Phase 16 checklist

| Gate | Status |
|---|---|
| 51/51 FSM | **PASS** (this freeze, 521ms) |
| 12/12 orthogonality | **PASS** (`p13ax-mto5z7d8`) |
| MONEY_DRIFT = 0 | **PASS** |
| Pass 12 | **PASS** (`p12-mto5z4d7`) |
| Security + races | **PASS** (104/104) |
| Partner Web | Historical **65/66** kept; clean **66/66** |
| Admin | **88 / 2 skip / 0 fail** |
| Backend | Historical **2018/1** at pool 8 kept; final **2019/0** at pool 8 |
| ML / Phase 14 | **73/73** |
| Mobile API | **5/5** — not native |
| Native mobile UI | **NOT RUN — ENVIRONMENT LIMITATION** |
| API / events axis fields | **PASS** |
| Final four-axis scan | **PASS** — no live write violation |
| Subject revision recorded | **HEAD + uncommitted four-axis tree** |

---

## Final decision

**IMPLEMENTATION ALIGNED = YES**  
**PRODUCT-SURFACE PROVEN = PARTIAL**  
**FOUR-AXIS CERTIFIED = NO**

Reason: native mobile UI remains unrun because the runtime is objectively unavailable, and this certification policy requires native mobile proof with no waiver.

Do not invent a waiver.  
Do not invent native evidence.  
Do not invent a product failure.  
Do not claim HEAD alone is certified.

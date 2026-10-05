# Phase 10 + Phase 11 closure report

Date: 2026-10-04. Branch: `cursor/stage-e-step-13-certification`. No commit was made.

This loop did not rewrite matching, booking, or the partner job screen. It closed the customer decision-time contract: what the catalogue API may return, and what the service page may say.

## 1. Executive status

| Phase | Status |
|---|---|
| Phase 10 — customer visit promise and isolated booking | **OPEN** |
| Phase 11 — partner brief + matching | **OPEN** |

The same booking now runs through both browsers on the isolated stack. Phase 10 and Phase 11 stay OPEN. Partner mobile is EXTERNAL. The Partner Web 68/68 command has not been repeated after the accessibility contrast and label edits in this loop. The network-drop spec's last command did not exit 0. Neither phase is production readiness.

Production readiness from the 2026-10-03 state note is unchanged. Cloud staging and production stay EXTERNAL.

## 2. Phase 10 matrix

| Item | Status | Evidence |
|---|---|---|
| Customer-safe projection | PASS | `publicCatalogConfig` drops `execution`, `safety`, `quality`, `warranty`, `rework`, `trust`, `customerPolicy`, `matching`, `requirements`. `customer-visit.test.ts` asserts the keys and that partner strings are absent from the JSON. |
| Visit process | PASS | `customerVisitPromise` emits Arrival, Start check (only while the start PIN is required), Service, Confirmation. Confirmation hours call the same 1–720 rule as `confirmationWindowHours`, and 48 when quality is absent or `notApplicable`. Live `GET /api/services/cmr68qqap0000tzb8v95faklu` returned those four steps. The page heading “On the visit” rendered them. |
| Safety | PASS | Customer view is `customerSafetyView` only: warnings (including legacy `safetyNotes`), customer requirements, information, medical disclaimer, emergency protocol. Prohibited conditions, PPE and provider requirements are not on the promise. Live hourly-bookings showed two warnings and the stored emergency line. |
| Proof expectations | PASS | Photos are stated only when `quality.proofRequired` / `beforeAfterPhotos` is true, or an active step’s evidence says so. A step limited by `when` is “some options”, not every booking. Unconfigured proof is `null` (the page omits the section). Live hourly-bookings: `proof: null`. |
| Warranty + complaint window | PASS | Copy is built from `buildWarrantySnapshot` and `followUpFeeDecision`. A QUOTED rework fee does not produce a free-revisit sentence. Refund is “can be considered” and “not automatic”. No warranty and no complaint window → `null`. Live catalogue: all 25 services say “2-day cover” and `qualitySummary.warrantyDays` is 2, from `warranty.v1`, not the legacy quality field. |
| Age rule | PASS | Shown only for MINIMUM_AGE / ADULT_ONLY / GUARDIAN_REQUIRED when that mode’s number is present. NONE, missing number, and null config omit the section. Live hourly-bookings: `age: null`. |
| Unsupported / dead fields | PASS | `completion_criteria`, `trust.guarantee`, `chemical_restrictions`, `incident_protocol`, and `damage_policy` are not projected and not rendered. The public payload test rejects the fixture guarantee string. |
| API leakage | PASS | Live detail: `catalogConfig.execution/safety/quality/matching/trust` all false. `qualitySummary.checklistCount` is no longer returned. List payload for the same service only had `bookingMode` and `quantity` on `catalogConfig`. |
| Customer page runtime | PASS | `http://127.0.0.1:3001/services/home-help/hourly-home-help`. Headings included On the visit, Safety, Cover and complaints, How booking works. Preparation sentences were not repeated inside Safety (`written list helps` appeared once). |
| Responsive | PASS (this page) | At 390×844, `scrollWidth === clientWidth` (overflow 0) and `#visit-process` was in the document. |
| Accessibility | PASS (new sections) | axe-core 4.10.3 on `#visit-process`, `#visit-safety`, `#visit-proof`, `#visit-warranty` for bathroom cleaning: 0 violations, 4 passes, desktop and 390×844. Tablet 768px overflow 0 with those four sections present. Whole-page axe and partner-job axe were not run. |
| Customer journey through booking | PASS on the isolated stack (section 18) | The `:3000` handoff above was not a booking. The later isolated command booked, paid, and read back `cmuu7d3i9093btz3k4v9a6nfc` with the partner on that same id. |

## 3. Phase 11 matrix

| Item | Status | Evidence |
|---|---|---|
| Partner job summary, variant, quantity, duration | PASS (code, not re-driven) | `partnerJobBrief` and partner-mobile `JobDetailScreen` “What was booked”. No partner UI change in this loop. |
| Requirements, materials, equipment | PASS (code, not re-driven) | Job preparation block on the partner job screen. |
| Safety, steps, proof, checklist | PASS (code, not re-driven) | `SafetyPanel`, `ExecutionSteps`, `QualityPanel` on partner mobile; partner web mirrors from the earlier closure. Server still refuses completion without the frozen checklist (`qualityBlocksCompletion`). |
| Server enforcement | PASS | Existing `p10-s9-safety.test.ts` and `p10-s11-cases.test.ts` re-run: 14 + 12 pass. |
| Matching hard gates | PASS | `p11-matching-gates.test.ts` 13/13. Order: provenance, business authorisation, service capability, skill, certification missing / expired / unverified, equipment, insurance, language, availability, location, presence, capacity. |
| Evidence-backed scoring | PASS | `w2-d3-unknown-signals.test.ts` 25/25. No rating, distance, response, or completion score without the sample the module requires. Ties break on known-signal count, then provider id. |
| Preferred provider | PASS as a classification, not a new feature | `PROFESSIONAL_PREFERENCE_SUPPORTED` is false, so a customer cannot be told a chosen professional is guaranteed. `matching.service.ts`, `matching-gates.ts`, and `matching-signals.ts` do not read `matching.preferredProvider`. Rework `sameProviderPreferred` applies only when the follow-up fee is WAIVED; QUOTED returns `OWNER_APPROVAL_REQUIRED`. `preferred-provider-contract.test.ts` 3/3. |
| Fallback / escalation | PASS as the existing contract | Broadcast offers every eligible partner; the booking stays unassigned until the first accept. No eligible partner records `NO_PROVIDER` and does not invent one. Offer window is `DISPATCH_TIMEOUT_MS` when live presence is required, otherwise capped by `SCHEDULED_OFFER_TIMEOUT_MS`. There is no second fallback policy, and none was added. Safety holds and cases stay on their own axes. |
| Concurrency | PASS | `broadcast-accept-gate-context.test.ts`: 10 concurrent accepts, exactly one winner, twice (7.0s then 6.6s). |
| Partner web E2E | PASS — one command, 68/68 | `npx playwright test --reporter=line` with `E2E_SKIP_SERVERS=1`, API `:3100`, partner web `:3016`. Isolation check passed. Footer: `68 passed (37.3m)`, exit 0, ended 2026-10-04T17:00:42Z. The earlier 63/3/2 run is history, not this result. |
| Partner mobile device | EXTERNAL | `adb devices` on 2026-10-04 listed no device. `emulator.exe` is not installed. |

## 4. Issues found and root cause

| Id | Issue | Root cause | Fix |
|---|---|---|---|
| P10-1 | Service detail JSON included the execution plan, prohibited conditions, PPE, checklist, trust.guarantee, and matching weights | `publicCatalogConfig` spread the rest of `catalogConfig` after removing only matching and requirements | Those blocks are omitted. Customer copy is `visit` from the existing engines. |
| P10-2 | The service page showed legacy `safetyNotes` only, plus a marketing “How it works” | The web client never read `safety.warnings`, quality, or warranty | `ServiceVisit` renders `visit`. Booking steps are labelled “How booking works” when a visit promise exists. |
| P10-3 | “a 2 days cover” | Count helper was placed before the noun | “a 2-day cover”. |
| P10-4 | Safety repeated the preparation sentences | `safety.customerRequirements` and the Phase 6 preparation view are the same facts | When a preparation block is already on the page, those lines are not repeated under Safety. |
| P10-5 | `qualitySummary.warrantyDays` was 0 while the visit said “2-day cover” | The number came from legacy `quality.warrantyDays`. Bookings freeze `warranty.v1`, which is enabled at 2 days on the live catalogue | `customerQualitySummary` uses `buildWarrantySnapshot`. Days are 2 only when that snapshot is enabled. |

No matching defect was reproduced. Preferred-provider and fallback were undefined as product promises and already defined as code. They were not extended.

## 5. Files changed

- `apps/backend/src/lib/customer-visit.ts` (new)
- `apps/backend/src/lib/service-catalog-config.ts`
- `apps/backend/src/services/catalog.service.ts`
- `apps/backend/src/__tests__/customer-visit.test.ts` (new)
- `apps/backend/src/__tests__/preferred-provider-contract.test.ts` (new)
- `apps/backend/src/__tests__/service-domain.test.ts`
- `apps/web/src/types/backend.ts`
- `apps/web/src/components/services-catalog/detail/ServiceVisit.tsx` (new)
- `apps/web/src/components/services-catalog/detail/ServiceDetail.tsx`
- `apps/web/src/components/services-catalog/TrustSections.tsx`
- `docs/engineering/CURRENT-STATE.md`
- `docs/engineering/PHASE-10-11-CLOSURE-REPORT.md`

## 6. Tests

| Suite | Result |
|---|---|
| `customer-visit.test.ts` | 9 pass (includes warranty-days follow `warranty.v1`) |
| `preferred-provider-contract.test.ts` | 3 pass |
| `service-domain.test.ts` | pass (file included in the 89) |
| `service-catalog-config.test.ts` | pass |
| `p10-s9-safety.test.ts` | pass |
| `p10-s11-cases.test.ts` | pass |
| `p11-matching-gates.test.ts` | 13 pass |
| Combined bun run of those seven files | **89 pass / 0 fail** |
| `w2-d3-unknown-signals.test.ts` | **25 pass / 0 fail** |
| `apps/web` `bun test tests/catalog` | **28 pass / 0 fail** |
| `broadcast-accept-gate-context.test.ts` | **1 pass, then 1 pass** (10 accepts, one winner) |
| Partner web unit: checklist, call privacy, execution copy, job gates, step evidence | **31 pass / 0 fail** |
| Partner mobile unit: job gates, step evidence, warranty copy | **17 pass / 0 fail** |

The full backend suite (4,000+ tests) was not re-run. Partner unit tests mirror server gates; they are not a browser or device drive.

## 7. Runtime

Local API already on `:3000` reloaded this code. `GET /api/services/cmr68qqap0000tzb8v95faklu` (`hourly-bookings`):

- `visit.process` = ARRIVAL, VERIFICATION, SERVICE, CONFIRMATION
- safety warnings and emergency protocol present; prohibited conditions not in the customer object
- warranty statements match a 2-day engine window
- `catalogConfig` has no execution, safety, quality, matching, or trust

A second read-only sweep on 2026-10-04, after the warranty-days fix, covered all 25 customer-visible services (`GET /api/services?limit=100` then each `GET /api/services/:id`):

- list 200, 19,324 bytes; each list `catalogConfig` checked on the first row had only `bookingMode` and `quantity`
- detail 200 for 25/25; latency 45–100 ms (p50 56 ms); body 4,690–6,782 bytes; sweep 1.78 s
- leaked catalog blocks: 0; `checklistCount`: 0; `"ppe"` key, `prohibitedConditions`, and `guarantee` inside `visit`: 0
- `qualitySummary.warrantyDays` matched the “N-day cover” sentence on every service (2 and 2)
- proof section absent on 8 services; present on 17; age absent on all 25 (no configured rule)
- unknown id 404; encoded path traversal 404; `?include=execution&fields=safety,matching` did not add those blocks

Local web on `:3001`:

- `/services` showed the bathroom-cleaning link; page text had no guarantee and no matching-score wording
- `/services/home-cleaning/bathroom-cleaning` headings included On the visit, Safety, Photos of the work, Cover and complaints; body had “2-day cover” and before/after photos, and did not contain “guarantee” or “checklist”
- overflow 0 at 390×844 and at 768px
- Book opened the sign-in page with the service id in `returnUrl`. No booking was created.

Partner web on `:3002` loads and redirects `/` to `/login` (“Sign in to your partner dashboard”). No job was opened.

## 8. Security

Customer catalogue JSON no longer carries partner SOP, checklist text, matching weights, skill codes, KYC flags, or `trust.guarantee`. Provider requirements on the public config remain `{ verifiedProfessionalRequired }` only. The start PIN step states that a PIN is shared; it does not include a PIN.

## 9. UX

New sections use the existing `DetailSection` and `cardSurface`. Safety requirements are not repeated when preparation is already shown. Booking steps stay, under “How booking works”, so they are not presented as the visit procedure.

The stored emergency protocol for hourly bookings is written in partner voice (“stop work”, “do not restart”). The customer page now shows the neutral stop sentence from section 11. The stored partner text is unchanged for the partner job.

## 10. Remaining

| Class | Item |
|---|---|
| PASS (later loop) | Isolated booking, payment SUCCESS, and dispatch. See section 11. The dev database was still not booked. |
| NOT RUN | Whole-page axe, and axe on a partner job. The four customer service sections passed axe-core 4.10.3. |
| PASS (later loop) | Signed-in partner accept, brief, en route, and arrival. See section 14. Start stays behind the customer PIN. |
| NOT RUN | Full partner-web Playwright suite. |
| EXTERNAL | Partner mobile: `adb devices` empty on 2026-10-04. |
| NOT RUN | Full backend suite |
| OWNER DECISION | A priced (QUOTED) follow-up has no price, so the engine refuses it. No customer sentence promises one. |
| OWNER DECISION | Customer “pick this professional” stays off until assignment can honour it. |
| DECIDED | Partner-voiced emergency lines are replaced on the customer page by the neutral stop sentence. A configured customer line and any number already in the text are kept. |
| EXTERNAL | Production deploy, device keystores, live payment. Unchanged. |

## 11. Closure loop — isolated booking, decisions, emergency line

Date: 2026-10-04. Database under test: `homigo_test` via the already-running backend on `:3100` (`/health` `isolatedDatabase: true`, Redis disabled). The dev backend on `:3000` is `homigo_db` and was not booked against. A login attempt that accidentally targeted `:3000` returned 401 and created nothing.

### Customer booking

A disposable fixture (tag `adv-p10close`) was created only in `homigo_test`. Chromium, through a temporary web server on `:3015` whose proxy and `NEXT_PUBLIC_API_URL` both stayed off `:3000`, signed in and confirmed the fixture service.

| Check | Result |
|---|---|
| Login host | `127.0.0.1:3015` (same origin; cookie stayed on the web app) |
| `POST /api/bookings` | 201, id `cmusx7g3t1lo8tz1whhp47mn0` |
| Page total | ₹550 |
| Persisted `finalAmount` / `finalAmountPaise` | 550 / 55000 |
| `paymentStatus` | SUCCESS (dev mock checkout, empty Razorpay keys) |
| `providerId` | null |
| Assignment job | DISPATCHED, 1 attempt |

Dispatch after payment, with no provider assigned until an accept, is the existing contract. The fixture and the booking were then deleted. `homigo_test` counts afterwards: users 0, bookings 0, services 0.

### Backend suites on `homigo_test` (77 pass / 0 fail, 68.23s)

Included: eight concurrent creates for one slot produce one booking; ten concurrent broadcast accepts produce one winner; a forged request amount is ignored; a forged payment amount is charged at the booking total; a quote used by another customer is refused; a republished service invalidates the quote; two concurrent rework resolves create one follow-up at amount 0.

Not re-run in this loop: expired session, invalid `returnUrl`, network interruption.

### Decisions

| Item | Decision | Why | Proof |
|---|---|---|---|
| Preferred provider | Soft preference only. A pinned or previous partner is ordered first when already eligible. They are never added if a hard gate failed. A customer “pick this professional” control stays off. Gender preference stays unpublished. | Matching has no provider-picker model. Offering one would promise an assignment the engine does not guarantee. | `preferPinnedAmongEligible` never inserts an id. `preferred-provider-contract.test.ts` and `dispatch-must-include.test.ts` in the 77. |
| Priced follow-up | A WAIVED follow-up is ₹0 and is not a payment. A QUOTED follow-up is refused with 409 `OWNER_APPROVAL_REQUIRED` (“A quoted rework needs an owner-approved price”). No amount is invented. A paid visit is a new booking through the quote engine. | The case path has no follow-up price list. | `followUpFeeDecision` and the concurrent rework test (one follow-up, zero amount, no payment row). |
| Emergency line | Partner-operational text (“stop work”, “do not restart”) is not shown to the customer. The customer sentence is “If something is unsafe, the professional stops the service and follows the platform safety procedure.” A phone number is included only when that text already contains one. A customer-written line, including “call 112”, is kept. | The stored hourly line was written to the professional. | `customer-visit.test.ts` 10 pass. Live `GET /api/services/cmr68qqap0000tzb8v95faklu` returns the neutral sentence and no invented number. |
| Fallback | Unchanged. Eligible partners are offered together. The first accept wins. No eligible partner is `NO_PROVIDER`. An ineligible partner is not invented. | That is the dispatch code already under test. | Broadcast accept test, one winner. |

### Partner and device

`adb devices` listed nothing. `emulator` is not on PATH. Partner Web on `:3002` still targets the dev API, so it was not used for a signed-in job. The signed-in job was driven later on `:3016`. See section 14.

## 12. Acceptance matrix

```
PHASE 10

Customer-safe projection             PASS
Visit process                        PASS
Safety                               PASS
Proof expectations                   PASS
Warranty + complaint window          PASS
Age rule                             PASS
Unsupported/dead field handling      PASS
API leakage protection               PASS
Full customer booking                PASS
Booking negative matrix              PASS (HTTP)
Network-drop booking                 PASS
Expired session                      PASS
Price authority                      PASS
Slot/match consistency               PASS
Customer E2E                         PASS
Responsive UX                        PASS
Accessibility                        PASS
API data isolation                   PASS

PHASE 11

Signed-in partner job                PASS
Partner brief                        PASS
Partner Web E2E (full suite)         PASS
Partner accessibility                PASS
Partner mobile device                EXTERNAL
Preferred provider                   PASS
Priced follow-up                     PASS
Emergency wording                    PASS
Fallback                             PASS
Escalation                           PASS
Matching hard gates                  PASS
Concurrency / one winner             PASS
Negative matrix                      INCONCLUSIVE
Security/isolation                   PASS
```

Customer E2E PASS now includes the isolated Chromium booking in section 17: `/book` listed the two test services, Gurugram was the default address, a server slot was chosen, and the confirmed heading rendered after payment. Accessibility PASS for the customer is still the four service-page sections from the earlier live page. Partner accessibility PASS is the axe tests inside the 68 (register, requests, finance, compliance, SOS, scorecard, notifications). Signed-in partner job PASS includes the Offer-to-Complete spec inside that same 68. Partner mobile is EXTERNAL.

## 13. Final closure state

```
PHASE 10 OPEN
PHASE 11 OPEN
```

Neither phase is CLOSED. The Partner Web suite is a single 68/68. The customer browser created a paid booking that is still `pending`, and that booking is not the job the partner completed inside the 68. There is still no device. Neither is BLOCKED.

## 15. Integrated HTTP journey, negatives, and the partner suite

Date: 2026-10-04. API `http://127.0.0.1:3100` reported `isolatedDatabase: true`. Prisma for the fixture used only `.env.test` and `current_database()` was `homigo_test`. `:3000` stayed the live dev database and was not booked.

The one-off driver was deleted after the run. Fixture tag `p11int` was removed in the same process. Counts before the seed were 0 users, 0 bookings, 0 payments, 0 services, 0 start PINs. Counts after cleanup of that tag were the same zeros. A later demo seed for the Playwright suite left 10 users on `homigo_test` and still 0 bookings, 0 payments, 0 services.

| Step | Result |
|---|---|
| Expired access token | 401 `UNAUTHORIZED` |
| Token signed with the same secret, not expired | `GET /api/user/me` 200 |
| Create | 201, id `cmuthjlc51m4ptz1wlpzyw4dh`, `finalAmount` 550 |
| Same Idempotency-Key | 200, same id, `replayed` true |
| Client abort, immediate retry | 409 `IDEMPOTENCY_IN_PROGRESS` |
| Retry after 2.5s | 200, `replayed` true, one row for that slot |
| Payment body `amount: 1` | create-order charged 55000, verify 200 |
| Offer | job `DISPATCHED`, 1 attempt, partner pending list count 1 |
| Accept | 200 "Booking accepted" |
| Complete before start | 400 `INVALID_STATUS` |
| En route / arrived | both 200 |
| Start with no PIN | 400 `OTP_REQUIRED` |
| Issue PIN | 200, channels `app` and `email`. The partner response has no PIN |
| Customer `GET /start-pin` | 200, state `active`, PIN length 6 |
| Partner `GET /start-pin` | 404 `NOT_FOUND` |
| Start with `000000` | 400 `OTP_INVALID` |
| Start with the customer PIN | 200 "Job started". Row `IN_PROGRESS`, `startedAt` set, `startOtpVerifiedAt` set, provider is the fixture provider |
| Second start | 200. Status stayed `IN_PROGRESS` |
| Complete | 200 "Job completed" |
| Second complete | 200 |
| Customer `GET /bookings/:id` | status `completed`. Payload scan found no `matchingScore`, `candidateRank`, or `walletBalance` |

This service fixture has no quality checklist, so completion did not exercise a checklist refusal. `p10-s11-cases.test.ts` still covers a waived follow-up at 0 and a quoted follow-up refused as `OWNER_APPROVAL_REQUIRED`. `dispatch-must-include.test.ts` still shows a pinned partner who failed matching is not inserted. Those four files together: 44 pass / 0 fail.

`adb devices` printed an empty list. `ANDROID_HOME` points at an SDK that has `platform-tools\adb.exe` and no `emulator\emulator.exe`. No AVD directory. Partner mobile stays EXTERNAL.

Partner Web Playwright, serial, `E2E_SKIP_SERVERS=1`, `E2E_API_URL=http://127.0.0.1:3100`, `E2E_PARTNER_URL=http://127.0.0.1:3016`:

```
45 passed
20 failed
3 did not run
exit 1
about 1.0h
```

The first cookie-session login passed. Failures include the dashboard request timing out, onboarding resume stuck on a skeleton, several viewport jobs not reaching `job-detail-page`, the live Offer-to-Complete seed throwing "No active service" because `homigo_test` has no catalogue, and finance, trust, referral, and notification matrices. Those 20 are not converted to pass. The temporary partner server was stopped after the suite.

## 14. Closure loop — partner job on the isolated stack

Date: 2026-10-04. Temporary Partner Web on `:3016` (`BACKEND_ORIGIN` and the browser API both `http://127.0.0.1:3016`, proxy to `:3100`). `/health` on `:3100` reported `isolatedDatabase: true`. `:3000` stayed `isolatedDatabase: false` and was not booked. The temporary server was stopped afterwards. The one-off scripts and spec used to drive this path were deleted.

Fixture tag `p10neg` lived only in `homigo_test`. Customer booking `cmutfkbpq1lqitz1w39b9y0b6` was already paid: `finalAmount` 550, `finalAmountPaise` 55000, `paymentStatus` SUCCESS, `providerId` null, assignment job DISPATCHED, one attempt.

| Step | Result |
|---|---|
| Partner login in Chromium | `POST /api/auth/login` 200 on port 3016. Filling the email before React 19 hydration left the controlled state empty, so the first clicks never called the API. Waiting for the input's value tracker, then `fill`, submitted. |
| Offer list | `/requests` showed "Adv Service adv-p10neg". |
| Accept | `POST /api/bookings/cmutfkbpq1lqitz1w39b9y0b6/accept` status under 300. |
| One winner | `homigo_test`: booking `ACCEPTED`, `providerId` `cmutfk9360027tz40umaksny2`, one attempt, that attempt `ACCEPTED`. |
| Second accept, same partner | HTTP 200, message "Booking already accepted", `newlyAccepted` false. Attempt count stayed 1. |
| Job page | Service name, status Accepted, brief "Expected 1 hr", "Next: On my way", Lifecycle, phone `+91 •••• 1030`. Body text had no matching-score or candidate-rank copy. Call control read "unavailable" and was disabled. |
| En route | Button "On my way" → `POST /en-route` under 300. Column `status` became `EN_ROUTE`, `enRouteAt` set. |
| Arrived | Chromium geolocation set to the fixture address (28.62, 77.37). "I've arrived" → `POST /arrived` under 300. `arrivedAt` set. Booking `status` stayed `EN_ROUTE`. That is the existing contract in `tracking.service.ts`: arrival writes `arrivedAt` and does not change booking status. `GET /actions` then reported `jobState` ARRIVED and `primaryAction` START_SERVICE. |
| Start | Not run. The start PIN is sent to the customer and is not returned on the partner API. |

Partner booking JSON keys for the customer were `firstName`, `lastName`, `profileImage`, `phoneMasked`. A scan of that payload for matchingScore, score, wallet, razorpay, internalKey, candidateRank, and eligibility matched nothing. `amount` 500 and `finalAmount` 550 are the job totals the partner screen already receives.

`homigo_test` before cleanup: 7 users, 2 bookings, 1 service. After `cleanupAdversarialFixtures("p10neg")`: 0 users, 0 bookings, 0 services. Prisma for that cleanup used only `.env.test`. An earlier read that also loaded `.env` connected to `homigo_db` and was refused before any write.

### Return path and booking negatives

`sanitizeOAuthReturnUrl` now rejects a protocol-relative `//` target and auth routes. `apps/web/tests/return-url.test.ts`: 1 pass, 5 expects. Login and the signed-in middleware redirect both use it.

HTTP negatives against `:3100` only, no 500: unauthenticated booking 401, garbage bearer 401, missing address 400, invalid address id 400, invalid service id 400, past slot 400, quantity 0 and 1001 400, unknown variant 400, inactive service 400 `SERVICE_UNAVAILABLE`, second create on a taken slot 409 `OVERLAPPING_BOOKING`. A body with `finalAmount: 1` still persisted 550 / 55000. `POST /api/payments/create-order` with `amount: 1` charged 55000. A second verify on an already-SUCCESS payment returned 409.

Not run in that earlier note: a structurally valid expired JWT, and a dropped network during create. Section 15's table already records both. Those two sentences disagreed; the table is the evidence.

## 16. Partner Web failure triage

Date: 2026-10-04. Isolated API restarted on `:3100` after the previous process exited. `/health` reported `isolatedDatabase: true` and the boot log named `localhost:5433/homigo_test`. Partner Web was restarted on `:3016` with `BACKEND_ORIGIN=http://127.0.0.1:3100` and `NEXT_PUBLIC_API_URL=http://127.0.0.1:3016`. `:3000` was not booked.

The 20 failures and 3 not-run tests from the 45/20/3 command:

| Test | First point | Class | What happened after |
|---|---|---|---|
| `provider-enterprise` login → dashboard | `waitForResponse` for `/api/providers/me/dashboard` never saw 200 within 60s | TEST HARNESS | React 19 hydration cleared the login fields, so Sign in did not post. `partnerLogin` now waits for `#partner-email`'s `_valueTracker`, then types. Isolated rerun: 1 passed (29.7s). The three later tests in that serial file had not run; they passed in the next multi-file run. |
| `p0-partner-onboarding` resume after refresh | `.animate-pulse` stayed visible | ENVIRONMENT | Isolated rerun on a warm dev server: 1 passed (14.2s). The skeleton is `bootPhase === "loading"`. It left loading once the progress request returned. |
| `p2-availability` command center and web a11y | `partnerLogin` waiting for `/api/user/me` | TEST HARNESS | Same hydration wait. Both passed in the 46-test rerun. |
| `section03-a11y-responsive` seven widths | `job-detail-page` not found | TEST HARNESS | Isolated 390px passed (23.7s) and isolated 1920px passed (30.5s). In a file run the second test stayed on the server-rendered auth spinner because Next dev aborted `main-app.js` (`net::ERR_ABORTED`). `recoverDevChunkAbort` reloads once when that spinner or a truncated-payload overlay is still up. The file then passed 13/13 (6.5m), and the same widths passed again inside the 68-test command. |
| `section03-live-job-execution` | seed threw `No active service` | FIXTURE | `homigo_test` had no active service. `section03-seed-live-job.ts` now creates `s03-live-cert-service` on the declared test database only. Seed printed `script-target` `homigo_test` and booking `cmutlbfg00005tzqo6e5jy63h`. The spec passed (28.2s), including accept, en route, arrived, customer `start-pin`, partner PIN entry, chat, and complete. It passed again as test 38 of the 68-test command. |
| `section04-a11y-responsive` finance matrix | no `h1`, then a 600s timeout | ENVIRONMENT | One screenshot was Next's `Unexpected end of JSON input` overlay (truncated RSC payload). Section 05's 36-navigation matrix passed. This matrix is 60 navigations and needed 13.9m. Timeout raised to 20 minutes to match that cost. Isolated rerun: 1 passed (13.9m). It also passed as test 40 of the 68-test command (the file was marked slow at 11.1m). |
| `section04-finance` wallet → payouts | `partnerLogin` until the 180s test timeout | ENVIRONMENT | Screenshot: `ChunkLoadError` loading `app/layout.js`. The same test passed in an earlier 46-test run and again alone: 1 passed inside a 2-passed / 47.2s command. `recoverDevChunkAbort` now also reloads on `Loading chunk`. |
| `section05-a11y-responsive` matrix | heading `/documents/i` not found | ENVIRONMENT | Same auth spinner under dev-server load. Later command: the matrix passed (the file was slow at 9.5m, then 7.8m inside the 68-test command). The axe test in the same file passed. |
| `section05-trust` SOS | waited 45s for `/api/providers/me/wellbeing` | ENVIRONMENT | The page never left the auth spinner, so the query never started. Later command: the test passed. |
| `section06` 768 and 390 | overflow test never reached the page | TEST HARNESS | Same login helper. All 12 widths passed inside the 68-test command (tests 50–61). |
| `section07-referral` | login helper | TEST HARNESS | Passed in the 46-test rerun and again as test 62 of the 68-test command. |
| `section09-notifications` matrix | heading `/notification/i` not found | ENVIRONMENT | The page's `h1` is "Notifications". Under load the shell stayed on the auth spinner until the 240s budget died. Timeout set to 600s, matching the other matrices. Later command: the matrix passed (file slow at 5.2m). |

The 68-test command (`npx playwright test --reporter=line`, one worker, `E2E_SKIP_SERVERS=1`, `:3016` → `:3100`) ended:

```
63 passed
3 failed
2 did not run
exit 1
50.1m
```

The 3 failures were Flow A+B (below), the finance wallet login (chunk timeout, rerun passed), and sign-off login. Sign-off is serial, so route center and completion tab did not run. Those three sign-off tests then passed in a 4-passed / 1.3m command.

Flow A+B failed because the live-job seed had created the only active service, `S03 Live Cert Service`. `partnerOnboardingOptions` uses the compatibility list (which includes the label Electrician) only when the catalogue is empty. The services step showed one checkbox, "S03 Live Cert Service", and the test waited out its 180s on `getByText("Electrician")`. The seed now also upserts an active service named Electrician with slug `electrician`, on `homigo_test` only. An upsert in this loop printed `electrician upserted on homigo_test`. Flow A+B then passed.

`PartnerProviders` subscribes to persist hydration before checking `hasHydrated`, and calls `rehydrate()` if hydration has not finished. The previous order could miss the hydration event and leave `PartnerAuthGuard` on its spinner.

`adb devices` was empty again. `emulator.exe` is still absent. Partner mobile stays EXTERNAL.

Preferred provider, quoted follow-up, and the emergency sentence were not changed. The earlier 44/44 contract run still stands: a pinned partner who failed matching is not inserted, and a quoted follow-up stays `OWNER_APPROVAL_REQUIRED`.

The 63/3/2 command above is history. Section 17 is the later single 68/68. Production was not entered.

## 17. Single 68/68 and the isolated customer booking

Date: 2026-10-04. API `GET http://127.0.0.1:3100/health` had `isolatedDatabase: true`. Partner web `:3016` proxied login validation to that API. `:3000` was not booked.

Partner Web, one worker, one command:

```
68 passed (37.3m)
exit 0
```

Two earlier full commands in the same day were not this result: 65 passed / 1 failed / 2 did not run (sign-off ChunkLoadError on `app/layout.js`), then 67 passed / 1 failed (availability reload left the auth spinner at 360px). The sign-off failure was a dev chunk timeout after a long run. Recovery now fetches the failed chunk before reloading, and `onDemandEntries` keeps compiled pages for the length of a dev suite. The availability reload waits for the heading or a stuck auth spinner and reloads once. Both files then passed inside the 68.

Customer web `:3017` used `BACKEND_ORIGIN=http://127.0.0.1:3100` and `NEXT_PUBLIC_API_URL=http://127.0.0.1:3017`. `e2e/signoff-journey.spec.ts`: 3 passed, exit 0, 2.4m. The book page listed S03 Live Cert Service and Electrician, the default address was Gurugram, a server slot was selected, and the confirmed heading rendered. `GET /api/users/bookings` then showed booking `cmuu36iv308dktz3ke7oui8ui`, status `pending`, payment `success`, amount 550. The quote for a Gurugram address is 550 / 55000 paise. A Noida address is refused with `SERVICE_NOT_AVAILABLE`. The test services now include Gurugram because that is the customer fixture city; Mumbai and Bengaluru stay on the rows.

The same hour, with `bun test` on `.env.test`:

| File | Result |
|---|---|
| `customer-visit.test.ts` | 10 pass, including the emergency line (stored phone kept, no number invented) |
| `dispatch-must-include.test.ts` | 20 pass, including an ineligible pin excluded and an eligible pin moved first |
| `p10-s11-cases.test.ts` | 11 pass, WAIVED amount 0, QUOTED `OWNER_APPROVAL_REQUIRED` |
| `p11-matching-gates.test.ts` | 13 pass |
| `preferred-provider-contract.test.ts` | 3 pass |
| `broadcast-accept-gate-context.test.ts` | 1 pass, 10 concurrent accepts, exactly one winner |

A fresh access token signed with the API's secret returned `GET /api/user/me` 200. The same claims with `exp` ten seconds in the past returned 401 `UNAUTHORIZED`. A garbage bearer was also 401. `adb devices` listed no device.

Phases stay OPEN. The paid customer booking and the partner Offer-to-Complete inside the 68 are not one booking. Partner mobile stays EXTERNAL.

## 18. Same booking, both browsers

Date: 2026-10-04, isolated stack only. `GET http://127.0.0.1:3100/health` reported `isolatedDatabase: true`. Partner web `:3016` and customer web `:3017` proxied to that API. Database name from the test script was `homigo_test`. `:3000` was not booked. No production storage was written.

Customer Chromium booked Electrician at Indiranagar, Bengaluru. Partner Chromium, geolocated at the last accepted fix 12.9717, 77.5947, accepted that offer, entered the customer's start PIN, and completed the job. The customer list then showed Done, Service finished, and ₹550 for that id.

Command, from `apps/web`, one worker:

```
npx playwright test e2e/phase10-11-same-booking.spec.ts --reporter=line
```

`E2E_SKIP_SERVERS=1`, `E2E_API_URL=http://127.0.0.1:3100`, `E2E_WEB_URL=http://127.0.0.1:3017`, `E2E_PARTNER_URL=http://127.0.0.1:3016`.

```
1 passed (2.5m)
exit 0
ended 2026-10-04T19:17:39Z
```

| Field | Value |
|---|---|
| Booking | `cmuu7d3i9093btz3k4v9a6nfc` |
| Number | `HOMIGO-20261004-00012` |
| Status | COMPLETED |
| Payment | SUCCESS, 1 payment row |
| Amount | 550 |
| Provider | `cmuthr6my0021tzn8dujbdyyt` |
| Assignment | one job, one attempt, status ACCEPTED |
| Started | 2026-10-04T19:17:23.389Z |
| Completed | 2026-10-04T19:17:24.873Z |
| Slot | 2026-10-06T06:30:00.000Z (one booking on that slot) |

The electrician completion did not exercise a quality-checklist refusal. That refusal remains on the earlier case tests. Evidence, preparation, safety, and execution panels are not claimed for this service: the completed job page rendered `job-detail-page`, `job-brief`, `job-evidence-panel`, and `quality-panel`. It did not render `job-preparation`, `safety-panel`, `execution-steps`, or `completion-checklist`.

Customer readback was a fresh `/bookings` load plus `GET /api/bookings/:id`. Intermediate live-channel events were not injected.

### Network drop

The book page now sends one `Idempotency-Key` per confirm attempt and keeps it when the browser loses the connection. A controlled run fetched `POST /api/bookings` on the API, then aborted the browser connection. The page showed "Failed to fetch" and did not show success yet. The next confirm reused the key. The response was an idempotent replay, payment verified, and the heading was Booking confirmed.

Booking `cmuu963bt0be8tz3kzjqy3tg7` on `homigo_test`: status PENDING, payment SUCCESS, amount 550, payments 1, same slot 1, idempotency keys 1 COMPLETED, one SENT offer. The Playwright command for that run then exited 1 because it looked for the id in a list shape the API does not return. Later commands with the assertion corrected did not exit 0: the visible weekday chips were already taken, and typing `2026-10-14` did not yield an enabled chip. The product checks and the row counts above are the evidence. The spec file's last command is not a green run.

### Session, price, and catalogue

A one-off probe against `:3100` on `homigo_test` exited 0 and was removed afterward. Valid access token 200. Expired, wrong signature, tampered payload, malformed, missing, refresh-token-as-access, and an access secret with `type: refresh` were 401 `UNAUTHORIZED`. An expired token's cancel left `cmuu7d3i9093btz3k4v9a6nfc` COMPLETED / SUCCESS / 550. Issuer and audience are not checked by `verifyAccessToken`. Partner `GET /start-pin` was 404 and returned no PIN. Electrician detail was 200 with no execution, safety, quality, warranty, matching, requirements, or trust blocks. Invalid service, missing address, invalid address, and a past slot were 400. `packagePrice: 1` with a quote for 550 was 400 `INVALID_PACKAGE_PRICE` and persisted nothing.

### Partner accessibility

`npx playwright test e2e/phase11-job-a11y.spec.ts --reporter=line` from `apps/partner-web`, exit 0, 35.9s, ended 2026-10-04T20:17:21Z. Login keyboard order reached email then password. axe serious/critical was clean on login, the dashboard, the job list, and job `cmuu7d3i9093btz3k4v9a6nfc` at 1280, 768, and 390. Fixes required to get there: the New badge and Reject control on the dashboard card, the New request pill, the Appearance button's name at 390px, and the mobile tab label color. The four panels listed above as absent were not axe-tested.

### Contracts re-run this loop

| File | Result |
|---|---|
| `customer-visit.test.ts` | 10 pass, emergency line keeps a stored number and invents none |
| `dispatch-must-include.test.ts` | 19 pass, eligible pin moves first, missing pin stays out |
| `preferred-provider-contract.test.ts` | 3 pass, soft preference, quoted rework refused |
| `p10-s11-cases.test.ts` | 12 pass, WAIVED is 0, QUOTED is `OWNER_APPROVAL_REQUIRED` |

Matching source was not changed, so the earlier 10-way one-winner run was not repeated. `adb devices` was empty. No emulator binary. Partner mobile stays EXTERNAL.

The full Partner Web command was not repeated after the accessibility edits. Phases stay OPEN.

# HOMIGO CODING-PHASE ENTERPRISE OPERATIONAL CERTIFICATION

Run: 2026-09-27 → 2026-09-28 (IST), branch `cursor/stage-e-step-13-certification`, uncommitted working tree.
Scope: coding / integration-testing phase only. This document does **not** certify production deployment, live
Razorpay behaviour, live closure A–G, production migrations, or any owner-controlled business decision.

Evidence labels used on every claim:

- **SOURCE** — read in code.
- **TEST** — an automated suite run on the isolated test database `homigo_test`.
- **RUNTIME** — a real, separately started process driven over HTTP / WebSocket / a real browser, against `homigo_test`.
- **LIVE READ-ONLY** — one observation only: an alert state read from the local Prometheus that scrapes the dev backend. `homigo_db` was never queried or mutated by this certification.

Raw evidence (logs, JSON) is kept outside the repo in `D:\homigo-cert\` (see §26).

## 1. EXECUTIVE STATUS

**Final status: CODING-PHASE OPERATIONAL CERTIFICATION INCOMPLETE.**

What the evidence shows:

- The backend, customer web, partner web and admin panel work as one integrated system on production builds against an isolated backend. A customer can book, pay through the real Razorpay TEST checkout inside the app, see the confirmation, cancel and be refunded. **RUNTIME**
  - The partner lifecycle runs end to end over HTTP: presence → accept → en-route → arrived → PIN start → complete → earnings credited. **RUNTIME**
  - Admin operations are authorized, validated and recorded. **RUNTIME**
- The final tree's full backend regression is green: **3,830 pass, 0 fail, 10 skip across 315 files.** **TEST**
- The cross-process runtime probe passes **65/65**, and the real Razorpay TEST suite passes **8/8**. **RUNTIME / TEST**
- Failure and recovery hold. Chaos runs 7C, 7C-latency, 7D, 7E, 7G and 7H meet their invariants once my own interference is removed: Redis hard-down and frozen, outbox burst/lease/duplicate delivery, scheduler leadership, realtime, and crash/restart. **RUNTIME**
- Money invariants hold across the whole test ledger: 0 unbalanced journals, 0 orphan lines, 0 paise mismatches, 0 duplicate keys, 0 negative wallets, 0 over-refunds, 0 duplicate payout successes. **TEST**

**Four reproducible engineering defects** were found, fixed, landed, regression-tested and proven by break-the-fix (§27):

1. AI prompt-firewall refusals returned the detector's regex to any signed-in user (security).
2. Refunds finished by Razorpay stayed "refund in progress" forever, because the `refund.processed` webhook never moved the booking or payment status (money UX / integration wiring).
3. Booking create answered a transient database-busy condition as a permanent 400 instead of the retryable 429 its sibling route uses (error handling).
4. Four money transactions asked the pool for a second connection while holding a per-user lock. Concurrent requests then deadlocked until timeout and **nobody** was paid. It was not a double payment, but it was a liveness failure (concurrency).

Smallest blockers to COMPLETE (details in §30 and §32):

1. Customer and partner **mobile apps were not run on a device or emulator** (none attached). Only typecheck, unit and startup gates ran.
2. **Owner decision required:** a gateway refund that later fails (`refund.failed` webhook) changes no state (§29).
3. **External provider:** Google Maps web services answer `REQUEST_DENIED` (billing not enabled). Only the fallback is operational.
4. **Notification delivery is unproven:** real SMS needs an owner test number; the email and push providers are not configured.
5. **Booking-create latency under multi-user load** was not measured against the project contract (p95 < 500 ms).

**Environment-safety disclosure** (full detail in §25): the first certification-server run sent `homigo_test` ETL payloads to BigQuery through the developer's gcloud credentials, because my egress preload did not cover that client's transport. Google rejected every write (billing disabled). This was closed by blocking Google Cloud credentials for all later runs and verified at the OS socket level.

## 2. CAPABILITY INVENTORY

Built from the repository (SOURCE):

- **Apps:** customer web (29 pages), partner web (54), admin (108), customer mobile `homigo-mobile/` (165 .tsx), partner mobile `homigo-partner-mobile/` (49 .tsx).
- **Backend:** 52 route modules, 255 services, 5 WebSocket endpoints (`/ws/booking/:id`, `/ws/tracking/:id`, `/ws/notifications`, `/ws/earnings/:id`, `/ws/admin-ops`), 315 backend test files.
- **External providers:**
  - Credentials present in `.env`: Razorpay (`rzp_test_`), Google Maps key, Twilio, weather, S3, Sentry DSN.
  - Absent: any AI model key, BigQuery service credentials (only the developer's gcloud ADC), FCM/Expo push, Resend email.

| # | Capability | Entry points (SOURCE) | Dependencies / flags | Evidence already available | Evidence gathered here |
|---|---|---|---|---|---|
| A | Customer web | `apps/web` (Next 15), `/book`, `/bookings`, `/services` | `NEXT_PUBLIC_API_URL`, `BACKEND_ORIGIN` rewrite | 11 e2e specs, 3 unit files | Prod build; UI journey with real Razorpay; e2e; SEO checks |
| B | Partner web | `apps/partner-web` | same | 21 e2e specs | Prod build; 31/33 e2e |
| C | Admin panel | `apps/admin-panel` | same | 27 e2e specs | Prod build; 34/35 e2e |
| D | Customer mobile | `homigo-mobile/` (Expo 54, RN 0.81) | native modules, dev build | CI: typecheck + startup gate | tsc, startup gate, logic tests, Jest |
| E | Partner mobile | `homigo-partner-mobile/` | — | tsc | tsc, unit tests |
| F | Backend/API | `apps/backend/src/index.ts` (Elysia/Bun) | Postgres, Redis | 311→315 test files | Isolated runtime server, probes, perf |
| G | Auth/session | `routes/auth.ts`, `refresh-token.service`, `ws-connection-auth` | JWT, HttpOnly refresh cookie | auth suites | Runtime probe 13 auth checks |
| H | Bookings/services | `routes/bookings.ts`, `booking.service` | quote engine, slot exclusion | 35 booking-area files | Runtime lifecycle, idempotency, overlap |
| I | Payments/refunds/wallet | `routes/payments.ts`, `wallet.ts`, `refund-orchestrator`, `refund-ledger-sync` | Razorpay TEST | 48 payment-area files | Real Razorpay TEST suite, UI refund, webhook |
| J | Partner operations | `routes/providers.ts` (presence, eligibility), accept/start/complete | presence, GPS, PIN | 40 partner-area files | Runtime lifecycle |
| K | Geo/Maps/ETA | `routes/geo.ts`, `maps.service`, web loader hooks | Google Maps (billing) | loader unit tests | Runtime maps probe, direct Google diagnosis |
| L | Notifications/OTP/email/push | `notifications`, `otp.service`, `booking-start-otp.service` | Twilio, Resend, FCM | 4 notif files | Runtime inbox, SMS barrier, e2e |
| M | Realtime | `websocket/*.ws.ts`, `lib/websocket.ts`, `lib/booking-realtime.ts` | Redis pub/sub fan-out | 5 files | Runtime WS probe, chaos 7G |
| N | Outbox/events | `events/core/outbox-processor.ts` | `EVENTS_OUTBOX_ENABLED`, `EVENTS_CONSUMERS_ENABLED` | 9 files | Chaos 7D, 7C I7 |
| O | Scheduler/automation | `lib/distributed-scheduler.ts`, `events/core/job-processor.ts` | Redis lease, PG advisory fallback | 17 files | Chaos 7E, 7H |
| P | AI gateway/brain/memory | `routes/ai.ts`, `ai-gateway.routes.ts`, `ai/gateway`, `ai-brain` | provider keys (none) | 15 AI files | Runtime firewall/RBAC; disclosure fix |
| Q | AI tools/approvals/audit | `routes/ai-tools.routes.ts`, `ai-tools/execution` | approvals, NO_HANDLER fail-closed | suites | TEST (in-process routes) |
| R | Analytics/ETL/BigQuery/ML | `analytics-etl.service`, `mlops`, ETA label sync | BigQuery (billing disabled) | memory: ETL dead since 2026-08-19 | Runtime logs (billing refusal) |
| S | Fraud/risk | `trust-safety`, `referral-fraud`, fraud routes | — | 8 files | Admin trust e2e; referral risk path runs |
| T | Finance/ledger/reconciliation | `financial-ledger`, `financial-integrity`, reconciliation | — | many suites | Whole-ledger invariants, chaos 7J |
| U | Admin/RBAC/platform controls | `admin*.ts`, `admin-rbac` | RBAC roles | 14 files | Runtime RBAC refusals, admin e2e |
| V | Observability | `/metrics`, request-context, audit log, Prometheus/Alertmanager | Sentry (prod/staging only) | 11 files | Runtime metrics, 116 alert rules, audit rows |
| W | Feature flags/config | `platform_feature_flags`, env-driven config | — | P11 flag tests | TEST |
| X | Database/migrations | `prisma/schema.prisma`, 147 migrations | Postgres 16 | schema checkers | Scratch-DB migrate deploy, contract, drift |
| Y | Security controls | auth, RBAC, rate limit, webhook HMAC, PII, egress | — | 14 files | Runtime refusals, fixes |
| Z | Performance/resources | load harnesses, pool config | contract p95<500ms p99<1200ms (`scripts/load-test/k6/lib.js`) | prior audits | 7A baseline, write-path probe |

## 3. CUSTOMER WEB

Production build: `next build` passed (lint + type validation, 188 kB shared first-load JS) and served by `next start` on :3011, pointing at the isolated backend. Rewrites were rebuilt with `BACKEND_ORIGIN=127.0.0.1:3100` so no request could reach the dev database. **RUNTIME**

UI journey on the production build, **13/13 steps passed** (RUNTIME, real browser, real Razorpay TEST):

1. Login through the real form → 200. No token is present in `localStorage` (by design, tokens are memory-only with an HttpOnly refresh cookie).
2. `/book?service=…` → package, date, time → the summary shows the **server** total ₹550 (₹500 + 10% tax).
3. Confirm → booking 201 → create-order returns a **real** Razorpay TEST order (`order_Th8e1f7Hyswewm`, 55,000 paise).
4. Razorpay checkout opens inside the app with the TEST ribbon; contact entered; Netbanking → SBI → TEST demo bank "Success".
5. The app verifies the signature (200), and the heading "Booking confirmed" appears.
6. `/bookings` lists the booking; the detail view offers Cancel; cancel → 200, `refundAmount: 550`, "Free cancellation — full refund".
7. The UI shows "₹550 refund initiated — typically reflects in 5–7 business days".

Database readback: payment REFUNDED at 55,000 paise; refund request COMPLETED with `rfnd_Th8etsfOs3yeJ3`; exactly one refund journal. **TEST**

Other checks:

- `/`, `/services` and `/login` return 200; an unknown path returns **404**. The home page has a title, meta description, `<link rel="canonical">` and 2 JSON-LD blocks. **RUNTIME**
- Existing e2e on the production build: **11 passed, 6 failed, 33 did not run.** **TEST**
  - Section04/05/09 (3 specs, 4 failures): the shared fixture still injects a version-0 `homigo-auth` localStorage session with tokens. The app is version 2 and deliberately ignores stored tokens, so those pages render signed out. This is a **test-fixture defect**; the product's refusal is correct.
  - `signup-otp-booking`: signup and OTP (dev OTP; real SMS refused at the barrier) reached `/book`. The spec then expected an immediate Confirm for a default service, but `homigo_test`'s fixture-polluted catalogue preselected a variant-heavy one. **Data-dependent.**
  - `services-catalog`: the first data-dependent test failed and serial mode skipped the other 33. On a retry excluding it, test 2 failed on catalogue content missing from `homigo_test`.
  - The curated taxonomy lives only in the dev DB. This matrix (routing, SEO, axe, 360–1440 px overflow) was **not re-run** here; it belongs to the already-verified Phase 2 area. **NOT PROVEN in this run.**
- Unit tests: 38/0 (includes the Maps loader). **TEST**
- Client request hygiene, non-blocking (§31):
  - `GET /api/bookings/availability?serviceId=service-unavailable` → 404 (twice per `/book` load).
  - The initial `price-quote` → 400.
  - Tracking and ratings are polled before assignment (404).
  - Navigation-aborted fetches are logged as "backend unreachable".
- The rate limiter (about 36 unauthenticated requests/min/IP) is tripped by a single anonymous visitor on the test DB. The catalog fetcher walks up to 20 pages of 100 services, and `homigo_test` holds 9,615 fixture-inflated public services. This is a **test-data artifact**: a real-size catalogue needs one page. UI runs therefore used `LOAD_TEST_MODE=1`; the limiter itself is proven in §9. **RUNTIME**

## 4. PARTNER WEB

- Production build passed (188 kB shared). The first attempt failed on a transient DNS error for `fonts.googleapis.com`; the retry passed. **RUNTIME**
- Existing e2e on the production build: **31 passed, 2 failed.** **TEST**
  - `section03-a11y-responsive`: an axe colour-contrast violation, 4.46:1 on a success button. The token `--color-partner-success` is `#15803d` (≈5.0:1, passes AA). The measured `#258849` is that token blended with about 6% white, i.e. sampled mid-animation. **Two reruns alone passed 13/13 each.** Timing-dependent, not a design defect.
  - `presence-heartbeat-timer`: the spec runs `bun --env-file=.env run scripts/mint-partner-web-session.ts`, which targets the **dev database**. It was excluded by design (it failed before executing, `spawnSync bun ENOENT`). No `homigo_db` effect.
- Partner workflow over real HTTP from a separate process, all passing (RUNTIME, cross-process probe):
  - presence heartbeat with location → go online → dispatch eligibility;
  - **accept** (a duplicate accept is idempotent: `newlyAccepted:false`) → en-route → arrived at the address;
  - start-PIN issued (visible only to the customer) → a wrong PIN is refused → start with the customer's PIN;
  - complete → booking COMPLETED → an earning row CREDITED (net 44,000 paise);
  - booking-room WebSocket frames delivered to the customer throughout;
  - cancelling a COMPLETED booking is refused;
  - a customer calling partner accept is refused (403).

## 5. ADMIN

- Production build (a D: copy without `.env*`) passed (228 kB shared). **RUNTIME**
- Existing e2e on the production build: **34 passed, 1 failed.** The failure needs a GPS-spoof risk profile seeded by an earlier live certification; `homigo_test`'s first profile is a signal-less LOW. **Data-dependent.** **TEST**
- Covered by those 34: login, dashboard, the admin journey, sign-off, RBAC navigation permissions, finance, accessibility, the 320 px responsive audit, hardening features, trust. **TEST**
- Excluded by design: `section10-mutation-audit` and `presence-roster-production` both shell out to `.env` (the dev database).
- Privileged actions over HTTP (RUNTIME):
  - admin cancel with a 1-character reason → 400 (validation);
  - a customer using admin cancel → 403;
  - admin cancel of an unpaid booking → 200, status CANCELLED, **₹0 refund**, status-history rows written;
  - a support admin issuing a payment refund → 403;
  - finance refunding beyond the refundable amount → refused (422, no over-refund).

## 6. CUSTOMER MOBILE

- `npx tsc --noEmit`: **0 errors**. **TEST**
- CI's own mobile gate (`scripts/startup-regression-ci.mjs`): **16 pass / 0 fail.** **TEST**
- Logic tests (`bun test`, 5 files: auth refresh coordinator, offline queue, booking quote, tracking frames): **31/0**. **TEST**
- Jest (not part of CI): **23 pass / 11 fail.** Every failing file is **untracked, uncommitted work in progress**. **TEST**
  - Two files are picked up by the wrong runner (they import `vitest` and `bun:test`).
  - `feature-flags-store` (10 tests): `renderHook(...).result` is undefined, a testing-library mismatch.
  - `AiChatScreen` (2): the tests only type text and never press Send, yet expect `sendText` to have been called — a **test defect**.
  - `AiConversationsList` (2): one expects "1h ago" but the component renders "just now"; not resolved.
- **On-device runtime NOT PROVEN:** no Android device or emulator was attached (`adb devices` is empty). Authentication, booking, payment, maps, realtime, deep links and 360-width layouts were not exercised on the actual app.

## 7. PARTNER MOBILE

- `tsc`: **0 errors.** Unit tests (auth refresh, booking status, job action policy, location ping queue, offers, realtime events and reconnect backoff): **37/0**. **TEST**
- **On-device runtime NOT PROVEN** (no device attached).

## 8. BACKEND/API

- An isolated runtime server on :3100 was started as a separate process: `homigo_test`, isolated Redis :6380, `NODE_ENV=development`, `APP_ENV=chaos`. An egress preload allowed only `api.razorpay.com` and the Google Maps hosts, and refused and logged everything else. `/health` reports `isolatedDatabase: true`. **RUNTIME**
- Cross-process runtime probe on the final tree: **65/65** — auth 13, RBAC 6, catalogue 3, pricing 2, booking 6, security 2, realtime 4, payments 5, partner 12, refund 2, notifications 1, admin 3, AI 2, observability 3, environment 1. **RUNTIME**
- Full regression: **3,830/0/10 skip, 315 files** (§11). **TEST**

## 9. AUTH & SECURITY

All RUNTIME, cross-process against :3100:

- Login 200. A wrong password and an unknown email return the **identical** 401 body (no account enumeration).
- Brute force on one account is throttled with 429 on the 6th attempt.
- A tampered JWT gets 401. Every response carries `x-request-id`.
- Refresh:
  - rotation issues a new token;
  - a replay **inside the documented 20 s grace window** returns the *same* successor (the concurrent-tab contract, `ROTATION_GRACE_MS` — SOURCE);
  - a replay **after** the window is refused (401), and **the whole token family is revoked**, so the new token also dies.
- Logout revokes the access token immediately.
- WebSocket without a token → 4401. Another customer's booking room → 4403.
- IDOR: another customer reading or cancelling a booking → 404.
- Rate limiter: 429s under burst (the authorization probe tripped it with LOAD_TEST_MODE=0). It still refuses with **Redis hard-down and with Redis frozen** (7C/7C-latency).
- Webhook: a missing, garbage or plausible-hex signature → 401 `INVALID_SIGNATURE`. A correctly signed webhook is processed, and a replay is ignored as `DUPLICATE_EVENT`.
- Payment tampering: forged `finalAmount`/`price`/`discountAmount` are ignored (the server total is kept); the client `amount` on create-order is ignored (the order charges the booking total, 55,000 paise); a forged payment signature → 400.
- AI: without auth → 401. A prompt-injection "refund to my wallet" message → refused with PROMPT_BLOCKED, and **the wallet stays at ₹0**.
- **Defect fixed:** the PROMPT_BLOCKED error text previously exposed `injection_pattern:<first 40 chars of the matching regex>` to any signed-in user. It now returns a generic message; the reason stays in audit, timeline and logs (§27). **RUNTIME + TEST**

## 10. BOOKINGS / SERVICES

- Create → 201. The same `Idempotency-Key` retried → **the same booking, exactly one row**. **RUNTIME**
  - Contract divergence (non-blocking): the running server's generic idempotency middleware replays the cached **201** with header `idempotent-replay: true`. The route's own Phase-09 contract (and its in-process test) expects **200** with `idempotent-replayed`. Duplicate safety holds either way; why the in-process test sees the route's answer is unexplained (§31).
- Refused cases:
  - booking a specific partner whose presence is stale → 400 `PROVIDER_UNAVAILABLE`;
  - an overlapping booking for the same customer → 409 `OVERLAPPING_BOOKING`;
  - cancelling a COMPLETED booking → 400;
  - an unknown service → 404.
- The state machine was driven PENDING → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED through supported APIs only. **RUNTIME**
- Quote: server-priced (p95 89–111 ms at 10–25 concurrent). **RUNTIME**
- **Defect fixed:** `POOL_BUSY` (the transaction's retries exhausted on serialization conflicts or pool exhaustion) was returned by booking create as a permanent **400**. It now returns **429 + `Retry-After: 3`**, matching reschedule (§27). **TEST**
- Suites: booking-area files all green in the full run. **TEST**

## 11. PAYMENTS / WALLET / REFUNDS

(RUNTIME = cross-process probe or UI; TEST = in-process suites.)

| Scenario | Result | Evidence |
|---|---|---|
| A wallet-only payment | wallet debit; cancel → wallet refund, no provider call | TEST (real suite B/D) |
| B gateway-only payment | real Razorpay TEST order → checkout → verify 200 | RUNTIME, TEST |
| C split wallet + gateway | ₹200 wallet + ₹350 gateway; refund 20,000 + 35,000 paise = total | TEST (real suite) |
| D successful payment | payment SUCCESS with the provider id; the verify replay does not double-settle | RUNTIME |
| E failed payment | forged signature → 400; payment stays unpaid | RUNTIME |
| F cancellation | UI + API cancel → refund amount per policy | RUNTIME |
| G full refund | ₹550 → Razorpay `rfnd_…`, one journal | RUNTIME (UI), TEST |
| H partial refund | ₹100 partial via admin | TEST (real suite C) |
| I repeated refund | same id, no second provider refund | TEST (real suite C) |
| J ambiguous response | lost response → INDETERMINATE → reconciled CONFIRMED; undelivered → NOT_AT_GATEWAY → retry | TEST (real suite C) |
| K failed provider lookup | 503 and network error → `LOOKUP_FAILED`, payment held, second refund blocked | TEST (real suite C) |
| L refund recovery | stale-refund sweep, lease recovery | TEST, chaos 7D/7H |
| M admin refund | support refused 403; finance over-refund refused | RUNTIME |
| N payment-source tampering | label `wallet` + gateway money → refunded to gateway | TEST (real suite A/F) |
| O unpaid cancellation | ₹0, truthful message, no refund objects | RUNTIME, TEST |
| Webhook `refund.processed` | **was a no-op for booking/payment status; fixed** — now `processed`, money unchanged, replay-safe | RUNTIME + TEST (§27) |
| Concurrent full-balance money ops | **was 0 of 8 succeeding (pool deadlock); fixed** — exactly 1 of 8, money moved once | TEST, chaos 7J K1/K3 |
| `refund.failed` webhook | **changes no state** — refund stays COMPLETED and payment REFUNDED | SOURCE → **OWNER DECISION** (§29) |

## 12. RAZORPAY TEST MODE

- Real suite `razorpay-test-mode.real.test.ts` on the final tree: **8/8**. Egress was 19 GET + 13 POST, all to `api.razorpay.com`, with key prefix `rzp_test_`. **TEST**
- The UI journey used Razorpay's own checkout.js with the TEST ribbon, Netbanking, and the TEST demo bank (`/gateway/mocksharp/`). **RUNTIME**
- Harness fix: the checkout driver waits for `domcontentloaded` plus the demo-bank URL instead of the full load event (Razorpay's third-party trackers exceeded 30 s once). **SOURCE**
- NOT PROVEN: real webhook **delivery** (Razorpay cannot reach a localhost backend). A correctly signed webhook sent to the real route was proven instead.

## 13. MAPS / GEO / ETA

RUNTIME, through the backend's real Maps service with the dev key: **10/14.**

- Passing:
  - authentication required (401); Maps reported as configured;
  - malformed place id → 400 before any provider call; outside India → 400 `OUT_OF_AREA`; invalid coordinates → 400;
  - ETA returns a result; serviceability answers;
  - circuit-breaker state exported; provider calls made.
- Failing — all four are the **external provider**:
  - reverse geocode returns `null`; autocomplete returns 0 predictions; the route falls back to `haversine` with no polyline;
  - a repeated ETA makes a new provider call, so the success-path cache is **NOT PROVEN** (errors are correctly not cached).
- **Root cause, proven by one direct read-only diagnosis:** Google answers `REQUEST_DENIED — "You must enable Billing on the Google Cloud Project"` for Geocoding, Places Autocomplete, Directions and Distance Matrix. → **EXTERNAL PROVIDER REQUIRED** (billing).
- Graceful degradation is proven: no 5xx; ETA served by haversine (4.3 km, 10 min).
- Observability gap: the Maps service logs nothing for `REQUEST_DENIED`, so the outage was silent (§31).
- Loader semantics (`maps_timeout` / `maps_init_failed` / `maps_load_failed`, retry, stale-script replacement): unit tests pass in web (38/0) and partner web (40/0). This is the previously verified Maps loader area and was not reopened. **TEST**

## 14. NOTIFICATIONS

- Persistence: the customer inbox lists 9 notifications with correct types (`payment_completed`, `booking_accepted`, `SERVICE_START_OTP`, `service_started`, `booking_completed`, `refund_processed`, …). **RUNTIME**
- SMS: Twilio is configured and `SMS_ENABLED=true`. Every SMS attempt was **refused at the certification barrier** (5×, `start_otp_sms_failed`), and the business flow still completed. That proves **failure isolation**; real delivery is **NOT PROVEN** (it would text real numbers; it needs an owner-controlled test phone). **RUNTIME**
- Email: no provider key; console transport (`[EMAIL:console]`). → **EXTERNAL PROVIDER REQUIRED.**
- Push: no FCM/Expo credentials. → **EXTERNAL PROVIDER REQUIRED.**
- Claim-before-send and deduplication are covered by suites (green in the full run). **TEST**

## 15. REALTIME

- Runtime probe: unauthenticated → 4401; another user's room → 4403; the owner's room connects and receives **16 frames** across the lifecycle. **RUNTIME**
- Chaos 7G: **15/0**. Handshake auth; channel isolation; the published event is received by the authorized subscriber; **cross-instance room fan-out** through Redis; delivery reaches exactly the intended recipients (**zero** frames to unintended ones); disconnect releases the registry entry; reconnect restores exactly one membership; 25-connection baselines exact. **RUNTIME**
- Delivery contract (SOURCE, `lib/booking-realtime.ts`, `lib/websocket.ts`):
  - frames are published **once, after the transaction commits**, and are **fire-and-forget**;
  - Redis pub/sub fan-out with **no persistence, no acknowledgement, no replay and no global ordering guarantee**;
  - delivery is best-effort, at most once per connection;
  - clients converge by refetching over HTTP, which is authoritative.

## 16. OUTBOX / EVENTS

- Chaos 7D: **all invariants held**:
  - a 300-event burst fully drained, 0 events handled twice, 300/300 receipts;
  - attempts bounded; a redelivery after its receipt is skipped; one receipt despite 4 dispatches;
  - a slow handler is not retried into duplicates; 0 rows stranded;
  - lease recovery completes with one receipt each; backlog and lag are queryable.
  **RUNTIME**
- 7C I7 ("47 rows stranded in PROCESSING" right after the Redis outage) was the harness checking inside the **120 s lease** (`EVENTS_OUTBOX_LOCK_TIMEOUT_MS`). Polled afterwards, it reached **0 PROCESSING within ~2 min**, with all rows reclaimed and published. Converges by design. **RUNTIME**
- The test-DB outbox backlog (10,642 PENDING, oldest 13:36Z) comes from test runs that do not run a processor. It drains at batch 50 per tick. **TEST**

## 17. SCHEDULER / AUTOMATION

- Chaos 7E: **80/0** (leader/exclusive execution, lock expiry, Redis unavailable → Postgres advisory fallback, contenders, duplicate prevention). **RUNTIME**
- Chaos 7H: first run 17/1. B3 "new worker identity after restart" failed because it sampled `locked_by` from **my always-on certification server** (`inst_c1f75cfffe68`, confirmed in that server's own leader-lease log). **Rerun without my server: 18/0.** Crash, restart and convergence are proven. **RUNTIME**
- All pending scheduled jobs are future-dated (484 review requests, 1 agent sweep); none overdue or orphaned. **TEST**
- Workflow step semantics (WAIT/CONDITION/NOTIFICATION/STOP/ESCALATION) are covered by the automation suites in the full run; not re-driven at runtime here. **TEST**

## 18. AI

- **Model inference: EXTERNAL PROVIDER REQUIRED.** No Anthropic, OpenAI, Gemini or Groq key is configured. Gemini counts as configured only when `GOOGLE_APPLICATION_CREDENTIALS` is set (SOURCE `ai/config.ts`).
  - With no provider, the customer chat **degrades to a deterministic matcher before the gateway**: nothing is generated and no tool can run (SOURCE `routes/ai.ts`).
- Governance (RUNTIME + TEST):
  - auth 401; RBAC by role;
  - the prompt firewall blocks injection;
  - **the AI cannot move money**: the injection refund attempt left the wallet at ₹0; tools go through policy → approval → the existing service (ai-tools and section08 governance suites green).
- **Defect fixed:** the detector regex leaked in PROMPT_BLOCKED responses on `/api/ai/chat`, `/api/ai/gateway/chat`, `/api/ai/partner` and `/api/ai/admin` (§27).

## 19. ANALYTICS / ETL / ML

- **IMPLEMENTED:** the scheduled ETL jobs (`etl.booking`, `etl.location`, `etl.eta`), the ML feature backlog drain and ETA label sync run on schedule, retry 3× and log failures. **RUNTIME**
- **Data collection only / not live:** every BigQuery write is refused by Google — "Billing has not been enabled … sandbox mode". → **EXTERNAL PROVIDER REQUIRED.** **RUNTIME**
- **Live trained model: none in the serving path.** ETA is served by Google Maps when billing is on, and by haversine now. The ETA candidate model is offline and not promoted (memory `eta-lifecycle-and-model`; not re-verified). No ML inference is claimed.

## 20. FINANCIAL INTEGRITY

After all certification activity, on `homigo_test` (TEST):

| Check | Result |
|---|---|
| debits = credits (per journal) | 0 unbalanced |
| orphan ledger lines | 0 |
| paise mismatches (ledger) | 0 |
| duplicate journal keys / wallet keys | 0 / 0 |
| negative wallets | 0 |
| over-refunds (1,863 refunded payments) | 0 |
| refund paise mismatches | 0 |
| duplicate successful payouts | 0 |
| non-terminal refunds created during this run | 2 INDETERMINATE, both `late_capture:…pay_p09late…` from the existing `phase09-late-capture-auto-refund` suite (one per full run); none from this certification |
| payments stuck REFUNDING | 0 |
| advisory locks held / idle-in-transaction | 0 / 0 |
| certification fixtures | all 9 run sets removed by the suites' own `cleanupAdversarialFixtures` (0 users left); ledger history not deleted |

`financialIntegrityService.runChecks()` → **FAIL** on three liability comparisons. These are sums across the whole test DB:
- CUSTOMER_WALLET: ops ₹15,06,673.50 vs ledger ₹15,17,581.
- PROVIDER_PAYABLE: ₹4,96,279.20 vs ₹5,07,929.20.
- H-Coin: ₹1,362 vs ₹1,510.

Attributed (RUNTIME chaos 7J):
- **G5:** the gap is caused by direct fixture balance writes.
- **Z4:** chaos moved it by exactly its tracked fixture funding (₹99,855), and **₹0 is attributable to money paths**.
- **Z2:** the whole-ledger reconciliation passes.
- The remainder comes from fixture cleanup deleting users while (by rule) keeping their journals.

Making `runChecks` PASS would require deleting ledger history or posting adjustments, which is an accounting decision (§29).

## 21. DATABASE / MIGRATIONS

All TEST, no production migration applied:

- `prisma validate` passes.
- Schema ↔ client ↔ DB contract (`check-schema-client-contract.ts`) on `homigo_test`: 221 models, 2,997 columns, 151 enums; **0 missing**; 221 models probed with a bare find, 0 failures.
- **Migrations applied from zero** to a disposable `homigo_cert_migrate_test` with `prisma migrate deploy`: **147/147 in 12 s**, then contract PASS (0 never applied, 0 drift) and `check-schema-drift` OK (35 protected migration-only objects present: slot-exclusion constraints, paise triggers, money CHECKs, sequences). The scratch DB was dropped afterwards.
- The Prisma client (built 09-25) is newer than the schema (09-23); no regeneration was needed.
- Connection pool behaviour under concurrency is covered by §22 and the §27 fix.
- Redis-down and frozen behaviour: §23.

## 22. PERFORMANCE / RESOURCES

Contract: `scripts/load-test/k6/lib.js` — p95 < 500 ms, p99 < 1200 ms, errors < 1%.

Chaos 7A baseline on :3100, read-only endpoints (RUNTIME):

| endpoint | worst p95 (100 conc) | worst p99 | errors |
|---|---|---|---|
| health | 46 ms | 46 ms | 0% |
| services | 73 ms | 89 ms | 0% |
| bookings | 217 ms | 230 ms | 0% |
| wallet | 229 ms | 240 ms | 0% |

- Postgres connections flat at 11 under load; RSS 400–510 MB. **Within contract.**
- Write paths (RUNTIME):
  - quote: p95 89 ms at 10 concurrent and 111 ms at 25, 0 errors;
  - booking create: **one customer**, 10/25 concurrent: p95 **778 ms** at 10 and 373 ms at 25, with business refusals (`PROVIDER_UNAVAILABLE` outside partner hours, `OVERLAPPING_BOOKING`, and serialization-conflict `POOL_BUSY`, now 429).
  - This is a pathological single-customer contention case. **Multi-user booking-create latency against the contract is NOT PROVEN.**
- Saturation point: previous audits measured a single-box CPU ceiling of about 120–190 req/s (memory `enterprise-scale-audit`, not re-measured).

## 23. FAILURE / RECOVERY

All RUNTIME:

- **Redis hard-down** (7C): health reports degraded; login and requests still served (12/12, slowest 20 ms); the rate limiter does **not** fail open; the process stays alive; recovery in **1.3 s** with no restart; connections and RSS stable.
- **Redis frozen** (7C-latency, `docker pause`): API p95 46 ms; 80/80 served; logins bounded at about 310 ms from the fallback; flapping 360/360; availability restored **5.6 s** after unfreeze.
- **Outbox consumer stop / slow handler / lease expiry / duplicate delivery** (7D): all held.
- **Process crash** (7H): an abrupt kill leaves no open transaction and no advisory lock; restart becomes healthy with a new identity (18/0).
- **Provider timeout and malformed/failed lookup:** real Razorpay TEST lost-response and undelivered cases, 503 and network error on lookup → safe (§11).
- **Notification failure:** SMS refused → business state committed.
- **Maps provider denial:** falls back to haversine.
- **Realtime disconnect/reconnect:** 7G.
- **Money under concurrency** (7J): H-Coin and referral double-spend prevented, and after the fix exactly one of 8 succeeds; the whole ledger reconciles.
  - 7J scenarios P2–P32, S1, G3, B1 and B2 did **not run** (NOT PROVEN in this run): the harness schedules bookings at `Date.now()+N h`, which lands outside partner hours at 23:40 IST. Covered by the `p0-financial-races` suite (52 tests, green).

## 24. OBSERVABILITY

- Structured JSON logs with `requestId`/`traceId` on every line. `x-request-id` is on every HTTP response. **RUNTIME**
- Security audit rows are written: `FAILED_LOGIN`, `LOGIN`, `LOGOUT`, `WEBSOCKET_CONNECTED` (`activity_logs`). **RUNTIME**
- `/metrics` exposes `failed_login_total`, `http_request*`, `rate_limit_triggered_total`, refund counters and `circuit_breaker_state`. **RUNTIME**
- Prometheus is scraping the dev backend (target up), with **116 alerting rules in 20 groups** loaded. **One is firing:** `FinanceIntegrityFailure` (critical), since 2026-09-27 05:54Z, on the dev backend (`homigo_db`). **LIVE READ-ONLY.** That belongs to live closure and was not investigated here.
- Alertmanager's only receiver is `homigo-cert-webhook`: **no real paging channel** → EXTERNAL PROVIDER REQUIRED.
- Sentry is disabled outside production/staging (`"Sentry disabled outside production/staging"`). Delivery is **NOT PROVEN** in the coding phase by design.
- Gap: Maps `REQUEST_DENIED` is not logged (§13).

## 25. SECURITY

- Controls proven fail-closed: §9 (auth, RBAC, IDOR, brute force, refresh reuse, logout, WebSocket auth, webhook HMAC, price and payment tampering, AI authorization).
- Defects fixed: AI detector disclosure (information leak), and the `POOL_BUSY` status (a retry-semantics bug that also affects abuse handling).
- **Environment safety:**
  - Test DB `homigo_test` only (every harness asserts it). Isolated Redis :6380. Razorpay key `rzp_test_` (the preload exits on a non-test key). No live financial mutation.
  - An egress preload refused, and logged, every host except Razorpay and Maps: Twilio 5× refused, OpenWeather 8×, OSRM 1×.
  - The dev backend on :3000 was stopped and restarted **four times** to land fixes. It is one instance now, the same configuration as before.
- **Disclosure — BigQuery leak:**
  - From 15:29Z to 16:45Z the isolated server's scheduled ETL sent `homigo_test` rows to BigQuery. It authenticated through the developer's **gcloud Application Default Credentials** (`%APPDATA%\gcloud\application_default_credentials.json`). `bigQueryAllowed()` only blocks under `NODE_ENV=test` (SOURCE `lib/bigquery-adc.ts`), and my preload did not cover the client's transport.
  - Google **rejected every write** (billing disabled; 2,064 ETL retry/failure log lines). No AI or Vertex calls were logged.
  - Closed by pointing `GOOGLE_APPLICATION_CREDENTIALS` at a nonexistent file with an empty `CLOUDSDK_CONFIG` for all later runs (plus an `http2` guard). The OS socket table afterwards showed **only** Razorpay (`13.205.14.222`).
  - Implication for the owner: any dev backend with `NODE_ENV=development` and a gcloud login will ship its database to the warehouse once billing is enabled (§29).

## 26. REGRESSION

Final tree = all four fixes landed.

| Suite | Result | Label |
|---|---|---|
| Backend full, normal order | **3,830 pass / 0 fail / 10 skip, 315 files** (511 s) | TEST |
| Backend inject files | 6/0, 7/0 | TEST |
| Backend full, `--randomize --seed=20260927` | 3,711 pass / 119 fail / 10 skip → **all 119 classified** (below) | TEST |
| Real Razorpay TEST suite | **8/8** | TEST |
| Cross-process runtime probe | **65/65** | RUNTIME |
| Customer web UI journey (prod build, real Razorpay) | **13/13 steps** | RUNTIME |
| Web e2e (prod build) | 11 pass / 6 fail (stale fixture ×4, data ×2) / 33 did not run | TEST |
| Partner web e2e (prod build) | 31 pass / 2 fail (a11y timing, reruns 13/13 ×2; `.env`-bound spec excluded) | TEST |
| Admin e2e (prod build) | 34 pass / 1 fail (data-dependent) | TEST |
| Web unit / partner-web unit | 38/0, 40/0 | TEST |
| Customer mobile tsc / startup gate / logic / Jest | 0 errors / 16-0 / 31-0 / 23 pass 11 fail (uncommitted WIP) | TEST |
| Partner mobile tsc / unit | 0 errors / 37-0 | TEST |
| Production builds web / partner / admin | pass (188 / 188 / 228 kB shared), with type validation | RUNTIME |
| Backend typecheck | **0 errors, 1,003 files** | TEST |
| Maps probe | 10/14 (4 = provider billing) | RUNTIME |
| Chaos 7C / 7C-lat / 7D / 7E / 7G / 7H / 7J | 17-1 (lease timing) / all pass / all invariants / 80-0 / 15-0 / 18-0 rerun / 22-2 (fixture gap)-9 NP (clock) | RUNTIME |
| DB contract / migrations from zero / drift | PASS / 147 in 12 s / OK | TEST |

Randomized-order failures:
- **32 files** fail when shuffled and **pass alone in normal order**; alone with the same seed they fail again. That's intra-file order dependence, proven file by file.
- **1 file** (`production-blocker-final`) passes alone in both orders; it reads the globally newest `financial_integrity_runs` row written by another suite.
- The randomized failure set is identical to the pre-fix run except `enterprise-completion-certification` (P2): the reschedule route, failing in setup (`bookingService.create` directly, clock-sensitive slot). It passes alone in order and fails alone when shuffled. **Not caused by the fixes.**

Evidence files: `D:\homigo-cert\` (`final-full.log`, `final-random.log`, `final-rzp.log`, `cert-runtime-final.json`, `ui-customer-journey.json`, `cert-maps.json`, `perf-7a.log`, `perf-writes.json`, `chaos-*.log`, `chaos2-*.log`, `final-invariants.log`, `e2e-*.log`, `cert-egress.log`, `chaos-egress.log`).

## 27. BREAK-THE-FIX

Every fix was developed in an isolated copy (no `.env`, `node_modules` junctioned), proven red → green, mutated back to the old behaviour and shown to fail, restored (hash-checked), then landed byte-identical with the dev backend stopped and restarted.

| Fix | Files | Regression test | Mutation | Result |
|---|---|---|---|---|
| 1 AI blocked-prompt disclosure | `ai/gateway/ai-gateway.ts` (`PROMPT_BLOCKED_PUBLIC_MESSAGE`, `promptBlockedError`, `internalReason`), `ai/surfaces/role-chat.ts` (logs reason) | `ai-prompt-block-disclosure.integration.test.ts` (7) | the error message becomes the reason again | **4 fail**; restored → 7/0; AI suites 73/0 |
| 2 refund.processed convergence | `services/refund-ledger-sync.service.ts` (`markGatewayRefundProcessed`: payment `refundStatus` → processed when it is the latest refund; booking → processed only for its `cancel-refund:`) | `refund-processed-convergence.integration.test.ts` (3) | helper becomes a no-op | **1 fail**; restored → 3/0; 9 money suites 114/0; runtime: UI-cancelled booking went processing → **processed**, money and journal unchanged |
| 3 POOL_BUSY on create | `routes/bookings.ts` (429 + `Retry-After: 3`) | `booking-create-pool-busy.test.ts` (2, incl. fail-closed control) | branch disabled | **1 fail**; restored → 2/0; idempotency/concurrency/payment suites 32/0 |
| 4 in-transaction second connection | `referral.service.ts`, `hcoin.service.ts`, `financial-adjustment.service.ts`, `partner-incentive-payout.service.ts` → `nextWalletTxnNumber(tx)` | `money-tx-pool-liveness.integration.test.ts` (2) | referral site reverted | **referral fails, H-Coin still passes** (isolates the cause); restored → 2/0; 13 money files 146/0; chaos 7J K1/K3 now 1 of 8 succeeds |

Typecheck after each fix: 0 errors.

## 28. CAPABILITY STATUS MATRIX

| Capability | Entry Point | Runtime | Persistence | Failure Handling | Security | Idempotency | Observability | Regression | Status |
|---|---|---|---|---|---|---|---|---|---|
| Customer web booking + pay + cancel | `/book`, `/bookings` (prod build) | ✓ UI journey | ✓ DB readback | ✓ overlap 409, 404, refusals | ✓ no token in storage, IDOR | ✓ idempotency key | ✓ request ids | ✓ e2e + unit | OPERATIONAL |
| Customer web catalogue SEO/a11y matrix | `/services/**` | partial (home/404/canonical/JSON-LD) | — | ✓ 404 | — | — | — | not re-run here | NOT PROVEN (this run) |
| Partner web | prod build, partner APIs | ✓ | ✓ earnings | ✓ wrong PIN, stale presence | ✓ RBAC | ✓ duplicate accept | ✓ | ✓ 31 e2e | OPERATIONAL |
| Admin panel | prod build, `/api/admin/*` | ✓ | ✓ history rows | ✓ validation | ✓ RBAC 403 | n/a | ✓ audit | ✓ 34 e2e | OPERATIONAL |
| Customer mobile | `homigo-mobile` | ✗ no device | — | — | — | — | — | tsc, gate, logic | NOT PROVEN — no device/emulator attached |
| Partner mobile | `homigo-partner-mobile` | ✗ no device | — | — | — | — | — | tsc, unit | NOT PROVEN — no device/emulator attached |
| Backend/API | :3100 isolated server | ✓ 65/65 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ 3,830/0 | OPERATIONAL |
| Auth / session / refresh / logout | `/api/auth/*`, WS auth | ✓ | ✓ sessions | ✓ lockout 429 | ✓ reuse → family revoked | ✓ grace replay | ✓ audit rows | ✓ | OPERATIONAL |
| OTP SMS delivery | Twilio | ✗ refused by barrier | ✓ OTP rows | ✓ isolated | ✓ rate limit | ✓ cooldown | ✓ logged | ✓ suites | NOT PROVEN — real send needs an owner test number |
| Bookings / state machine | `/api/bookings*` | ✓ full lifecycle | ✓ | ✓ | ✓ | ✓ (contract divergence noted) | ✓ | ✓ | OPERATIONAL |
| Price quote / server pricing | `price-quote`, create | ✓ | ✓ | ✓ forged ignored | ✓ | n/a | ✓ | ✓ | OPERATIONAL |
| Payments gateway (Razorpay TEST) | create-order / verify | ✓ real TEST | ✓ | ✓ forged sig 400 | ✓ HMAC | ✓ verify replay | ✓ | ✓ 8/8 | OPERATIONAL |
| Wallet / split | wallet routes | ✓ | ✓ ledger | ✓ | ✓ | ✓ | ✓ | ✓ | OPERATIONAL |
| Refunds (full/partial/repeat/ambiguous/lookup-fail/admin) | cancel, admin refund, reconcile | ✓ real TEST | ✓ journals | ✓ INDETERMINATE hold | ✓ RBAC | ✓ no duplicate | ✓ | ✓ | OPERATIONAL |
| Refund status convergence (`refund.processed`) | webhook | ✓ after fix | ✓ | ✓ | ✓ HMAC | ✓ replay no-op | ✓ | ✓ new test | OPERATIONAL (fixed today) |
| Failed-after-accepted refund (`refund.failed`) | webhook | handler only counts a metric | ✗ no state change | ✗ | ✓ | — | metric only | — | OWNER DECISION REQUIRED |
| Referral / H-Coin / reward money under concurrency | service methods | ✓ after fix | ✓ | ✓ | ✓ | ✓ once | ✓ | ✓ new test + 7J | OPERATIONAL (fixed today) |
| Partner operations (presence/accept/PIN/complete/earnings) | provider + booking routes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | OPERATIONAL |
| Maps server APIs (geocode/places/directions/matrix) | `/api/geo/*` | ✓ fallback only | n/a | ✓ graceful | ✓ auth, area guard | n/a | ✗ denial not logged | ✓ | EXTERNAL PROVIDER REQUIRED — Google billing disabled |
| Maps web loader | web/partner hooks | unit only | n/a | ✓ classified | n/a | n/a | n/a | ✓ 38/40 | OPERATIONAL (previously verified; unit) |
| Notifications in-app | inbox API | ✓ | ✓ | ✓ | ✓ | ✓ claim-before-send | ✓ | ✓ | OPERATIONAL |
| Email / push delivery | providers | ✗ | — | — | — | — | — | — | EXTERNAL PROVIDER REQUIRED — no Resend / FCM-Expo credentials |
| Realtime WebSocket | `/ws/*` | ✓ | n/a (best-effort) | ✓ reconnect | ✓ 4401/4403 | n/a | ✓ telemetry | ✓ 7G | OPERATIONAL |
| Outbox / events | outbox processor | ✓ | ✓ receipts | ✓ lease | n/a | ✓ one receipt | ✓ backlog/lag | ✓ 7D | OPERATIONAL |
| Scheduler / leader / jobs | distributed scheduler | ✓ | ✓ | ✓ PG fallback, crash | n/a | ✓ | ✓ | ✓ 7E/7H | OPERATIONAL |
| AI governance (auth, firewall, RBAC, no money) | `/api/ai/*` | ✓ | ✓ audit | ✓ | ✓ fixed leak | ✓ | ✓ | ✓ | OPERATIONAL |
| AI model inference | providers | ✗ no key | — | ✓ deterministic fallback | — | — | — | — | EXTERNAL PROVIDER REQUIRED — no AI API key |
| AI tools / approvals | `/api/ai-tools/*` | in-process only | ✓ | ✓ NO_HANDLER fail-closed | ✓ approval | ✓ | ✓ | ✓ suites | OPERATIONAL (TEST, in-process routes) |
| ETL / BigQuery / ML | scheduled jobs | ✓ runs, rejected | ✗ | ✓ retry + log | — | — | ✓ logs | ✓ | EXTERNAL PROVIDER REQUIRED — BigQuery billing disabled; no model serving |
| Fraud / risk | trust-safety, referral risk | ✓ admin UI, risk path | ✓ | ✓ | ✓ | n/a | ✓ | ✓ suites | OPERATIONAL (admin e2e + suites) |
| Finance / ledger / reconciliation | ledger, integrity | ✓ | ✓ | ✓ | n/a | ✓ keys | ✓ alert rule | ✓ | OPERATIONAL (test-DB `runChecks` gap attributed; §29) |
| RBAC / platform controls | admin RBAC | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | OPERATIONAL |
| Observability (logs/metrics/audit/alert rules) | `/metrics`, Prometheus | ✓ | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | PARTIALLY OPERATIONAL — no external alert receiver; Sentry off outside prod |
| Feature flags / config | flags table, env | TEST | ✓ | ✓ | ✓ | n/a | — | ✓ P11 flag tests | OPERATIONAL (TEST) |
| Database / migrations | Prisma, 147 migrations | ✓ scratch deploy | ✓ | ✓ | n/a | n/a | n/a | ✓ contract | OPERATIONAL |
| Performance — reads | 7A | ✓ | n/a | ✓ 0% errors | n/a | n/a | ✓ | — | OPERATIONAL (within p95/p99 contract) |
| Performance — booking create at multi-user scale | create | not measured | — | — | — | — | — | — | NOT PROVEN |

## 29. OWNER DECISIONS

1. **Failed gateway refunds (`refund.failed`).** SOURCE `payment.service.ts` → `refund-ledger-sync.syncFromWebhook`: the event increments a metric and changes nothing. The refund request stays COMPLETED, the payment REFUNDED, the refund journal stays posted, and the customer is told a refund is on its way. Correct handling needs a policy: automatic retry (the existing 5-attempt sweep), wallet credit instead, or manual support, plus a ledger reversal rule. Not changed here.
2. **Google Maps billing:** enable it on the Maps project, or accept fallback-only ETA and no geocode/places/directions.
3. **BigQuery:** enable billing or keep ETL dead. Separately, decide whether a **development** backend with a developer gcloud login should send its database to the warehouse at all (`bigQueryAllowed()` returns true for every non-test runtime).
4. **AI provider:** choose a provider and supply credentials, or keep the deterministic fallback.
5. **Email (Resend) and push (FCM/Expo) credentials.**
6. **SMS certification:** provide an owner-controlled test phone number, so one real OTP delivery can be proven without texting real people.
7. **Marketing claims on `/book`:** "50,000+ Happy Customers", "4.9 ★ Average Rating", "12K+ Bookings Today" and "AI Recommendation — Based on your home size (2BHK)" appear for a brand-new fixture customer. Under the coming-soon convention ("never fake data") the owner should confirm whether they are backed by data. **NOT PROVEN** either way.
8. **Canonical domain:** the home page's canonical is `https://homigo.app` while the public brand is Homeeigo. Confirm the domain.
9. **Test-DB accounting baseline:** accept that `runChecks` reports liability gaps in `homigo_test` caused by harness fixture funding and fixture deletion, or approve a documented test-only adjustment.
10. **Live signal:** `FinanceIntegrityFailure` has been firing on the dev backend (`homigo_db`) since 05:54Z. It belongs to live closure A–G; not touched.

## 30. NOT-PROVEN ITEMS

| Item | Smallest concrete reason |
|---|---|
| Customer mobile app runtime | no device or emulator attached (`adb devices` empty) |
| Partner mobile app runtime (location, push, background/foreground) | no device or emulator attached |
| Real SMS OTP delivery | would text real numbers; needs an owner test number |
| Real Razorpay webhook delivery | Razorpay cannot reach a localhost backend (a signed webhook to the real route was proven) |
| Booking-create p95 at multi-user scale | only single-customer contention was measured (778 ms / 373 ms p95) |
| Web catalogue routing/SEO/axe/overflow matrix | `homigo_test` lacks the curated taxonomy; not re-run (Phase 2 previously verified) |
| Maps success-path caching | the provider is denied, so no success was ever cached |
| Sentry delivery | disabled outside production/staging by design |
| External alert delivery | Alertmanager has only a certification webhook receiver |
| Chaos 7J P2–P32, S1, G3, B1, B2 | the harness schedules at `now+N h`, which is outside partner hours at 23:40 IST; covered by `p0-financial-races` (52 green) |
| Why the in-process idempotency test sees the route's 200 while the server returns the middleware's 201 | not isolated |
| Web e2e section04/05/09 as UI evidence | stale fixture injects a v0 localStorage session |
| AiConversationsList "1h ago" vs "just now" | fixture vs component not resolved (uncommitted WIP) |

## 31. NON-BLOCKING FOLLOW-UPS

- **Idempotency contract divergence:** decide which layer owns the replay answer (201 + `idempotent-replay` from the middleware vs 200 + `idempotent-replayed` from the route) and make the in-process test match runtime.
- **Web e2e fixture:** replace the version-0 localStorage token injection with a cookie session (the pattern `journey-customer` already uses via `context.addCookies`).
- **Customer web request hygiene:** the availability call with the `service-unavailable` placeholder id; the initial quote 400; tracking/ratings polled before assignment; aborted fetches logged as "backend unreachable".
- **Maps:** log and meter `REQUEST_DENIED` / `OVER_QUERY_LIMIT`, and alert on sustained fallback.
- **Test-DB hygiene:**
  - 9,615 public services, 4,383 of them adversarial fixtures (historical, from before the X-4 cleanup fix);
  - `phase09-late-capture-auto-refund` leaves one INDETERMINATE refund request per run;
  - `performance-nudges` and `production-blocker-final` read global state.
- **Test order dependence:** 33 files depend on in-file test order (fail under `--randomize`).
- **Mobile Jest:** runner mismatch (vitest / bun:test files), the `renderHook` import, and the AI chat tests that never press Send, all in uncommitted files.
- **SEO:** the home title repeats the brand ("HOMEEIGO — … | HOMEEIGO").
- **Chaos harnesses:** 7C I7 checks inside the 120 s outbox lease; 7J's booking slots inherit the wall-clock hour.
- **Partner a11y spec:** run axe after entrance animations settle.
- **`zustand` persist:** add a `migrate` for `homigo-auth` v0→v2, so users upgrading from old builds don't log a console error and lose the cached profile shell.
- **AI customer chat:** in degraded mode (no provider) the firewall does not run. That's harmless today (nothing is generated and no tool can run); keep it so if the fallback grows capabilities.

## 32. FINAL CERTIFICATION

**CODING-PHASE OPERATIONAL CERTIFICATION INCOMPLETE**

The integrated system's web, backend, payment (Razorpay TEST), refund, wallet, partner, admin, realtime, outbox, scheduler, security and database paths are operational on the evidence above. The four defects this certification found are fixed and proven by break-the-fix. Financial critical paths and security-critical paths are correct on the final tree.

Smallest blockers to COMPLETE:

1. **Mobile:** run the customer and partner apps on a device or emulator (dev build + `adb reverse`) and exercise auth, booking, payment, realtime and location.
2. **Owner decision:** handling of `refund.failed` (§29.1).
3. **External providers:** Google Maps billing (server Maps APIs), email/push credentials, AI provider, BigQuery billing.
4. **Evidence gaps:** one real SMS OTP to an owner test number; multi-user booking-create load against the p95 < 500 ms contract.

Not certified here: production deployment, live Razorpay behaviour, live closure A–G, production migration execution, and owner-controlled business decisions. The project remains in the coding / integration-testing phase.

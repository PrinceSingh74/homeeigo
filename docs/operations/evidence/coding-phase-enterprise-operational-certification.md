# HOMIGO CODING-PHASE OPERATIONAL GAP-CLOSURE REPORT

Date: 2026-09-28 · Branch: `cursor/stage-e-step-13-certification` (all changes uncommitted, as before)
Previous certification (2026-09-27, verdict INCOMPLETE): `coding-phase-enterprise-operational-certification-2026-09-27-baseline.md`

Environment: isolated backend on :3100 (`homigo_test`, Redis :6380, egress-refusing preload), Android emulator
(AVD Homigo_API36, Android 16 x86_64), Razorpay **TEST** keys only. `homigo_db` was never written; the
only `homigo_db` contact was one read-only public `GET /api/services` to measure the live catalogue size.
No real SMS, email or push was delivered to anyone (see §6 for one unintended push-provider request).

Status vocabulary: OPERATIONAL · PARTIALLY OPERATIONAL · NOT OPERATIONAL · NOT PROVEN · OWNER DECISION REQUIRED ·
EXTERNAL PROVIDER REQUIRED · EXTERNAL RUNTIME PREREQUISITE · NOT IMPLEMENTED · OUT OF SCOPE.

---

## 1. CHANGES MADE

Every production change below was written test-first (RED on the unchanged code), proven in an isolated
copy of the backend, broken on purpose (break-the-fix, §13), then landed.

| # | Defect | Fix | Files |
|---|---|---|---|
| F1 | A developer laptop reached the shared BigQuery warehouse through the implicit gcloud login — any non-test runtime was allowed | Warehouse egress policy: laptop needs `ANALYTICS_WAREHOUSE_EGRESS=enabled` + exact `ANALYTICS_WAREHOUSE_TARGET` + explicit existing key file; test runtime only with `HOMIGO_REQUIRE_BIGQUERY=1`; production/staging unchanged; malformed target refused everywhere | `src/lib/bigquery-adc.ts`, `src/lib/deployed-environment.ts`, `analytics/scheduler/etl-scheduler.ts`, `.env.example` |
| F2 | Google Maps denial (billing off → HTTP 200 `REQUEST_DENIED`) was completely silent — no log, no metric | Classify every provider answer; log `maps.provider_denied` / `maps.provider_error` / `maps.fetch_failed` with endpoint, error class, correlation id, fallback; counters `maps_provider_denied_total`, `maps_over_query_limit_total`, `maps_timeout_total`, `maps_fallback_used_total`; key read per call | `src/services/maps.service.ts` |
| F3 | Cancel dialog for an unpaid booking (interrupted checkout) said "Paid ₹550 · You get back ₹550 · Free cancellation — full refund" | Quote returns ₹0 / no fee / "nothing to refund" when nothing is refundable and the payment status is not paid — now identical to what the cancellation does | `src/services/booking-refund.service.ts`, `src/services/booking.service.ts` |
| F4 | Idempotency middleware (a) replayed the FIRST request's response to a DIFFERENT request reusing the key (a different endpoint too — `set-default` returned an address-create 201 without running); (b) namespaced by the raw bearer token, so an offline-queue replay after a token refresh executed twice | Namespace = verified user id; cached outcome carries a fingerprint (method, path, body) → mismatch = 409 `IDEMPOTENCY_KEY_REUSED`; routes owning their own contract (booking create, execution steps, requirement checks) are left to it. Body read from a request clone only when a key is present — never Elysia's `body` (see §12: the first version broke webhooks) | `src/middleware/idempotency.middleware.ts` |
| F5 | Email bounce suppression lived only in Redis — with Redis down/flushed a bounced address kept being mailed (reproduced) | `isSuppressed` falls back to the durable `bounce_suppression` row, same 90-day window, case-insensitive | `src/services/email-delivery.service.ts` |
| F6 | Mobile book screen: a requested service not in the first 20 of `/api/services` silently became the FIRST service ("Book again", provider pages, AI rows, deep links — 13 of 33 live services) | Resolve the request; fetch it by id when not in the page; say so when unresolvable; settle the selection once | `homigo-mobile/src/lib/requested-service.ts`, `src/hooks/use-catalog.ts`, `src/hooks/use-core-data.ts`, `app/book.tsx` |
| F7 | Mobile cold start into `/book` (deep link / notification) crashed: `popularPackageIndex(undefined)` | Guard the first render | `homigo-mobile/app/book.tsx` |
| F8 | Mobile `AuthGuard` read the pre-bootstrap `idle` status as signed out and navigated before the root layout mounted → render error on every cold start into Book/Bookings/Wallet/Profile | `idle` = wait; navigate only when the navigation container is ready | `homigo-mobile/src/lib/auth/guard-decision.ts`, `src/components/auth/AuthGuard.tsx` |

Tests added: `bigquery-warehouse-egress-policy.test.ts` (21), `maps-provider-observability.integration.test.ts` (9),
`idempotency-key-reuse.integration.test.ts` (7), `email-suppression-durable.integration.test.ts` (4), 2 cases in
`refund-tender-evidence.integration.test.ts`; mobile `requested-service.test.ts` (6), `guard-decision.test.ts` (4).
One existing test's premise changed: `phase09-policy-snapshot` "quote follows frozen tiers" now pays the booking first —
its unpaid fixture asserted the exact behaviour F3 removes (a 35% fee quoted for a booking whose cancellation keeps none).

Harness-only (outside the repo, `D:\homigo-cert`): emulator UI driver, benchmark, channel harness, mutation runners.
A customer **x86_64 debug APK** was built with the project's own Gradle (the existing APK was arm64-only and crashed
on the emulator); the original arm64 APK was restored byte-identical (sha256 verified).

## 2. CUSTOMER MOBILE — PARTIALLY OPERATIONAL

Run on the Android emulator against :3100 (Metro serving the working tree; Sentry DSN neutralised to loopback).

| Flow | Result |
|---|---|
| Launch / home / catalogue | OPERATIONAL — home, catalogue (from `homigo_test`), 17 core-data calls all 200 |
| Login, keyboard | OPERATIONAL — Sign-in stays above the keyboard |
| Duplicate submit (login, Confirm Booking) | OPERATIONAL — double tap → exactly 1 request; 1 booking row |
| Deep link `homigo://book?service=…` | Was defective (F6, F7, F8); OPERATIONAL after fix, cold and warm |
| Booking + **Razorpay TEST in-app** (CheckoutActivity → netbanking → demo bank Success) | OPERATIONAL — `/payments/verify` 200; DB payment SUCCESS ₹550 `pay_ThCJEc6BfLwXLE`; confirmation "₹550 paid · Razorpay" |
| Overlapping slot | OPERATIONAL — 409 → "You have an overlapping booking" |
| Interrupted checkout → 15-min expiry | Server OPERATIONAL (EXPIRED + "Booking released" notification); app list updates to "Expired" |
| Unpaid booking detail | **REAL PRODUCT ISSUE (open)** — shows "Booking confirmed · Your pro will arrive" and offers no way to pay, although the success modal promises "Pay now — or anytime from My Bookings" |
| Cancel quote for unpaid booking | Was defective (F3 — server); fixed; proven by test, not re-driven on the device |
| Realtime / status updates | OPERATIONAL via refetch — list moved to "Live · Your pro is en route" |
| Status timeline timestamps | **Defect (open, minor)** — every step shows the same time ("2:42 am") |
| Start PIN | OPERATIONAL via API/partner flow; the sheet hides the PIN card for live bookings (shown on Track screen) |
| Track live (map) | **EXTERNAL RUNTIME PREREQUISITE** — emulator hung on the Google Map screen (all vCPU threads unresponsive) |
| Notifications permission (allow / deny) | Both paths handled; no push-token registration observed on the emulator |
| 360 dp width, session expiry, reconnect, logout | NOT PROVEN on the customer app this run (partner app covered 360 dp and logout) |

## 3. PARTNER MOBILE — OPERATIONAL (flow), with findings

Full flow on the emulator against :3100: sign in → online (presence heartbeats, location via Android test provider) →
reject a request (`/reject` 200) → assignment → en route → **I've arrived** (`/arrived` 200; arrival is a timestamp,
status stays EN_ROUTE by design) → **Start job**: PIN issued (SMS to Twilio **refused** by the egress barrier — no
real message), 6-digit PIN → `/start` 200 → IN_PROGRESS → **Complete job** with photo evidence → `/complete` 200 →
earning CREDITED (gross ₹550, commission ₹110, net ₹440) → app shows "Today's earnings ₹440" → background 20 s /
foreground (state kept, heartbeats continued) → Sign out (`/auth/logout` 200). Login screen verified at 360 dp.

Findings:
- **Dispatch exhausted before the partner came online** — the paid booking's job went EXHAUSTED in ~2 min (5 rounds, 0 candidates: stale presence / location / capacity). Correct refusals, but **admin Force dispatch is a silent no-op on EXHAUSTED jobs** (`dispatched:false`, no reason); recovery needed **Reassign**, which was blocked by `STALE_LOCATION` then `CAPACITY_LIMIT` until the partner answered offers and raised capacity.
- **Capacity copy is misleading** — "Available for jobs · 0/4 capacity · You're visible for new jobs" while 4 unanswered offers made the partner FULL for dispatch.
- **GPS auto EN_ROUTE (REAL PRODUCT ISSUE, open)** — any booking-scoped GPS ping moves ASSIGNED → EN_ROUTE ("en route (gps_geofence)") with no schedule or distance check; the app publishes pings for its top active job whenever the Requests screen is open. A job 2.5 days away became "on the way" in 3 s. Needs a product rule (travel window).
- A past-dated residue booking (06:33 UTC, same day) was offered to the partner.
- After the partner's own reject the screen says "taken, withdrawn or has expired"; far-ahead deadline renders as "Respond within 4235:44".
- `adb emu geo fix` is ignored by this image; the Android test location provider works.

## 4. REFUND.FAILED DECISION — OWNER DECISION REQUIRED (packet below; nothing implemented)

**Current lifecycle (verified in code):**
1. Initiation (cancellation key `cancel-refund:<bookingId>`, admin/case/workflow/late-capture keys): RefundRequest
   REFUNDING + payment REFUNDING inside one locked transaction.
2. Gateway accepts (2xx, even `status: pending`): at that moment the REFUND journal is posted (Dr REFUND_LIABILITY /
   Cr CUSTOMER_FUNDS), RefundRequest → COMPLETED, payment → REFUNDED/PARTIALLY_REFUNDED (`refundedAmount` += amount),
   customer notified "Refund processed … 5–7 business days".
3. `refund.processed` webhook: confirms (booking/payment refundStatus → processed — fixed 2026-09-27).
4. **`refund.failed` webhook** (`refund-ledger-sync.service.ts` → `syncFromWebhook`): increments `refund_failure_total`
   and `refund_failed_total`, returns handled; the event is marked processed (Razorpay will not redeliver).
   **Nothing else changes**: payment, booking, RefundRequest, journal, wallet, cashback reversal, notification,
   audit — all still say the refund happened. No sweeper, detector or admin view selects it (retry sweep only
   takes FAILED rows; stale sweep only REFUNDING/INDETERMINATE; alert rule needs >5 failures/hour; no external
   receiver). A COMPLETED request is replayed as success, so admin retry cannot re-drive it.

**Documented options** (only source: the 2026-09-27 report, verbatim: "automatic retry (the existing 5-attempt
sweep), wallet credit instead, or manual support, plus a ledger reversal rule"). Unranked:

| Impact | A. Automatic gateway retry | B. Wallet credit instead | C. Manual support queue |
|---|---|---|---|
| Money | Customer eventually refunded to source; each retry is a new gateway attempt | Customer refunded instantly to wallet (not to card/UPI) | Customer waits for a human |
| Provider (Razorpay) | Re-uses the per-booking key — replay semantics after a failed original are **untested** (F2 report shows key replay returns the original response) → likely needs a new key per attempt | None | Support may retry in dashboard |
| Ledger | Needs a reversal of the posted REFUND journal first (none exists; append-only; only generic maker-checker adjustment) | Reversal of gateway journal + wallet-refund journal | Reversal rule still needed |
| Payment row | `refundedAmount` must drop by the failed amount or the ceiling blocks the retry (full refund → NOT_REFUNDABLE) | Same, then wallet tender | Same |
| Booking | refundStatus must leave "processed/processing" → "failed/retrying" | → processed (wallet) | → failed / pending support |
| Retry | Existing 5-attempt backoff sweep, but it only selects FAILED `cancel-refund:` rows | n/a | Human |
| Idempotency | COMPLETED row replays success → must move to FAILED; gateway key strategy decision | New wallet key per case | Case id |
| Notification | Needs a "refund failed / retrying" message (no type exists) | "Refunded to wallet" | "Our team will contact you" |
| Reconciliation | Gateway reconciliation ignores refund `status` today; must compare it | Wallet ledger reconcile covers it | Manual |

Common to all options: a ledger reversal rule, a durable record of the failure (payment/refund ids), an alert on
the first failure, and gift-card refunds (no payments row → `PAYMENT_NOT_FOUND` before the failed branch; not even
counted). Also noted: `reconcileIndeterminateRefund` treats any notes match as CONFIRMED regardless of gateway
status (only with auto-recovery ON, which is OFF). **STOPPED before implementing** — owner to choose.

## 5. GOOGLE MAPS

**ENGINEERING MAPS STATUS: OPERATIONAL (observability + degradation).** Fix F2. Proven with a documented-contract
provider double (Google's billing-disabled `REQUEST_DENIED` body, `OVER_QUERY_LIMIT`, timeout, OK bodies):
denial → null/[]/haversine/OSRM fallback + structured log with the caller's `X-Request-ID` as correlation id +
counters; timeout classified separately; **reverse, autocomplete, place, ETA and route all answer 200 under denial
and timeout (never 5xx)**; success path parsed and **cached** (second call: zero provider calls; geo TTL 86 400 s) —
cache proven against an in-memory Redis double, not live Google.
**EXTERNAL PROVIDER STATUS: EXTERNAL PROVIDER REQUIRED** — Google Maps web services deny (billing disabled). Real
success-path caching against Google is **not** live-verified. The mobile Maps SDK screen hung the emulator (§2).

## 6. NOTIFICATIONS

| Channel | Status | Evidence |
|---|---|---|
| In-app | OPERATIONAL | Rows created and served (`BOOKING_PAYMENT_EXPIRED` "Booking released…"; `/api/notifications` 200 in both apps) |
| Email | PARTIALLY OPERATIONAL — EXTERNAL PROVIDER REQUIRED | Channel harness with a Resend double: 2 failures then success → 3 attempts, row `sent`; persistent failure → exactly 3 attempts, row `failed`; suppressed address → `suppressed`, 0 provider calls (after F5; before F5 it was mailed). `RESEND_API_KEY` empty locally; development falls back to a console provider logged as `sent` with `provider: console`. No dedup layer in the email hub itself |
| SMS | NOT PROVEN — EXTERNAL TEST DESTINATION REQUIRED | Twilio is configured with real credentials; every send in this sprint (start-PIN) was **refused** by the egress barrier. No safe test number was provided, so no send was attempted |
| Push | PARTIALLY OPERATIONAL | Expo SDK path: `ok` ticket → notification marked pushed; `DeviceNotRegistered` → token deactivated. A failed send is only logged — **not persisted, not retried**. No token registration observed on the emulator (no FCM). **Harness disclosure:** the Expo SDK (Bun's built-in `undici`) bypassed both the fetch double and the in-process barrier; one request most likely reached Expo's real API with two fabricated tokens (answer: "not a registered recipient"). No device or person could receive anything; the push leg was not re-run |

## 7. MULTI-USER BOOKING PERFORMANCE — NOT OPERATIONAL at contract (≥25 concurrent), diagnosed

Distinct customer + distinct IP per request, isolated server, contract p95 < 500 ms, p99 < 1200 ms, errors < 1%.
All runs: **0 failures, 0 business refusals, every booking created** (185 per run).

| Config | c=10 p95 | c=25 p95 | c=50 p95 | c=100 p95 (p99) |
|---|---|---|---|---|
| Dev logging (query log + debug), pool 10 | 549 | 913 | 1627 | 3297 (3304) |
| Production-like logging, pool 10 | 639* | 603 | 1148 | 2162 (2188) |
| Production-like logging, pool 25 | **477** | 646 | 1138 | 2063 (2170) |
\* includes warm-up.

Bottleneck: **CPU in the single Bun process** (~48 creates/s ceiling; 220–380 % CPU incl. Prisma engine threads).
Not the pool (active ≤ 16 of 25), not locks (waits ≈ 0 except a transient 9 at c=100), not Redis. A CPU profile under
load shows a large share of process CPU in **co-located background workers** (outbox tick, scheduled jobs, ops-alert
dispatch, WebSocket fan-out, payment expiry, ledger backfill) running over an inflated test DB (149 649 outbox rows,
9.9k services). Booking phases under load: validate 344 ms, post 286 ms, tx 230 ms, quote 155 ms (averages incl.
queueing). **No minimal code fix** meets the contract at c≥25: throughput must rise (separate worker processes from
API instances, more instances). That is an architecture/capacity decision and was **not** made silently. Also: the
dev server logs every Prisma query (`NODE_ENV=development`), which inflates local latency ~15–50 %.

## 8. BIGQUERY DEVELOPMENT SAFETY — OPERATIONAL

Fix F1. Tests: laptop with only gcloud login → refused (`local_egress_not_enabled`); key file alone → refused; any
unknown APP_ENV → laptop; test runtime refused unless `HOMIGO_REQUIRE_BIGQUERY=1`; production and staging (both
`.env.staging` and Cloud Run shapes) allowed with no local flags; laptop with all three authorizations allowed;
malformed target (incl. un-substituted `PROJECT_ID`, bad datasets) refused; target mismatch refused; missing/nonexistent
key file refused; real entry points: ETL scheduler skips with the reason, warehouse client never constructed, ML
services refuse. **Runtime proof:** :3100 started with the developer's real gcloud ADC visible (no neutralisation);
the runtime probe fired 14 capture/arrival/completion events; zero ETL runs, and the OS socket table showed only the
Razorpay API — no Google connection. (Previous run under the old rule: ETL ran and BigQuery answered.)

## 9. TEST-HARNESS TRUTHFULNESS

| Item | Class | Action |
|---|---|---|
| 33 order-dependent suites / global-state readers | TEST-HARNESS ISSUE | Unchanged (randomized-order run not repeated this sprint) |
| Customer mobile Jest (11–12 fails) | TEST-HARNESS ISSUE (uncommitted WIP) | Re-run: 22/12 under load, 5/2 alone for the extra suite = baseline; no new failure from F6–F8 |
| Web e2e stale auth fixture (v0 localStorage) | TEST-HARNESS ISSUE | Not changed (no web change this sprint) |
| Maps denial observability | REAL PRODUCT ISSUE | Fixed (F2) |
| Idempotency 200 vs 201 | ACCEPTED CONTRACT for booking create (route guard: 201 then 200 + `idempotent-replayed`); the generic middleware's reuse behaviour was a REAL PRODUCT ISSUE | Fixed (F4) |
| Test DB fixture inflation (9.9k services, 150k outbox rows, residue offers, past-dated paid bookings) | ENVIRONMENT ISSUE | Documented; it distorts perf (§7) and dispatch (§3) |
| Late-capture INDETERMINATE | ACCEPTED CONTRACT | Unchanged |
| Full-suite load flakes (500-concurrent creates, DDL-guard checker 60 s) | TEST-HARNESS ISSUE | Both pass alone |
| Harness: `adbui` reported a stale UI dump when uiautomator could not idle | TEST-HARNESS ISSUE (mine) | Fixed in the harness |
| Harness: Metro with `CI=1` served a stale bundle | ENVIRONMENT ISSUE | Found before trusting device results; restarted without CI |

## 10. FINANCIAL REGRESSION

All refund/cancel/quote suites (24 files, 217 pass; 2 isolated-copy artefacts that pass in the tree) plus
`split-refund`, `wallet-funded-refund`, `admin-partial-refund`, `refund-processed-convergence`, `refund-tender-evidence`,
`phase09-policy-snapshot`: green in the tree. Money-path behaviour changed only in F3 (quote display; no money
movement). Real device payment §2; earning math §3 (₹550 → ₹110 commission → ₹440 net).

## 11. RAZORPAY TEST MODE

In-app Razorpay TEST checkout on Android (§2) and runtime probe real TEST checkout + verify + replay (65/65) on the
landed code. The real TEST-mode refund suite (8/8, 2026-09-27) was not re-run this sprint; the refund path was not
changed except the quote (F3). **No live keys used.**

## 12. FULL REGRESSION

| Suite | Result |
|---|---|
| Backend full (run 1, before webhook fix) | 3867 pass / 10 skip / **5 fail** — 2 real (webhooks 500 `ERR_BODY_ALREADY_USED`, caused by the first F4 version), 3 load-related |
| Backend full (run 2, after fix) | **3873 pass / 10 skip / 1 fail** (319 files, 984 s). The one failure is a cleanup-hook FK race on `provider_match_scores` in `security-hardening-2026-09` (background match-score write during fixture teardown); the file passes alone 11/0; unrelated to any change here. The webhook 500s from run 1 are gone |
| Targeted suites after each landing | 166/0, 9/0, 19/0, 6/0, 4/0, 39/0 |
| Cross-process runtime probe (:3100, landed code) | 65/65 |
| Backend typecheck | 0 errors |
| Customer mobile tsc / logic | 0 / 41 pass |
| Partner mobile tsc | 0 |
| Web/partner/admin prod builds, web e2e | NOT RE-RUN (no web code changed; 2026-09-27 results stand) |
| Randomized-order backend run | NOT RE-RUN |

## 13. BREAK-THE-FIX

| Fix | Mutations | Caught |
|---|---|---|
| F1 BigQuery | old rule; implicit credentials; no target validation; no target authorization; production treated as laptop; scheduler ignores policy | 6/6 |
| F2 Maps | silent denial; timeout unclassified; no correlation id; fallback uncounted; denial escalates (→ 500 on the wire); cache bypassed | 6/6 |
| F3 Quote | price fallback; tier message kept; override applied to paid bookings | 3/3 |
| F4 Idempotency | raw-token namespace; no fingerprint check; shared namespace; shadows booking route; reads Elysia body (→ webhook 500); fingerprint ignores body | 6/7 — **key-order mutation not caught**: Elysia rebuilds validated bodies in schema order, so the canonical-JSON step is untested defence for schema-less routes |
| F5 Suppression | Redis-only; no window; case-sensitive | 3/3 |
| F6–F8 Mobile (unit) | fallback-to-first; duplicate insert; idle = signed out; navigate before ready | 4/4 |
| F6–F8 Mobile (device, cold-start deep link) | service not fetched → wrong service; unguarded package → render error; pre-fix guard → navigate-before-mount error | 3/3; the `idle`-only mutation was not distinguishable on the device (bootstrap already `initializing` when navigation became ready) — covered by the unit test |

Every mutated file was restored and hash-verified.

## 14. UPDATED CAPABILITY MATRIX

| Capability | Entry Point | Runtime Evidence | Persistence | Failure Handling | Security | Idempotency | Observability | Regression | Status |
|---|---|---|---|---|---|---|---|---|---|
| Customer booking + TEST payment (mobile) | app → `/api/bookings`, `/payments/*` | emulator, real TEST checkout | booking/payment rows | overlap 409, expiry 15 min | JWT, masked PII | double-tap = 1 row | request logs, phases | green | OPERATIONAL |
| Deep links into booking | `homigo://book` | emulator cold/warm | — | fixed F6–F8 | guard | — | — | unit + device | OPERATIONAL |
| Unpaid-booking recovery (pay later) | booking detail | emulator | expiry | none in app | — | — | — | — | NOT IMPLEMENTED (mobile) |
| Partner job lifecycle | partner app | emulator end-to-end | booking, earning | PIN, photo evidence | PIN via SMS (blocked) | server guards | status history | green | OPERATIONAL |
| Dispatch recovery (admin) | force-dispatch / reassign | API | assignment job | force-dispatch no-op on EXHAUSTED | admin only | — | audit NO_OP | — | PARTIALLY OPERATIONAL |
| GPS-driven EN_ROUTE | tracking ping | emulator | status history | no schedule check | partner | idempotent | reason logged | — | OWNER DECISION REQUIRED |
| Cancellation quote | `/cancellation-quote` | tests (device before fix) | — | fixed F3 | owner/provider only | — | — | green | OPERATIONAL |
| Refund failure | `refund.failed` webhook | code trace | none | none | HMAC | dedup | metric only | none | OWNER DECISION REQUIRED |
| Maps | `/api/geo/*` | double + prior live denial | Redis cache | fallbacks, never 5xx | auth + limits | — | logs + 4 metrics | green | OPERATIONAL (eng.) / EXTERNAL PROVIDER REQUIRED |
| Email | email hub | double | email_logs | retry ×3, suppression (F5) | — | none | counters | green | PARTIALLY OPERATIONAL |
| SMS | Twilio | refused by barrier | — | — | — | — | — | — | NOT PROVEN |
| Push | Expo | partial | notification.isPushed | no retry/persist | — | — | log line | none | PARTIALLY OPERATIONAL |
| In-app notifications | `/api/notifications` | emulator | rows | — | auth | consumer claims | — | green | OPERATIONAL |
| Idempotent mutations | `Idempotency-Key` | tests | Redis/memory | 409 reuse | per-user | fixed F4 | — | green | OPERATIONAL |
| Booking create under load | `/api/bookings` | benchmark | — | 0 errors | limiters | — | phase histograms | — | NOT OPERATIONAL at c≥25 (capacity) |
| BigQuery egress | ETL, ML services | runtime + socket table | — | fail closed | policy | — | skip reason | green | OPERATIONAL |

## 15. OWNER DECISIONS

1. `refund.failed` policy (§4): A / B / C + ledger reversal rule.
2. Booking-create capacity (§7): worker/API process split and/or instance count to meet p95 < 500 ms at the expected concurrency.
3. GPS-inferred travel (§3): when a ping may move a booking to EN_ROUTE.
4. Unpaid booking in the mobile app (§2): "pay now" entry point and truthful status before payment.
5. Admin force-dispatch on EXHAUSTED jobs: reset attempts, or say why it did nothing.
6. Push failure handling: persist and retry, or accept loss.

## 16. EXTERNAL PROVIDER / RUNTIME PREREQUISITES

- Google Maps billing (web services + mobile SDK) — EXTERNAL PROVIDER REQUIRED.
- Resend API key — EXTERNAL PROVIDER REQUIRED.
- A safe SMS test destination — EXTERNAL TEST DESTINATION REQUIRED.
- Push: a device/emulator with FCM for Expo token registration — EXTERNAL RUNTIME PREREQUISITE.
- Emulator GPU stability for map screens (SwiftShader crashed on the Razorpay WebView; host GPU hung on Track live) — EXTERNAL RUNTIME PREREQUISITE; a physical device removes it.
- BigQuery billing (disabled) — only matters once the warehouse is meant to run.

## 17. NOT-PROVEN ITEMS

Customer app: 360 dp, session expiry, reconnect, logout, live map. SMS delivery. Push end-to-end. Real Google
success-path caching. Randomized-order backend run and web prod builds/e2e (not re-run). Canonical key order in the
idempotency fingerprint (§13). Real TEST-mode refund suite (not re-run; path unchanged). Live anything.

## 18. FINAL CERTIFICATION

**CODING-PHASE OPERATIONAL CERTIFICATION INCOMPLETE.**

Eight defects were fixed and landed with break-the-fix, including one regression my own first fix introduced and
the full suite caught. Material capabilities remain below the bar: booking create misses the latency contract from
25 concurrent requests (capacity decision), `refund.failed` still has no handling (owner decision), push and SMS are
not proven, and open product findings (GPS auto EN_ROUTE, unpaid-booking UX, silent force-dispatch) need decisions.
This is not a production-readiness or live-Razorpay claim; no live closure step was executed.

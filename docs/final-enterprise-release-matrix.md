# HOMEEIGO — Final Enterprise Release Matrix

Date: 2026-09-20 · Branch `cursor/stage-e-step-13-certification`. Snapshot of that pass.
**Supersession 2026-10-10:** rows 8 and 32 are no longer BLOCKED. Written decisions:
`docs/phase-1-business-decisions.md`. Tax remains non-GST-compliant by decision (DECIDED, not PASS).
Statuses in the original pass were only **PASS**, **FAIL** or **BLOCKED**. There is no UNKNOWN.

"PASS" means there is runtime evidence in this environment. It never means "production-proven" —
where production evidence is required and absent, the row is BLOCKED and says what is needed.

| # | Domain | Status | Evidence / root cause / dependency |
|---|---|---|---|
| 1 | Architecture | PASS | Booking/payment state separation holds (payment never writes status); single cancel path; state machine + `booking_status_history` trigger. Final code: **2,633/0 forward, 2,633/0 reverse, 2,633/0 on a migrations-built database**, plus both fault-injection suites (6/0, 7/0) in every order. |
| 2 | Booking | PASS | Create → dispatch → accept → en-route → arrived → start → complete verified in suite and in browser E2E on an isolated DB. Slot contract pinned by characterization tests. |
| 3 | Payments | PASS | Replayed capture/verify idempotent; webhook forgery refused; captured-vs-cancel race yields one terminal state. Live gateway NOT exercised (test keys; Razorpay now barred from test runtimes). |
| 4 | Refunds | PASS (code) · BLOCKED (2 historical cases) | Split/wallet/gateway refund suites 45/45 on a clone of real dev data. C1 (₹2,310, 4 bookings) and C2 (₹1,154) await owner approval — `docs/release-refund-approval-request.md`. |
| 5 | Wallet | PASS | Wallet-funded refunds, shortfall handling, concurrent debits: exactly-once, ledger balanced, 90/90 concurrency ×3. |
| 6 | Ledger | PASS | Every journal balances on both databases; 0 duplicate idempotency keys; 7 invariant checks in `booking-consistency.service`. |
| 7 | Commission | PASS | Partner earning = gross − 20% commission, credited once; over-withdrawal blocked. |
| 8 | Tax | **DECIDED** (not GST-PASS) | D4 option (a): partner supplier, 10% pass-through, no TAX_PAYABLE this launch. `docs/phase-1-business-decisions.md`. |
| 9 | Dispatch | PASS | One SENT offer per job; accept ‖ accept yields one owner; cancel ‖ dispatch leaves no open offer. New `assignment_dispatch_latency_seconds` metric. |
| 10 | Partner app (web) | PASS | Login → bookings → route centre in browser against an isolated backend. |
| 11 | Customer app (web) | PASS | Login → booking → tracking → checkout paid → completion in browser. |
| 12 | Admin | PASS | Login → ops map → heatmap → geofence; RBAC fail-closed; demoted admin loses access with a token minted while admin. |
| 13 | Authentication | PASS | Refresh rotation + reuse detection (family revoked, auth epoch bumped). **Web refresh tokens are no longer in localStorage** — HttpOnly, SameSite=Strict, audience-scoped cookies, proven in all three browsers. |
| 14 | Authorization | PASS | IDOR 14/14 with a positive control; cookies grant **no** ambient authority (ordinary endpoints still need the bearer token). |
| 15 | Location | PASS (backend) · BLOCKED (device) | Unknown fix is `null`, never 0,0; sequence regression refused; INT4 bound enforced. Background behaviour needs hardware — `docs/mobile-device-certification-checklist.md`. |
| 16 | Notifications | PASS | Claim-before-send idempotency; dedupe indexes now present on dev too; a broken notification cannot break the operation it announces. |
| 17 | WebSocket | PASS | Authorization lifecycle (evict on revoke/role/epoch), close-during-open race fixed, reconnect verified in browser. |
| 18 | Database | PASS | Drift clean on dev, test and a migrations-only build — **2,976 model fields, 219 tables, 35 protected objects** on `homigo_migrations_test`, built by `migrate deploy` alone. Financial-history delete guard enforced. |
| 19 | Migrations | PASS | All apply to an empty database and the **full suite passes on it: 2,633/0** (`homigo_migrations_test`, built by `migrate deploy` alone, rebuilt on the final code). The 10 failures seen first were the missing test-only purge grant, not the schema - `certify-fresh-migrate.ts --for-suite` now applies it. Drift clean: 2,976 model fields, 219 tables, 35 protected objects. Dev history reconciled. |
| 20 | Reconciliation | PASS (classification) | 153 dev anomalies classified, 0 UNKNOWN: 146 fixtures, 7 genuine (C1–C3). No data was altered to make a report green. |
| 21 | Observability | PASS (internal) · **BLOCKED** (external delivery) | `/health`, `/ready`, `/metrics` (344 families); Prometheus → Alertmanager fired a real alert. Heartbeat/location latency metrics were in the wrong unit and are fixed; dispatch and payment-settlement latency added. Slack/pager/email/Sentry need credentials. |
| 22 | Security | PASS | Fresh pass: IDOR/RBAC, JWT forgery, refresh replay, webhook forgery, payment tampering, rate limits, OTP abuse, upload type sniffing, CSRF on the new cookie surface. Secrets never reach logs or Sentry (negative tests). |
| 23 | Performance | **PASS - all 6 flows** | Two defects, both previously misattributed to "the hardware". **(1) `create()` ran at SERIALIZABLE**: SSI predicate locks are page-granular, so creators sharing no user/provider/slot still aborted each other - 48% of first attempts P2034, and the 40 ms x 2^n retry ladder was the p99. At READ COMMITTED (guarantees re-pinned by GiST exclusion constraints + FOR UPDATE scans + a new coupon row lock): p95 2,810 -> 549-653 ms, p99 7,310 -> 767-885 ms, P2034 1,143 -> 0. **(2) Every authenticated request made 4 DB round trips** - `users`, `providers`, `admin_users` (Prisma splits nested relations) and the jti blacklist, 13,212 calls each - now ONE LEFT JOIN on unique keys. Throughput 437 -> 653-698 req/s, 1,220-1,459 bookings per 60 s against 592. **Full profile, 180 s: k6 exit 0, every threshold green** (booking_create 598/679, heartbeat 331/360, services_list 187/265, price_quote 195/275, wallet_quote 193/259, webhook 545/777). On the 60 s profile heartbeat read 329/349/451 - the 120-sample p95 is unstable against this host's ~1-3% tail; over 350 samples server-side p95 is 137 ms with 3 samples above 300 ms. No threshold was changed. |
| 24 | Accessibility | PASS (prior evidence) | axe-core runtime checks from the earlier experience audit; not re-run in this pass. |
| 25 | E2E | PASS | Re-run on the final code AFTER the auth path changed, one app at a time against a fresh isolated backend: **web 2/2, partner-web 3/3, admin-panel 3/3**, every run reporting `isolatedDatabase: true` and 0 mentions of the dev database. A first attempt failed 8/8 with `401 unknown_email` - that was the harness, not the product: `test:setup --reset` wipes the demo accounts and the runner assumed they survived. It now reseeds them and prints the count. |
| 26 | Real device (mobile) | **BLOCKED** | `adb devices` empty. Full checklist prepared; no row may be claimed from unit tests. |
| 27 | Backup / restore | PASS (local) | Dump 6 s / restore 11 s; 216/216 tables and all money totals identical; used for real before the dev migration. |
| 28 | PITR | **BLOCKED** | No WAL archiving, no off-host storage (`AWS_S3_BUCKET` unset), no RPO/RTO, no production drill — `docs/production-backup-and-alerting-requirements.md`. |
| 29 | External alerts | **BLOCKED** | Routing tree complete; Slack/SMTP/PagerDuty credentials absent. Test runtimes can no longer alert production (Sentry disabled under NODE_ENV=test). |
| 30 | Money migration (Float → paise) | **BLOCKED** | Plan + full inventory (107 fields) and precision evidence (0 sub-paise in 63,239 values). Execution needs a production DB, verified backup and finance sign-off — `docs/money-migration-plan.md`. |
| 31 | Third-party egress from tests | PASS | Twilio/Maps/BigQuery/OpenWeather/Razorpay/Resend/Expo/S3/AI all barred in test runtimes, two independent layers, 10 enforcement tests, netstat witness = 0 external connections. **Owner action: review Twilio logs for 2026-09-20** — earlier runs sent real SMS. |
| 32 | Business decisions | **DECIDED** | D1–D4 closed 2026-10-10 — `docs/phase-1-business-decisions.md`. |

## FAIL rows — what must happen

**23. Performance / booking_create.**
- Root cause (measured, not inferred): server-side handler time for `POST /api/bookings` is ~830 ms
  under load while its own SQL totals ~30 ms; the time is spent waiting on the database. Pool size is
  not the constraint (15 vs 40 identical). Total system throughput on this host is ~530 req/s.
- Already fixed and measured this pass: heartbeat write collapsed to one statement (4 round trips →
  1), heartbeat authorization merged (3 queries → 1), queue-position partial indexes + one grouped
  count, catalogue response body cached. Heartbeat moved 678 ms → ~350 ms p95 and now passes.
- Contributing product risk: queue position is computed by counting the pending queue on every
  create, so its cost grows with that queue — and the queue has no expiry (decision **D3**).
- Next action: re-measure on production-class hardware (dedicated Postgres, app horizontally scaled).
  Do not relax the thresholds. If it still fails there, make queue position lazy or denormalised.

## Defects found AFTER the first matrix was written (final regression round, 2026-09-20)

The suite was green when the rows above were filled in. Running it again — in a clean environment,
forward and reversed — and then the browser journeys surfaced the defects below. None was found by
reading code alone; several were produced by fixes made earlier in the same session.

| # | Defect | Class | Status |
|---|---|---|---|
| A | `GET /api/admin/services/:id` carried no RBAC rule. Unmapped admin routes fail closed to `403 unmapped_route` for every role except SUPER_ADMIN, so the console showed the button and the backend refused it. | Product (authorization/UX) | FIXED — mapped to `SETTINGS/READ`, the same permission as the list |
| B | The phone scrubber in `logger.ts` rewrote trace ids: a 32-hex id contains a 10+ digit run ~8.5% of the time, and the mask consumed it (`"traceId":"834e[phone]b9d164a74e3af62"` in the live dev log). Log correlation was silently broken for ~1 request in 12. | Product (observability) | FIXED — shield identifier shapes, scrub, restore. 0/20,000 ids corrupted, masking unchanged (8 tests) |
| C | Two scripts reached a database without stating which one — the exact shape of the 2026-09-16 incident. `certify-fresh-migrate.ts` DROPs and recreates a database; `_pg-probe-pass2.ts` embedded a url naming the `postgres` maintenance database. | Process control | FIXED — guard asserted in the first, explicit target required in the second; coverage checker green |
| D | `booking-realtime-hooks` failed once in three full runs ("expected en_route, received accepted"). Root cause: settling a payment publishes the booking's CURRENT status in the background, and under load that fixture frame landed inside the spy window. | Test (product behaviour correct) | FIXED — the fixture waits for its own frame before arming spies; a sleep would only move the race |
| E | 11 TypeScript errors from a parallel catalogue workstream (`as const` producing readonly/literal types where Prisma wants mutable input). | Build | FIXED at source; `tsc --noEmit` 0 errors |
| F | The fix for D raced the other way: the fixture frame can be published on either side of the checkout's await, and a recorder armed afterwards never saw it — a 10 s wait then failed the run outright. | Test | FIXED — record from before the payment, which covers both orders |
| G | A money-matrix assertion (CASE 15, the period-key cutover bound) read `new Date()`, so it only executed between 18:30 and 24:00 UTC. It first ran on 2026-09-21 — and failed, because it asked to credit a key the same case had already credited, and it deleted payout rows while their journal entries stayed behind. | Test | FIXED — fixed instant (runs at every hour), second credit counted in the money invariant rather than deleted |
| H | `seed-customer-journey.ts` reads Prisma from `DATABASE_URL` but posted its booking to `SMOKE_BASE`, defaulting to the DEV backend on :3000. Run with `NODE_ENV=test` it read ids out of `homigo_test` and sent them to the live dev database. It failed with a confusing 400; had those ids existed there, it would have written a booking into `homigo_db`. | Process control (live-data hazard) | FIXED — the script refuses to run under `NODE_ENV=test` unless its HTTP target reports `isolatedDatabase: true` |
| J | **Two owners navigated after login.** The login form called `router.replace("/")` and the auth guard independently did the same on `isAuthenticated && isPublic`. The trace of the failing cookie-session spec shows both RSC fetches for `/` in flight, one aborted, and the navigation never committing: the API was signed in, the cookie was set, and the page sat on `/login` for 60 s. Present in partner-web and admin-panel; the customer app was never affected (its form reads `returnUrl`, and it has no guard). | Product (auth/navigation) | FIXED — the guard is the single owner; partner set now 3/3 green |
| I | `admin-panel/src/components/services/ServiceConfigEditor.tsx` (untracked, parallel catalogue workstream, last written 22:54) had five unterminated JSX ternaries (`{cond ? ( … )}` closed like an `&&` block). `tsc` stopped at the parser; `next build` would not have started. | Build (parallel workstream) | FIXED — the five closers now read `) : null}`; nothing else in the file touched |
| K | With the syntax repaired, the same file had **14 type errors**: it writes `matching`, `splitPaymentAllowed`, `membershipAllowed` and the `quality` checklist into `ServiceCatalogConfig` (`src/services/admin-api.ts`), which stopped at two payment flags. The backend's schema (`lib/service-catalog-config.ts`) declares every one of those fields — the hand-written mirror was simply stale, so the editor was right and the type was behind. | Build (parallel workstream) | FIXED — `payment`, `quality` and `matching` mirrored field-for-field from the backend schema; `admin-panel` tsc 0 errors |
| L | `apps/web/src/components/auth/PhoneOtpLoginForm.tsx` (untracked, same workstream): `return res.data ?? {}` inside a `runAuthAction` callback infers `SendOtpPayload \| {}`, which collapses to `{}` — `devOtp` and `smsSent` ceased to exist and the customer app's typecheck went red (4 errors). | Build (parallel workstream) | FIXED — the callback is annotated `Promise<Partial<SendOtpPayload>>`; `apps/web` tsc 0 errors |

Defect B is the one worth reading twice: every test passed, every log line looked plausible, and the
damage — an identifier that no longer joins to anything — is invisible unless you count it.

Defect G is worth reading for a different reason: the assertion was written, reviewed and committed,
and for 77% of the day it did not run at all. A test guarded by `new Date()` is not a test until the
clock agrees. Both F and G were produced by fixes made earlier in this same session — which is the
argument for re-running the whole suite after every fix rather than the file that was touched.

### E2E on this machine — what the environment did to the evidence

The final browser pass could not be completed in one sweep on this laptop. At the time of the run it
had **2.0–2.5 GB free of 15.6 GB**: the operator's own three Next dev servers (3001–3003) and **two**
dev backends on :3000 (one `--watch`, both on `homigo_db`) were up, alongside Cursor, VS Code, WSL and
Defender. Consequences, all environmental and all measured:

- `partner-web`'s dev compile died with `Zone Allocation failed - process out of memory` when the three
  certification apps were started together.
- Started one app at a time instead, the isolated backend itself was OOM-killed
  (`memory allocation of 352 bytes failed`) during the third app, invalidating the admin results.
- One partner spec (cookie session) failed in that window: login returned 200 and `/api/providers/me`
  returned 200 sixty seconds before the backend died, but the page never left `/login`. Re-run in
  isolation with a fresh backend — result recorded below.

The customer web cookie-session spec and the partner login/journey specs passed in the same run.
No E2E row is claimed from a run whose backend did not survive it.

### The certification host ran out of disk (2026-09-21, 01:25)

Mid-run, drive C: reached **0 bytes free**. The suite log could not be written, the Docker daemon
stopped answering, and `homigo-postgres` went down with it. What this cost and what it did not:

- **No data was lost.** Postgres replayed its WAL on restart (`redo starts at 28/924E6BE0` →
  `database system is ready to accept connections`) and all 14 databases came back. A read-only
  check of the live dev database afterwards: 975 journals, 2,295 ledger lines, **0 unbalanced** in
  both rupees and paise; 705 bookings, 419 payments.
- **The affected run was the migrations-only suite only.** The forward/reverse regression (00:20)
  and all three browser journeys (01:05) had already completed. No result was salvaged from a run
  whose host failed under it — the migrations-only suite was re-run from scratch afterwards.
- **What filled it:** 1.06 GB of raw k6/load logs and 267 MB of Playwright artifacts from earlier
  phases of this certification, plus 1.18 GB of harness diff scratch; all were mine and were
  deleted. C: went 0 → 3.8 GB. The Docker data image alone is 65 GB on C:.
- **Still outstanding (owner):** C: sits at 98% used (7.7 GB of 293 GB). Roughly 3.2 GB inside the
  Docker image is certification scratch — `homigo_dr_cert`, `homigo_verify`,
  `homigo_db_reconcile_clone`, `homigo_dr_scratch`. Dropping databases on the operator's machine is
  their call, not mine; named here so the choice is available.

### Did any other test hide behind a condition?

Defect G raised the obvious question, so the suite was searched for assertions that live inside a
conditional — 17 of them, across 11 files. All 17 are sound: each is either preceded by an assertion
that forces the condition (`expect(result.success).toBe(true)` before `if (result.success)`, which is
TypeScript narrowing rather than a guard), or asserts on both branches, or is a property check inside
a loop. G was the only assertion whose execution depended on something outside the test.

Two tests in `demand-supply-warning.integration.test.ts` gate their meaningful assertions on database
state (`if (q.withLocationRow > 0 …)`) and assert only a constant when that state is absent. They are
not wrong, but they prove less than they appear to on a run where the condition does not hold. Left
as-is and recorded here rather than rewritten: they belong to a feature outside this pass.

## Owner actions outstanding
1. Review Twilio message logs for 2026-09-20 (real SMS were sent by tests before the barrier).
2. Approve or decline the C1/C2 refunds (₹3,464 total).
3. ~~Decide D1–D4.~~ Closed 2026-10-10 (`docs/phase-1-business-decisions.md`). GSTIN / TAX_PAYABLE remain a later CA phase, not this list.
4. Provide production infrastructure: backup/PITR, alert credentials, a deployed runtime.
5. Provide devices for mobile certification.

## Where the code stands at the end of this pass

Every gate that can be closed in this environment is closed, and every number below comes from a run
against the final code — not carried over from an earlier one.

| Gate | Result |
|---|---|
| Backend suite, clean environment, forward | 2,633 / 0 |
| Backend suite, reverse order | 2,633 / 0 |
| Backend suite on a migrations-built database | 2,633 / 0 |
| Fault injection (archival, event bus) | 6 / 0 and 7 / 0, every order |
| Browser E2E | web 2/2 · partner-web 3/3 · admin-panel 3/3, isolated backend |
| `tsc --noEmit` | 0 errors — backend, web, partner-web, admin-panel |
| Schema drift | clean on dev, test and the migrations-built database (2,976 fields, 219 tables) |
| Load profile, 180 s | `k6 exit 0` — all 6 flows, all 12 latency thresholds, 0 errors |
| Security / auth regression | 124 / 124 |
| Live dev ledger after the host crash | 975 journals, 2,295 lines, 0 unbalanced |

**Performance, the one gate that was FAIL, is now PASS — and the old diagnosis was wrong.** It was
never "this hardware is the ceiling". Two measurable defects were: `create()` ran at SERIALIZABLE,
whose page-granular predicate locks aborted 48% of first attempts between creators that shared
nothing, and every authenticated request made four database round trips. Fixing both took
booking_create p95 from 2,810 ms to 549–653 ms, heartbeat from 466–772 ms to 331 ms, and whole-system
throughput from 437 to 653–698 req/s. No threshold was changed.

## Final decision: **NOT ENTERPRISE RELEASE READY — EXTERNAL BLOCKERS ONLY**

No release-critical item is failing for a reason engineering can act on in this environment. What
remains needs a decision, a credential, production infrastructure or physical hardware:

| # | Blocked gate | Owner | Exact unlock |
|---|---|---|---|
| 4 | C1/C2 historical refunds (₹3,464) | Business | written authorization to issue them |
| 8 · 32 | Tax model + D1–D3 | Business | the four decisions in `docs/release-business-decisions.md` |
| 15 · 26 | Mobile / background location | Ops | a physical device or AVD (`adb devices` is empty) |
| 21 · 29 | External alert + Sentry delivery | Ops | Slack / SMTP / PagerDuty / Sentry credentials |
| 28 | PITR | Ops | WAL archiving, off-host storage, an agreed RPO/RTO, a drill |
| 30 | Float → paise | Finance + Ops | production database, verified backup, finance sign-off |
| — | Twilio log review for 2026-09-20 | Ops | console access (real SMS were sent before the egress barrier) |

Engineering has prepared everything that precedes each of these: runbooks, migration plans, the
device checklist, the alert routing tree and the refund request document.


# Phase 12–14 certification: customer experience, partner experience, admin control plane

**Status, 2026-10-06: closed for backend, customer web, partner web and the admin panel. The two mobile apps are out of scope by the owner's instruction and are NOT certified here.** Nothing is deployed and the work is committed locally as `f867001` on `cursor/stage-e-step-13-certification` and has not been pushed. Uncommitted changes under `homigo-mobile` and `homigo-partner-mobile` are not part of it. No test, seed or browser run wrote to the live database; two side effects on the owner's own running development backends are recorded in section 20.

Statuses used: **PASS** (verified, evidence named), **NOT VERIFIED** (built, not exercised end to end), **OUT OF SCOPE** (owner's instruction), **NOT BUILT**.

Naming: the root files `PHASE_12_*.md` and `PHASE_13_*.md` describe unrelated work (ML/MLOps and the Intelligence Operations Center). This document is about the service domain.

## 1. Executive summary

- Most of Phase 12–14 already existed. The work was verification and gap closure, not a rebuild. No second pricing, booking, payment, matching, audit or RBAC system was added, and no migration was written.
- Verification found the working tree red before any change: booking creation had been made to require a quote token, and about 55 test suites and two production callers had not been updated. All are fixed.
- Phase 14: six ways to publish or approve without the intended control are closed. The admin can now see what changed between versions, who did what, and manage the category tree.
- Phase 13: what a partner reads follows the partner's stage with the job; an allow-list test covers the job list and detail.
- Phase 12: per-service reviews, a "Your professional" section built only from enforced requirements, serviceability at address choice, refresh-safe idempotency, and no fabricated content.
- A later pass checked every section of the Phase 12–14 specification against the code and built what was missing: all eighteen publish gates as named results with real validators, the nine control-plane states, unschedule, a required reason for taking a service off sale, version restore, and the five customer serviceability statuses.
- Evidence: the last full backend regression was 4297 pass, 1 fail (368 files, 712 s). The one failure was an older test of the payment-mock rule that assumed a development process is never on a test database; the rule was changed on purpose (section 20), the test was corrected, and that suite with the two isolation suites was re-run alone: 25 pass, 0 fail. The full suite was not run again after that test-only change (section 14); six report-writing certification suites 52 pass; signed-in browser runs of the admin panel (22 steps), the customer booking page (11), the partner job page (4) and one booking driven through payment and the partner's whole job in two browsers (34) all pass, with 0 accessibility violations and no horizontal overflow.
- A final pass closed the five items left open: a pending revision can be approved for a later time, the publish gate checks that a required training module is still published, the legacy on/off toggle requires a reason, latency was measured (section 13), and a payment plus the partner's arrival-to-completion flow were driven in a browser. That browser run found and fixed a regression introduced earlier the same day (section 7).
- Not covered: both mobile apps, a payment against the real gateway (the browser run used the backend's own signed test order, no gateway call), and the items in section 18.

## 2. Existing-state audit

| Area | Finding | Evidence |
|---|---|---|
| Customer web flow | 11 of 13 steps existed. The stepper was cosmetic and serviceability ran only at confirm. | `apps/web/src/app/book/BookPageClient.tsx` |
| Customer web content | Backend content first, then an approved fallback, then "confirmed during booking". A fabricated "AI Recommendation" card and a "Save More" badge were shown for every service. | `apps/web/src/lib/catalog/content.ts` |
| Customer reviews, professional | No per-service review list and no customer-safe professional information existed. | `apps/backend/src/routes/ratings.ts` |
| Booking page requests | Every load asked the server for slots of a placeholder service (404) and a quote for the wrong service (400) before the catalogue resolved. Found only in the browser run. | section 11 |
| Partner flow | All 13 steps exist on backend and partner web. | `apps/backend/src/routes/bookings.ts`, `providers.ts` |
| Partner payloads | The forbidden-key strip ran on the detail only. A partner kept the customer's surname, photo and masked phone after the job ended, and an offered partner received the customer's free-text note. | `provider.service.ts`, `booking.service.ts` |
| Admin gate | The rail the admin saw and the gate the server enforced were two different functions. | `apps/backend/src/lib/service-domain.ts` |
| Admin approval | Six bypasses (section 9). No test covered approval or scheduling. | `service-publish-governance.integration.test.ts` |
| Quote requirement | `bookingService.create` refused every request without `quoteToken`; the provider booking route and the assistant's booking tool could not supply one. | `booking.service.ts`, section 14 |
| Test database | `homigo_test` held 48 providers left by earlier runs. Rebuilt from the migration history on 2026-10-06. | section 15 |

## 3. Reused systems

Service catalogue and `catalog_config`; `service_config_versions` (its existing `DRAFT` status carries pending revisions); the publish gate functions; the lifecycle state machine; the quote token and pricing service; booking idempotency; the privacy policy engine; `AuditLogService` and the activity log; admin route permissions; the retention scheduler tick for scheduled go-live; the ratings table; `capabilityRequirementsFromConfig` (the function matching uses) for the customer's professional statements.

## 4. New implementations

**Backend**
- One publish gate: `validateForActivation` is derived from `publishGateResults`; `isBlockingGate` is the single rule.
- `approvalContentHash`, `contentDiff`; approvals are bound to the hash. `publishAuthorization` is the one check for every path into LIVE.
- `approve()` requires review or paused state, a passing gate, the expected version or content hash, and writes by compare-and-set.
- Pending revisions for live services: `proposeRevision`, `approveRevision`, `rejectRevision`. An approver can give a go-live time: the revision stays pending, is applied by the scheduler tick at that time, and is refused then if the live service changed in between.
- The publish gate reports `TRAINING_MODULE_UNAVAILABLE` when a provider requirement names a training module that is missing or unpublished.
- `PATCH /api/admin/services/:id/status` requires a reason to switch a live service off (`REASON_REQUIRED`).
- Isolation of a verification stack: `lib/isolated-redis.ts` (a process on a test database never takes the developer's Redis from `.env`), and `liveProviderAllowed` / `paymentMocksAllowed` now treat a database whose name contains "test" as test work whatever `NODE_ENV` says (section 20).
- Control tower reads: `GET /api/admin/services/:id/versions/diff`, `GET /api/admin/services/:id/audit` (permission `AUDIT_LOGS/READ`), admin names resolved per response.
- Category management: `POST /api/admin/service-categories`, `PUT /api/admin/service-categories/:id` (slug immutable; a category holding a live service cannot be switched off; two levels enforced by the database).
- Environment-aware policies `liveEditPolicyFor` and `publishRequiredSections` (section 17).
- The eighteen publish gates as named results (`PUBLISH_GATES`): every gate reports a status for every service, and availability, serviceability, matching and the platform money policy have real validators.
- The nine control-plane states (`controlPlaneState`), `POST /api/admin/services/:id/unschedule`, a required reason for taking a service off sale with the count of bookings still open, and `POST /api/admin/services/:id/versions/:version/restore`.
- `GET /api/services/:id/serviceability`: five customer statuses and one sentence (`lib/customer-serviceability.ts`).
- Partner boundary: stages `offer` / `owner` / `history`, `partnerJobNote`, `partnerCancellationReason`, `partnerHoldView`, `unknownPartnerBookingKeys`; the strip pass also runs on the job list.
- Customer: `GET /api/services/:id/reviews`; `professional` on the service detail.
- Quote requirement: `POST /api/providers/:id/book` forwards `quoteToken`; the assistant's booking tool returns the server's total first and books only against the total the customer confirmed.

**Admin panel**: validation rail using the server's blocking rule, hash-bound approve, pending-revision panel, version history with "what changed", audit trail, category manager, people shown by name.

**Customer web**: reviews and professional sections, serviceability status at address choice, confirm disabled when unserviceable, attempt key in per-tab storage, a stepper that follows the real step, no request before the service is resolved, keyboard-reachable day and time strips.

**Partner web**: the job page's own read now sits under the key every booking action and realtime frame refreshes (`src/lib/booking-cache.ts`); starting and completing a job refresh the step list, the start gate and the safety state themselves.

**Tests added**: `isolated-redis.test.ts`, `apps/partner-web/tests/job-detail-refresh.test.ts`, fixture script `apps/backend/scripts/browser-journey-seed.ts`, `service-publish-governance.test.ts`, `service-publish-governance.integration.test.ts`, `service-control-tower.integration.test.ts`, `partner-projection.test.ts`, `partner-boundary.integration.test.ts`, `booking-quote-callers.integration.test.ts`, `service-reviews.integration.test.ts`, `customer-professional.test.ts`, `apps/web/tests/booking/booking-attempt.test.ts`; helper `helpers/quote-token.ts`; browser fixture script `apps/backend/scripts/browser-verify-seed.ts`.

## 5. Removed duplicates and dead content

- The second gate implementation; one function remains.
- The textual "partner brief leak" check, which matched the word "matching" in a description. It is now a field allow-list.
- Customer web: the fabricated recommendation card and its handler, the "Save More" badge, "Your data is 100% protected".
- A stale contract test asserting that no matcher reads the preferred-provider flag (section 17, item 5).

## 6. Customer journey (Phase 12) — web

| Gate | Status | Evidence |
|---|---|---|
| Service detail renders, with reviews | PASS | Browser, 4 viewports; reviews response mocked for the render, endpoint verified by 4 integration tests and live HTTP |
| Professional section | PASS (backend) / NOT VERIFIED (browser) | `customer-professional.test.ts` (6 tests). No fixture service carries provider requirements, so the section was not rendered |
| Options, variants, quantity, add-ons | PASS (backend) | Server-validated by `resolve-selection`; existing suites. Not re-driven in the browser |
| Quote authoritative | PASS | Create refuses without a valid quote; the booking page shows the server's total; no refused request on load |
| Serviceability | PASS | 8 pure + 5 integration tests for the five statuses (AVAILABLE, LIMITED, NOT_AVAILABLE, NEEDS_CONFIRMATION, TEMPORARILY_UNAVAILABLE). Browser: the server's sentence is shown at address choice; outside the area both confirm controls are disabled; only the service in the URL is asked about |
| Date and time | PASS | Strips are keyboard-reachable; a slot was chosen and booked in the browser |
| Booking idempotency | PASS (unit) | 7 tests; key survives a refresh. One real confirm was driven; a repeated confirm was not |
| Payment | PASS (test order) / NOT VERIFIED (real gateway) | Browser: booking created with the server quote (₹550), order created, signature produced and verified by the backend, "Booking confirmed" shown, dispatch withheld until paid. The stack had no gateway credentials by construction, so no call left the machine. A production build of the customer web refuses this test checkout, as intended; the run used the development build |
| No fabricated content | PASS | Browser |
| Accessibility, responsive | PASS for the two pages run | section 11–12 |

LIMITED means fewer than half of the chosen day's times are free, or none; that threshold is a presentation rule in `lib/customer-serviceability.ts`, not a business policy.

## 7. Partner journey (Phase 13) — backend and partner web

| Gate | Status | Evidence |
|---|---|---|
| Eligible jobs, brief, requirements, materials, tools, arrival, start PIN, execution, quality, proof, completion | PASS | Phase 10/11 suites in the full regression |
| Customer privacy by stage | PASS | `partner-boundary.integration.test.ts`; the note protection was disabled once to confirm the offer and completed tests fail |
| Allow-list on job list and detail | PASS | Same suite: offered, accepted, in progress, completed |
| Admin text and incident ids withheld | PASS | `partner-projection.test.ts` |
| Job page in the browser | PASS | Signed-in partner: job renders, masked phone only, no money or internal fields, 0 accessibility violations |
| Driving arrival → completion in the browser | PASS | One booking, two browsers, 34 of 34 steps: offer shown without phone or house number → accept → on my way → arrived → Start not offered until the on-arrival requirement is recorded → PIN requested, shown on the customer's own page → wrong PIN refused (`OTP_INVALID`) → right PIN starts → Mark complete not offered while the plan is unfinished → step with a note, step with a photo, optional step skipped with a reason → checklist ticked → proof uploaded → complete. Verdict `PASS_WITH_EXCEPTION` (the skipped optional step); the customer's list shows the job finished at ₹550 |
| Job page follows the partner's own actions | PASS (was failing) | The first journey run showed the page still saying ACCEPTED, lifecycle rows "Pending" and every step "Start the job first" after the server had started the job. Cause: an edit earlier this session moved the page to a cache key nothing refreshed. Fixed test-first (`job-detail-refresh.test.ts`, 7 tests); partner web unit tests 129 pass |

## 8. Admin control plane (Phase 14)

| Gate | Status | Evidence |
|---|---|---|
| Lifecycle transitions enforced server-side | PASS | integration suites |
| Validation rail = enforced gate | PASS | pure + browser. All 18 gates listed with a status in the browser |
| Nine control-plane states | PASS | 4 pure tests + browser: LIVE, PAUSED, REVIEW, SCHEDULED, APPROVED observed |
| Review shows what changed | PASS | pending revision panel and version diff, browser |
| Approval auditable and bound to content | PASS | integration + browser |
| Approve by a different admin publishes; proposer cannot | PASS | integration + browser |
| Scheduling and unscheduling | PASS | integration + browser. A pending revision can be approved for a later time: it stays pending, shows when and who approved, and the customer catalogue keeps serving the live price until then (3 integration tests + browser) |
| Pause, deprecate, archive | PASS | A reason is required on the lifecycle route and on the legacy `PATCH /status` toggle, and is recorded; the answer reports open bookings. Integration + browser |
| Version history and diff | PASS | 2 integration tests + browser |
| Audit trail | PASS | 2 integration tests + browser |
| Category management | PASS | 5 integration tests + browser |
| RBAC | PASS | 401 / 403 asserted on every new route |
| Capacity, provider earnings, structured refund editors | NOT BUILT | These are platform policies, not per-service configuration (section 9) |
| Restore a version | PASS | 2 integration tests + browser. Restores price, duration and configuration as a NEW version through the same gate and approval; name and description are not part of a version snapshot and are not restored |

The 9-state vocabulary maps onto the existing enum (VALIDATING = `CONFIGURATION_REQUIRED`, REVIEW = `READY_FOR_REVIEW`, LIVE = `ACTIVE` / `PUBLISHED`). APPROVED and SCHEDULED are recorded on the service, not enum values.

## 9. Publish gate

Bypasses found and closed, each with a test that failed first:

1. `PUT /services/:id` with `isActive:true` published a service nobody approved.
2. The same call ignored a scheduled go-live time.
3. A price edit by the approved editor kept the approval (price is outside `catalog_config`).
4. `approve()` accepted a draft.
5. `approve()` accepted a configuration the gate would refuse.
6. `approve()` did not check what the approver had reviewed and overwrote concurrent edits.

| Gate | Behaviour |
|---|---|
| Pricing, add-on compatibility, duration, materials, equipment, customer content (name, description), taxonomy | Critical. Blocks. |
| Variant, eligibility | Critical for the capability profiles that define them. |
| Safety, quality, partner execution plan | Critical on a deployed environment before a first publish; a warning on a developer machine. Structure of a configured plan is always critical. |
| Availability | Critical when the rules can never offer a slot (window closes before it opens, same-day with a day of lead time, lead time beyond the booking horizon, no booking mode, all-day with a window). Warning when absent. |
| Serviceability | Critical when a serviceability check is required but no area is named. Warning when absent. |
| Provider requirements | Warning when absent. Critical when listed in `SERVICE_PUBLISH_REQUIRES`. A named training module that is missing or unpublished blocks the publish (`TRAINING_MODULE_UNAVAILABLE`), because no partner could ever qualify. |
| Matching | Critical when every configured weight is zero. Otherwise passes, or reports that platform weights apply. |
| Booking policy, cancellation, refund | Validated against the platform policy each booking freezes (`cancellation.v2`): it must have a version and tiers, and in every tier the fee and the refund must add up to the amount paid. A malformed platform policy blocks every publish. There is no per-service fee table, so none is validated. |
| Capacity, provider earnings | Outside the eighteen gates: platform settings, reported as not applicable. |

## 10. Security and data exposure

- Partner: stage-aware customer data; note withheld at offer and after the job; a hold's release reason and incident id withheld; a cancellation reason shown only to the partner who wrote it. **PASS**.
- Still reaching the partner, by decision: the job value with the commission rate, base price, add-on prices, a step reset reason. `caseId` on the completion view was reviewed and kept: the assigned partner already reads that case through the cases endpoint.
- Customer: reviews expose a first name and an initial; the professional section exposes no internal code. **PASS**.
- Admin: actor names are a name only, no email or phone; the audit trail returns a fixed set of fields. **PASS**.
- Cross-role access asserted on the new routes (customer → 403, no token → 401, another partner → 404).
- Not run this session: a wider IDOR sweep, stale-token and replay tests beyond the existing suites.

## 11. Accessibility

axe (`wcag2a` + `wcag2aa`), Chromium, isolated stack on `homigo_test`, after scrolling each page:

| Page | Viewport | Violations |
|---|---|---|
| Service detail (public) | 320, 390, 768, 1280 | 0 |
| Booking page (signed-in customer) | 390, 1280 | 0 |
| Admin services, service open (signed-in admin) | 1280 | 0 |
| Partner job page (signed-in partner) | 390 | 0 |

The first booking-page run found one serious violation at 390 px: the day and time strips scroll horizontally but could not be reached by keyboard when every slot was disabled. Fixed and re-run. Other pages were not run.

## 12. Responsive

No horizontal overflow on: service detail at 320 / 390 / 768 / 1280; booking page at 320 / 390 / 768 / 1280; partner job page at 320 / 390 / 1280; admin services at 390 / 1280.

## 13. Performance

**MEASURED, on a developer machine only.** Isolated backend on `homigo_test` (185 services in the catalogue), no Redis (so no shared cache: every read is computed), database pool of 5 connections, backend and client on the same laptop. 100 sequential calls per endpoint after 5 warm-up calls, then 100 more at 10 at a time. Every call answered 200 (201 for the 12 booking creates). Milliseconds:

| Endpoint | p50 | p95 | p99 | p50 at 10 concurrent | p95 at 10 concurrent | requests/s at 10 |
|---|---|---|---|---|---|---|
| Customer: service listing (20) | 1.4 | 7.1 | 7.5 | 12 | 17 | 844 |
| Customer: service detail | 27 | 40 | 49 | 38 | 64 | 237 |
| Customer: service reviews | 33 | 211 | 262 | 61 | 105 | 145 |
| Customer: price quote | 44 | 60 | 79 | 56 | 78 | 170 |
| Customer: serviceability | 74 | 210 | 884 | 338 | 687 | 25 |
| Customer: slot availability | 122 | 164 | 187 | 601 | 802 | 16 |
| Customer: booking detail | 35 | 48 | 57 | 55 | 67 | 174 |
| Partner: job list | 32 | 47 | 57 | 60 | 96 | 152 |
| Partner: job detail | 40 | 59 | 73 | 70 | 99 | 128 |
| Partner: job execution steps | 11 | 33 | 34 | 39 | 56 | 233 |
| Admin: service list | 50 | 72 | 78 | 198 | 297 | 47 |
| Admin: service detail + 18 publish gates | 34 | 65 | 80 | 60 | 84 | 161 |
| Admin: version history | 27 | 43 | 46 | 36 | 57 | 252 |
| Admin: audit trail | 24 | 34 | 43 | 29 | 69 | 265 |
| Customer: booking create (write) | 223 | 308 | 308 | — | — | — |

Reading it:
- No latency budget exists in the project for these endpoints, so none is claimed as met. These are a baseline, not a production figure.
- Publish validation is not a bottleneck: the admin service detail, which evaluates all eighteen gates, is in the same range as a plain read.
- Serviceability and slot availability are the slowest reads and the only ones that degrade sharply under concurrency. Each computes a day of slots against provider calendars and takes several database round trips; with a pool of 5 they queue. This should be measured again on a production-sized pool before launch.
- Known costs unchanged: the reviews endpoint runs three queries; the audit trail filters the activity log by a text match on the service id, bounded to 200 rows, with no supporting index.

## 14. Test evidence

All backend runs: from `apps/backend`, absolute paths, `--timeout 45000`, `homigo_test` (each log shows `injected env (8) from .env.test`).

| Run | Result |
|---|---|
| Full backend regression, after every change in this document | the last full backend regression was 4297 pass, 1 fail (368 files, 712 s). The one failure was an older test of the payment-mock rule that assumed a development process is never on a test database; the rule was changed on purpose (section 20), the test was corrected, and that suite with the two isolation suites was re-run alone: 25 pass, 0 fail. The full suite was not run again after that test-only change |
| Six report-writing certification suites (chaos, completion, operations, scalability, soak, failure recovery), on the rebuilt database | 52 pass, 0 fail. They regenerated 15 certificate files under `apps/backend/docs/` |
| Backend typecheck / lint (`eslint src --max-warnings 0`) | exit 0 / exit 0 |
| Customer web: typecheck, lint, unit tests | exit 0, exit 0, 106 pass |
| Admin panel: typecheck, lint | exit 0, exit 0 |
| Signed-in admin browser run | 22 of 22 steps pass (states, 18 gates, revision scheduled for later then approved, diff, audit, restore, pause with reason, schedule and unschedule, categories) |
| Signed-in customer browser run | 11 of 11 steps pass, no console error, no refused request |
| Signed-in partner browser run | 4 of 4 steps pass, no console error |
| Two-browser journey: payment and the partner's whole job | 34 of 34 steps pass. No request left the machine except one Google Maps script the run blocked |
| Partner web: typecheck, lint, unit tests | exit 0, exit 0, 129 pass |
| Isolation and egress barrier suites | 19 pass |
| Latency measurement | section 13 |

Two earlier full runs the same day: 4223 pass / 2 fail (one caused by the history-stage change and fixed, one a stale preferred-provider test rewritten after the owner's decision), then 4237 pass / 0 fail.

## 15. Database and migrations

No schema change. Pending revisions use the `DRAFT` value the `service_config_versions.status` check already allowed. `publishApproval.contentHash` is an optional JSON field; an approval stored without it is treated as stale.

`homigo_test` was dropped and rebuilt from the migration history (`setup-test-db.ts --reset`): 435 database-enforced invariants present, schema drift OK. The script targets only a database whose name contains "test".

## 16. Scope and blockers

- **Mobile apps: OUT OF SCOPE** by the owner's instruction of 2026-10-06. Two small edits made earlier that day remain in `homigo-mobile` (a reviews section on the service detail, one subtitle); they typecheck and were not run on a device. Mobile detail parity (options, add-ons, price) was started and stopped before any file changed.
- No external blocker remains for the web and backend scope.

## 17. Owner decisions (delegated 2026-10-06, implemented)

1. **Four-eyes on live edits: on, as soon as it can work.** Deployed, with at least two active admins who can approve: a change to a live service's approved content waits for a different admin. With one approver it stays direct. `SERVICE_LIVE_EDIT_POLICY=direct|four-eyes` forces either.
2. **A first publish needs safety, quality and an execution plan, on a deployed environment.** `SERVICE_PUBLISH_REQUIRES=none` or a list overrides. A live service is never unpublished by this.
3. **Admin text and partners.** Hold release reason, incident id and a cancellation reason the partner did not write are withheld. A step reset reason still reaches the partner.
4. **Job value stays visible to partners**, with the commission rate beside it.
5. **Preferred provider is a ranking boost only**; the hard gates never read the flag.
6. **The assistant's booking tool confirms the total first** and books only at that total.

At launch: the 25 live services stay live; a paused or new service cannot be published until it has safety, quality and execution content; live edits wait for a second person once a second approver exists.

## 18. Remaining risks

- The deployed defaults in section 17 are exercised only through their pure rule functions: every test process is a known-local environment.
- The assistant's second call proves the figure matches the server's, not that a person saw it.
- A booking queued offline on mobile is replayed with its original quote token; an expired token is refused after the app said the booking was saved.
- `approve()` relies on `updatedAt` for its compare-and-set; a raw SQL write that does not touch it would not be detected.
- The partner allow-list is checked field by field only for `customer`, `address` and `service`.
- Seed scripts and the schema default still create services as `ACTIVE` without the gate.
- Audit rows for approve, lifecycle and versioned edits are written after the response, outside the transaction; revision and category changes wait for the audit write.
- The audit trail's text match on the activity log will slow as that table grows.
- A payment against the real gateway was not made; the browser run proves the booking, order, signature check and dispatch-after-payment path, not the gateway's own checkout.
- The slot grid does not consult live partner presence while booking creation does (a known, counted difference: `booking_create_provider_unavailable_total`). In the journey runs a slot shown as open was refused once, when the only partner was busy with two jobs left by earlier failed runs.
- The partner web sends a GPS fix only when the browser reports a new position. A headless browser reports once, so its fix aged past the 60-second matching window and the partner stopped being matched until the run moved the position by a metre every few seconds. Whether a stationary real device (a laptop in particular) behaves the same was not tested.
- Accepting an offer in the first second after a page reload was refused once (400) until the page's new presence session had sent a heartbeat; a retry succeeded.

## 19. Status matrix

| Phase | Backend | Web client | End to end in a browser | Mobile |
|---|---|---|---|---|
| 12 Customer | PASS | PASS | PASS for detail, booking page and a paid booking (test order; real gateway NOT VERIFIED) | OUT OF SCOPE |
| 13 Partner | PASS | PASS (one regression found in the browser and fixed) | PASS: offer → accept → arrival → PIN → steps → checklist → proof → complete | OUT OF SCOPE |
| 14 Admin | PASS | PASS | PASS: approve, revision (now and scheduled), diff, audit, restore, categories | not applicable |

## 20. Isolation findings of 2026-10-06

**The slot answer that flipped (was listed as unexplained).** In two browser runs the booking page said "No times are left on this date" for a date on which direct calls a minute later found every slot free. Cause, proven:

1. The isolated backend was started with `--env-file=.env.test`, which sets `REDIS_URL=` (empty). `load-env` dropped the empty value and took the developer's Redis from `.env`.
2. The owner's own development backends were running on the live database and the same Redis. Both sides call their environment "dev", so they shared one feature-flag cache key (`ff:dev:matching.strict_service_capability`, 15-second lifetime).
3. That flag is enabled in the live database (since 2026-09-29) and has no row in the test database. Whichever backend filled the cache decided the answer for both: when the live one did, the isolated backend matched in strict mode, rejected the only fixture partner as `SERVICE_CAPABILITY_MISSING`, and every slot became `NO_QUALIFIED_PROVIDER`.
4. Two earlier guesses (the partner's sign-in, presence expiry) were tested and ruled out.

Fix: a process on a database whose name contains "test" keeps a Redis only if its launcher named one (`lib/isolated-redis.ts`, 4 tests). After it, `/health` reports `"redis":"disabled"` and a three-minute watch answered 29 of 29 slots free every time. The same sharing worked in the other direction: for up to one cache lifetime at a time the owner's live development backend could have read the test database's "flag off" answer, that is, matched in the lenient mode. No row was written by this.

**A second hole, closed before it was used.** The same stack ran with `NODE_ENV=development`, and the barrier that keeps test processes away from real providers keyed on `NODE_ENV=test` alone, so the isolated backend held real payment, SMS and maps credentials. The barrier and the payment-mock rule now also key on the database name (4 tests). No payment order, SMS or maps call was made from the isolated stack before the fix; the only payments in this document were made after it, with no gateway credentials in the process.

**The owner's running development backends.** Two `bun --watch` backends on the live database were started at 12:25 IST and reload on every saved file under `apps/backend/src`. Every backend edit of the afternoon was therefore loaded by them as it was saved. A read-only check of the live database found no service, category, configuration-version or audit row created that day by this work; one booking of that day (`HOMIGO-20261006-00001`, 07:07 UTC) predates the afternoon's edits and matches the owner's own use.

**A leftover process.** Stopping the first isolated backend left its process alive, so for a while two backends, one on older code, answered on the same port. It was found by listing listeners and stopped before the runs recorded here.

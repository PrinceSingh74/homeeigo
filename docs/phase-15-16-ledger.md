# Phase 15 / 16 ledger

Running record of the Phase 15 (analytics, SEO, trust, reviews) and Phase 16 (final integration)
work. Statuses use only PASS / FAIL / BLOCKED / EXTERNAL / OWNER_DECISION_REQUIRED.

| Section | Status | Date |
|---|---|---|
| 15.0 Pre-audit | PASS (complete) | 2026-10-08 |
| 15.1 Analytics event architecture | PASS | 2026-10-08 |
| 15.2 Real customer funnel instrumentation | PASS | 2026-10-08 |
| 15.3 Analytics population governance | PASS | 2026-10-08 |
| 15.4 Analytics metrics | PASS (finops unit cost: owner decision, all-traffic operational allocation) | 2026-10-08 |
| 15.5 Admin analytics | PASS | 2026-10-08 |
| 15.6 SEO | PASS (dev server on :3011; the process on :3001 is a previous `next start` and does not contain this wiring) | 2026-10-08 |
| 15.7 Trust | PASS | 2026-10-08 |
| 15.8 Reviews | PASS | 2026-10-08 |
| 15.9 Cross-module integration | PASS | 2026-10-08 |
| Phase 15 overall | PASS (see "Phase 15 closure"). Phase 16 not started. | 2026-10-09 |
| Post-15 catalog / backlog hardening | closed (not a Phase 15 re-grade; see that section) | 2026-10-09 |
| 16.x | not started | |

## Carried forward (found, classified, not in the current section's scope)

- `src/__tests__/broadcast-accept-gate-context.test.ts:139` — `processQueueMs` and `tick` are
  undefined identifiers inside the `threw.length > 0` forensic branch (TS18004, pre-existing,
  commit f2236ca). The suite passes because the branch only runs when an accept throws — i.e. it
  would ReferenceError exactly when it is needed. Classification: test-infrastructure defect, not
  production. Fix in 16.14.
- ~~`bookings.data_origin` is not stamped at creation~~ — withdrawn in 15.3: `createBooking` already
  stamps the customer's non-business label. The real gaps were the fail-open origin read and labels
  applied after the fact (see 15.3).
- `finops-metrics.ts` `cost_per_customer` / `cost_per_order` divide external API spend (incurred by
  all traffic, test included) by unscoped user / payment counts. Resolved at closure by owner
  decision: all-traffic operational cost allocation (checker category B). See "Phase 15 closure".
- Admin dashboard `stats.averageRating` (`admin.service` overview) is the mean of `providers.rating`
  over business providers, consumed by `ExecutiveKpiGrid`, `ExecutiveBriefs`, `AiBriefingPanel`,
  `AdminDashboardCharts`. It is a partner-rating figure, not the review average. Scope: 15.4/15.5.
- Dev database `homigo_db` migration drift recorded in the pre-audit is unchanged; the additive
  `20261008140000_analytics_events` migration was applied to it and to `homigo_test`.

## 15.0 Pre-audit (2026-10-08)

### Existing (reuse, do not duplicate)

- Provenance: `DataOrigin` enum on `users`, `bookings`, `refund_requests`, `services`;
  population policy in `apps/backend/src/lib/analytics-scope.ts` (`analyticsWhere`,
  `analyticsWhereVia`, `analyticsSqlPredicate`, `isBusinessRow`); creation-time classification in
  `src/lib/data-provenance.ts` (`provenanceForNewUser`). Call-site governance:
  `scripts/classify-analytics-call-sites.ts` (DQ-7, part of `prebuild`).
- Domain events: transactional outbox `event_outbox` + `event_consumer_receipts` +
  `event_dead_letters`; catalog `src/events/catalog/event-types.ts`. Authoritative business
  stages already emitted in-transaction: `homigo.booking.created`, `.completed`, `.cancelled`,
  `homigo.checkout.started` (from `paymentService.createOrder`), payment success/failed.
- Prometheus counters: `service_view_total` (in `catalog.byId`), `service_quote_generated_total`,
  `booking_created_total`, `booking_completed_total`. In-process only, no attribution.
- Warehouse: Postgres → BigQuery ETL under `apps/backend/analytics/`, ADMIN routes `/api/analytics/*`.
- Service domain: `services` (+ `version` int), `service_config_versions` (immutable published
  JSON), `service_variants`, `service_addons`, `service_requirements`, `service_categories`;
  public predicate `CUSTOMER_CATALOG_WHERE` (`src/lib/service-domain.ts`).
- Quote: stateless signed token (`signQuote`), no quote row. Booking snapshot:
  `bookings.service_selection`, `service_config_version`, `service_config_snapshot`.
- Reviews: `ratings` (one per booking, unique `booking_id`); create requires COMPLETED + owner;
  photos ownership-validated (`lib/rating-photos.ts`); admin moderation `/api/admin/reviews`.
- SEO: server `generateMetadata` on `apps/web/.../services/[...path]/page.tsx`, `sitemap.ts`,
  `robots.ts`, Organization/Service/Breadcrumb JSON-LD, coming-soon noindex.
- Trust: `Provider.isVerified`, KYC, `PartnerBackgroundCheck` (status/expiry), `ProviderDocument`
  (expiry), compliance restrictions, `catalogConfig.warranty`, configured professional statements.

### Missing

- Persistent, attributable product funnel event store (service/version/variant/add-on/booking,
  provenance, environment, idempotency). No `service_click`, `variant_selected`,
  `option_selected`, `addon_selected`, `booking_started`, `repeat_booking` anywhere.
- Conversion metric for the booking funnel; review time window; verified-review concept;
  AggregateRating/FAQ/Offer structured data; noindex on admin and partner apps.

### Partially implemented

- `Service.seoTitle/seoDescription/seoKeywords` and `catalogConfig.seo.noindex` stored and returned
  by the API, never consumed by web `generateMetadata`.
- Provider detail page client-only (no server metadata).
- Repeat-customer definitions exist in `customer-intelligence` / `partner-os` (COUNT > 1 COMPLETED),
  not used by the admin analytics page.

### Incorrect / unsafe (to fix in the owning section)

- `admin.service.ts:830` `repeatBookingRate: 0.65` — hardcoded KPI rendered on the admin analytics
  page (15.4/15.5).
- `GET /api/providers/:id/reviews` does not filter `isPublic` / `isFlagged` (15.8).
- Public rating aggregates (`/api/ratings/recent`, `/api/services/:id/reviews`, stats overview)
  are not provenance-scoped (15.3/15.8).
- `ExecutiveKpiGrid` labels completion rate as "Growth Rate" and "Utilization" (15.5).
- Admin reviews page "Live / Flagged" KPIs are page-local, not totals (15.8).
- Hardcoded trust copy: catalog `TrustSections` "Verified professionals", mobile mapper fallback
  "verified experts", legal copy (15.7).
- Two completion-rate definitions disagree (admin UI vs geo/fulfillment) (15.4).
- `marketing_attribution_touches.revenue` is a free float, not ledger-backed (15.4 risk).

### Environment / drift recorded (not caused by this work)

- Dev DB `homigo_db`: committed migration `20261008120000_location_mocked_signal` not applied;
  DB has `20260817090000_notification_delivery_claim` that is not in the repo.
- Test DB is built by `scripts/setup-test-db.ts` (guarded to databases named `*test*`).

Schema impact required: YES (additive — funnel event store).

## 15.1 Analytics event architecture — PASS (2026-10-08)

**Scope.** An event store and ingest boundary for the twelve funnel names, with enough context to
attribute a step, with provenance the client cannot assert, and with idempotent redelivery.
Instrumenting the product flows is 15.2 and deliberately not done here.

**Existing implementation reused.** `event_outbox` keeps the authoritative domain events; the
Prometheus counters keep counting; `analyticsWhere()` keeps being the only population policy;
`CUSTOMER_CATALOG_WHERE` decides what a customer may be looking at; `parseCatalogConfig` /
`service_variants` / `service_addons` decide what a selection is. Nothing was duplicated.

**Gaps closed.** No attributable funnel store existed. Six of the twelve names existed nowhere.
Nothing tied an event to a service version, a variant, a population, or an environment, and
nothing stopped a redelivery from counting twice.

**Changes.**

| File | Change |
|---|---|
| `prisma/schema.prisma` | `AnalyticsEvent` + `AnalyticsEventName` / `Source` / `Platform` enums; three back-relations |
| `prisma/migrations/20261008140000_analytics_events/migration.sql` | additive: three enums, one table, unique `event_id`, six indexes, three `ON DELETE SET NULL` FKs |
| `src/services/analytics-events.service.ts` | validation, authority split, provenance stamping, metadata sanitising, idempotency |
| `src/routes/analytics-events.ts` | `POST /api/analytics/events` (optional auth) |
| `src/index.ts` | route registered |
| `src/middleware/api-rate-limit.middleware.ts` | 60/min per identity on the ingest path |
| `src/lib/analytics-scope.ts` | note that this table carries the column directly |
| `scripts/setup-test-db.ts` | table added to the late-additive list |

**Design decisions.**

- Two doors, not one. `ingestClientEvent` accepts only the six browse/selection names; the six
  authoritative names (`QUOTE_GENERATED`, `CHECKOUT_STARTED`, `BOOKING_CREATED`,
  `BOOKING_COMPLETED`, `CANCELLED`, `REPEAT_BOOKING`) return 403 from the public route and are
  written by `recordAuthoritativeEvent` from the service that already committed the fact (15.2).
- Provenance is read, never received: the actor's `data_origin`, or the booking's when a booking
  is attached. `dataOrigin` is not in the request schema at all.
- Idempotency is the unique `event_id`: a second delivery returns 200 `duplicate: true` with the
  first row's id, and a redelivery that disagrees about the payload still stores nothing new.
- Every id is checked against the server's own catalogue — service must be customer-visible,
  version must exist, variant/add-on must belong to that service, booking must belong to the actor.
- Metadata is a bounded allowlist (≤20 keys, ≤200 chars) with token/card/secret/OTP-shaped keys
  and values dropped before the write.

**Tests run.** `src/__tests__/analytics-events.integration.test.ts` — 15 tests, 83 assertions,
0 fail: valid, malformed (8 shapes), unauthorized (6 names), duplicate, cross-service variant,
unknown service / unpublished service / unknown version, booking belonging to another customer,
metadata sanitising, and the four population cases (fixture actor excluded, declared-REAL actor
included, anonymous UNKNOWN included, client claim ignored) plus booking-inherited provenance.
Regression: `analytics-scope-adoption`, `db-invariants`, `service-reviews` — 31 pass, 0 fail.
Guards: `check:analytics-scope` PASS (118 sites, no new unclassified site), `check:migration-safety`
PASS. `tsc --noEmit` clean for all changed files.

**Runtime evidence.** Backend started on the dev database (`homigo_db`, port 3000, `/health` 200).
`POST /api/analytics/events` with a real catalogue service: 201, replay 200 `duplicate: true` with
the same id; forged `BOOKING_CREATED` 403 `UNAUTHORIZED_EVENT`; unknown service 400
`SERVICE_NOT_FOUND`. Row read back from Postgres: `service_version_id = 10` (the service's real
version, resolved server-side), `environment = dev`, `metadata = {"listPosition": 1}` with the
`authToken` key dropped. The three probe rows were deleted afterwards (`analytics_events` count 0)
so no runtime probe enters a business population.

**Remaining risks.** The six authoritative names have a writer but no producers yet — that is
15.2, and until then the table holds only browse events. The table has no retention policy;
15.3/15.4 decide one. `occurredAt` is client-supplied within a ±5 min / 7 day window, so ordering
within a session is as good as the client's clock — acceptable for funnel counting, not for
anything financial, which is why no money metric may read this table.

**Status: PASS.**

## 15.2 Real customer funnel instrumentation — PASS (2026-10-08)

**Scope.** Wire the twelve names into the real customer funnel (web `apps/web`, mobile
`homigo-mobile`, backend) using only the 15.1 client and the 15.1 two-door contract. No new
analytics client, no new API, no metric, no dashboard (15.3+).

**Funnel map (event → real user action → component/service → source → implementation).**

| Event | Fires when | Where | Authority / identity |
|---|---|---|---|
| `service_view` | the detail page has rendered server-backed service data (effect keyed on service id + version, not on every render) | web `ServiceDetail.tsx`; mobile `app/service/[id].tsx` | client; `w_/m_` digest of session·name·service·version — refresh, back/forward and StrictMode re-effects reach the same id |
| `service_click` | the customer clicks a card / tile / search result / rail item | web `ServiceCard`, `ServiceTile`, `ServiceSearchInput` via `lib/analytics/service-click.ts`; mobile `CategoryRail`, `ServiceCategories`, `useAppNavigation` | client; identity includes the surface and the document instance, so a double-click is one row and a click after a reload is another |
| `variant_selected` | the customer changes the variant control | web `ServiceDetail`, `BookPageClient`; mobile `app/book.tsx` | client; server re-validates the variant belongs to the service (15.1) |
| `option_selected` | audience / tier / professional-preference actually changed | same components | client; `metadata.kind` names the option family |
| `addon_selected` | an add-on is added (removal is not a selection) | same components | client |
| `booking_started` | the Book CTA is used on the detail page, or `/book` is entered with a service (deep link) | web `ServiceBookingCTA`, `BookPageClient`; mobile `[id].tsx`, `book.tsx` | client; one id per session·service·version, so a refresh of `/book` is not a second start |
| `quote_generated` | `POST /api/bookings/price-quote` after `bookingPricingService.quote` returned ok | `routes/bookings.ts` → `recordQuoteGenerated` | server; `quote_<digest(token)>` — the signed token is the quote's identity; the token itself never enters metadata |
| `checkout_started` | the `CHECKOUT_STARTED` outbox event (gateway order), or a full-wallet checkout after its transaction committed | `analytics-funnel.consumer.ts`; `wallet-checkout.service.ts` → `recordWalletCheckoutStarted` | server; `checkout_<outboxEventId>` / wallet transaction id |
| `booking_created` | the `BOOKING_CREATED` outbox event | consumer | server; `booking_created_<outboxEventId>`; carries the booking's frozen `serviceConfigVersion` |
| `booking_completed` | the `BOOKING_COMPLETED` outbox event | consumer | server |
| `cancelled` | the `BOOKING_CANCELLED` outbox event | consumer | server; a failed cancel publishes nothing, so nothing is projected |
| `repeat_booking` | at `BOOKING_COMPLETED`, when the same customer already has an earlier COMPLETED booking | consumer → `priorCompletedBookingFor` | server; definition reused from `customer-intelligence.service.ts` (`repeatCustomerRatePct`: more than one COMPLETED booking, any service, any provider, no time window); `sameService` / `sameProvider` carried as metadata for the narrower readers |

**Existing implementation reused.** `event_outbox` + the consumer registry (`consumers/index.ts`,
new entry `analytics-funnel.v1`), `bookingPricingService.quote`, `wallet-checkout.service`, the
15.1 ingest service and route, `analyticsWhere()`, `funnelDigest` shared verbatim between web and
mobile. Nothing was duplicated; no second lifecycle, no second messaging path.

**Changes.**

| File | Change |
|---|---|
| `apps/backend/src/services/analytics-funnel.service.ts` | new: `recordQuoteGenerated`, `recordWalletCheckoutStarted`, `projectFunnelDomainEvent`, `priorCompletedBookingFor` |
| `apps/backend/src/events/consumers/analytics-funnel.consumer.ts`, `consumers/index.ts` | new consumer registered for the four booking/checkout domain events |
| `apps/backend/src/routes/bookings.ts` | price-quote route records the quote after a 200 |
| `apps/backend/src/services/wallet-checkout.service.ts` | wallet-only checkout recorded after commit (fire-and-forget) |
| `apps/web/src/lib/analytics/funnel.ts`, `service-click.ts` | new: the web client over `POST /api/analytics/events` |
| `apps/web/src/components/services-catalog/ServiceCard.tsx`, `cards/ServiceTile.tsx`, `ServiceSearchInput.tsx`, `services-catalog/detail/ServiceDetail.tsx`, `ServiceBookingCTA.tsx`, `app/book/BookPageClient.tsx` | instrumented |
| `homigo-mobile/src/lib/analytics/funnel.ts` | new: same contract, `m_` ids |
| `homigo-mobile/src/components/services/CategoryRail.tsx`, `ServiceCategories.tsx`, `hooks/useAppNavigation.ts`, `app/service/[id].tsx`, `app/book.tsx`, `types/backend.ts` (`version` mirrored) | instrumented |
| `apps/backend/scripts/e2e-analytics-funnel.ts` | fixture seed / read-back / cleanup for the browser E2E (binds the adversarial fixture to `salon-at-home` on the isolated stack only) |

**Tests.**

- `apps/backend/src/__tests__/analytics-funnel.integration.test.ts` — 15 tests: the six client
  steps one row each with actor + server version; double-click / refresh / back-forward collapse
  to one id while a different selection is another; client cannot mint any authoritative name;
  quote recorded from the real quote with fingerprint, version and amount, token never in
  metadata; failed quote (stale version, foreign address) records nothing; re-requested quote is one
  event per token; booking_created once via outbox with frozen version; idempotent create replay
  + outbox redelivery = one row; failed create = no row; checkout_started via outbox without
  secrets; wallet-only checkout once; booking_completed once; repeat_booking per the existing
  definition; cancelled once, failed cancel nothing; every fixture row outside the business
  population. 15 pass, 0 fail.
- `apps/web/e2e/analytics-funnel.spec.ts` — Playwright against an isolated stack (backend :3100 on
  `homigo_test`, web :3017, `.next-e2e`): real clicks on listing → detail → variant → audience →
  add-on → Book → `/book` quote → wallet checkout → booking; then rows read from Postgres: one row
  per step, `w_` ids, server version, `CUSTOMER_WEB`/`WEB` vs `BACKEND`/`SERVER`, origin from the
  actor, quote rows bounded by observed quote responses, no secret-shaped keys. Second test: the
  browser's forged `BOOKING_CREATED` is refused 403; a committed cancellation yields exactly one
  `CANCELLED` row. 2 pass, 0 fail.
- Targeted regression (40 files: analytics, quote/pricing, booking, payment, cancellation,
  completion, catalog governance, consumers/outbox, reviews/ratings, dispatch/matching,
  governance, db-invariants): 679 pass, 0 fail. Full backend suite (`bun test --max-concurrency 1`,
  395 files): 4767 pass, 14 skip (pre-existing env-gated: real-Razorpay and pool-of-one suites),
  0 fail. Web unit suite 239 pass, 0 fail. `tsc --noEmit`
  clean for web and mobile; backend clean except the pre-existing `broadcast-accept-gate-context`
  defect already carried forward. `check:analytics-scope` PASS.

**Runtime evidence (dev stack, backend :3000 / web :3001 / `homigo_db`).** Signed in as the
seed customer (`customer@homigo.demo`, origin INFERRED_SYNTHETIC), clicked “Dusting & Wiping” on
`/services`, viewed the detail page, used Book, reached `/book`. Rows read back: `SERVICE_CLICK`,
`SERVICE_VIEW`, `BOOKING_STARTED` (all `service_version_id = 10`, `environment = dev`,
`data_origin = INFERRED_SYNTHETIC` — stamped from the actor, not sent). The first two quote
attempts returned 400 `SERVICE_NOT_AVAILABLE` (Delhi/Gurugram address) and recorded nothing;
the Noida address returned 200 and recorded one `QUOTE_GENERATED` with fingerprint, version 10 and
`finalAmountPaise = 16400`. Back navigation and a hard refresh issued no new analytics request;
clearing the client's sent-list and reloading re-posted the same `SERVICE_VIEW` id and the table
still held one row. All four probe rows were deleted afterwards (0 remaining for the actor and the
session). The dev catalogue has no service with variants or add-ons, so `variant_selected` /
`addon_selected` runtime evidence is from the isolated-stack browser E2E (real UI, real API, real
rows), not from `homigo_db`. Fifteen pre-existing rows from the owner's own dev session today
(actor `Prince Singh`, booking `HOMIGO-20261008-00001`, gateway `CHECKOUT_STARTED`) were observed
and left in place — they are not probe data.

**Not done / carried.** `bookings.data_origin` still unset at creation (15.3). Analytics rows
inherit it correctly when it is set. *(Withdrawn in 15.3 — it is stamped; see carried-forward.)*

**Status: PASS.**

## 15.3 Analytics population governance — PASS (2026-10-08)

**Policy (existing, reused).** `analytics-scope.ts`: business = `data_origin` NULL (UNKNOWN) or
REAL. Booking-scoped facts follow the booking's label, customer-scoped facts the customer's;
payments / ratings inherit from the booking, subscriptions / invoices / benefits from the user, gift
cards (new map entry) from the purchaser. Public reviews: `publicReviewWhere()` (public, unflagged,
business). No second predicate exists (audited).

**Changes.**

| Area | Change |
|---|---|
| Booking provenance | `createBooking` refuses with `PROVENANCE_UNAVAILABLE` (503, Retry-After 3) when the customer's origin cannot be read — before any write. Was `.catch(() => null)` = business. |
| Late labels | `lib/provenance-propagation.ts`, run by `provenance-report --apply`: a newly labelled customer's NULL bookings and the NULL analytics rows of those bookings / that actor take the label. Only NULL children; REAL never overwritten; idempotent. |
| Reviews | `lib/public-reviews.ts`; admin summary returns `totalReviews / hiddenReviews / flaggedReviews / publishedReviews / publishedAverageRating`; public provider reviews vs owner view separated. Admin Reviews page and Marketplace HQ read the summary — no page-local totals, no `averageRating` review contract. |
| Scoped (business KPI / reporting) | membership analytics; finance GMV + daily trend; stats; partner-exec `fin_payment_success_pct` / `fin_chargeback_pct` (both sides); admin revenue report (all four streams); plan-catalogue member / churn / MRR and subscription revenue. |
| Deliberately unscoped (C) | `refundLiability` (feeds `totalLiabilities` + liability snapshots), `settlementPending` (gateway receivable, same rows as `payment-reconciliation`), chargeback console, reconciliation, settlement ops. |

**Durability.** DURABLE / auditable: `booking_created`, gateway `checkout_started`,
`booking_completed`, `cancelled`, `repeat_booking` (outbox → consumer → DLQ → replay).
BEST-EFFORT: client browse events, `quote_generated`, wallet-only `checkout_started` (after commit,
no outbox row — a failed write is logged and lost; the payment itself is unaffected).

**Tests.** `analytics-population.integration.test.ts` (17), `analytics-durability-fault.inject.ts`
(5, own process; red-checked against the old fail-open code), follow-up origin assertion in
`p10-s11-cases.integration.test.ts`, `service-reviews.integration.test.ts` updated to a business
population plus a hidden fixture review. Shared `helpers/outbox-drain.ts` parks other suites'
PENDING backlog (restored exactly) so drains reach the suite's own events.

**Status: PASS.**

## 15.4–15.9 — metrics, admin, SEO, trust, reviews, integration (2026-10-08)

**15.4.** One implementation in `marketplace-metrics.service.ts`, used by admin analytics and
customer-intelligence. Completion and cancellation are `fulfillment-rates.ts` (completed or
cancelled over finished; null when nothing has finished). Repeat is the locked lifetime rule
(more than one COMPLETED business booking, any service, any provider). Conversion is only
`quoteToBookingPct` (quoted business customers who also have an authoritative booking). Captured
GMV is SUCCESS `payments.amount_paid` plus COMPLETED wallet debits of `booking_wallet_payment`,
minus COMPLETED refund requests. The hardcoded `repeatBookingRate: 0.65` is gone. Partner
`completionRate` is rewritten with the same finished-bookings formula on the next metrics update
(no backfill). Finance overview GMV includes the wallet leg so it matches. `cost_per_customer` /
`cost_per_order` are operational finops metrics, not marketplace KPIs (see "Phase 15 closure").

**15.5.** Admin tiles name partner rating, completion, cancellation, repeat, and captured GMV for
what they are. `stats.averageRating` remains the partner-rating mean and is also returned as
`partnerRatingMean`. Review summaries stay the backend totals from 15.3.

**15.6.** List payload carries `seoTitle` / `seoDescription` / `seoKeywords` / `indexable`.
`generateMetadata` and the service JSON-LD read the live catalogue, not the taxonomy-only view.
FAQ schema is `detailContent` of that same row. AggregateRating only when the governed aggregate
exists. Sitemap lists live indexable services.

**15.7.** Blanket "verified professionals", background-check, on-time, and satisfaction-guarantee
copy on the customer web and mobile home surfaces was replaced with the approval gate and
service-configured checks. Per-service identity, background, certification, insurance, and warranty
statements still come from `customerProfessionalView` / `customerVisitPromise`, which only speak
when the matching gate requires them. No expiry column exists on background-check status
(NOT_DONE / PENDING / CLEARED / FAILED); certification and insurance already respect expiry and
revocation in `provider-capability.ts`.

**15.8.** No second public-review predicate and no client `verified` flag. Eligibility remains
the caller's own COMPLETED booking. Distribution is `summariseStars`.

**15.9.** Regression: analytics events, funnel, population, scope adoption, service reviews,
customer-professional, finance narrative, coverage brief, marketplace metrics — 141 pass, 0 fail.
Durability inject 5 pass (own process). Web truth + service-meta 55 pass. Scope checker PASS.
Admin and web `tsc` clean. Backend `tsc` still reports only the pre-existing
`broadcast-accept-gate-context.test.ts` TS18004.

**Runtime (dev backend :3000, Next dev :3011).** `GET /api/services?limit=100` bathroom-cleaning
`indexable: true`, rating 5, reviewCount 2. `GET /api/services/:id/reviews` distribution
`{1:0,2:0,3:0,4:0,5:2}` sums to `ratingCount` 2, average 5. Detail warranty is the stored 2-day
cover; `professional` is absent because this service does not require those gates.
`GET /services/home-cleaning/bathroom-cleaning` on :3011: title uses the service name and category
(no stored `seoTitle`), description `Deep bathroom sanitisation and descaling`, canonical
`https://homigo.app/services/home-cleaning/bathroom-cleaning`, robots index/follow,
AggregateRating 5 / reviewCount 2, FAQ present. Sitemap contains the service and not `/book` or
`/admin`. `robots.txt` disallows profile, wallet, bookings, book, settings. The process already
listening on :3001 is `next start` of an older build and was not restarted.

## Phase 15 closure — PASS (2026-10-09)

**Finops owner decision (locked).** `cost_per_customer` = external API spend ÷ every `users` row;
`cost_per_order` = external API spend ÷ every SUCCESS gateway payment. Spend is incurred by all
traffic, so both sides stay all-traffic; `analyticsWhere()` is not applied. Metric names and API
fields are unchanged; the Grafana tiles read "All-traffic cost / user" and "All-traffic cost /
successful payment". `unitCost` returns 0 for a zero, negative or non-finite denominator. Checker
category B. `finops-metrics.integration.test.ts` seeds all six origins and proves they all count in
the finops denominators while only REAL / UNKNOWN count in the marketplace metrics.

**Fixes at closure.**

- `ServiceDetail.tsx`: a selection made before the server detail (and so its version) loaded got an
  event id without the version; the same selection after a refresh then posted a second row. Selection
  events now wait for the detail. Found by the browser E2E (`OPTION_SELECTED: 2`), 4/4 after the fix.
- `ServiceDetail.tsx`: entitlements are requested only for a signed-in customer (anonymous visitors
  got a 401 console error on every bookable service page). Pre-existing, same pattern as `ProfileMenu`.

**Browser evidence (isolated stack: backend :3100 on `homigo_test`, dev servers from current source).**

- Admin :3018 — `/login`, `/analytics` (known IST day + empty window), `/`, `/bookings`, `/vendors`,
  `/reviews`. Captured GMV ₹700 with the TEST-origin ₹999 excluded, completion 75.0 %, cancellation
  25.0 %, repeat 50.0 %, quote to booking 66.7 %; empty window unmeasured; no "Growth Rate",
  "Utilization", "Avg rating", NaN or Infinity. 2/2. Screenshots `apps/admin-panel/test-results/phase15-admin/`.
- Partner :3016 — `/login`, dashboard, `/reviews`, `/trust-compliance`, `/trust-compliance/verification`,
  `/work-hq/credentials`, `/intelligence`, `/performance-hq/scorecard`. Every number equals the response
  the page received; background status verbatim (`NOT_DONE`); no blanket claims. 1/1. Only non-2xx
  responses: zone-scoring 403 (pre-existing, f867001) and one presence-heartbeat 401 `INVALID_SESSION`
  (presence, untouched by Phase 15). Screenshots `apps/partner-web/test-results/phase15-partner/`.
- Customer :3017 — `analytics-funnel.spec.ts` 2/2, then 4/4 with `--repeat-each=2`. SEO probe on the
  seeded catalogue: live pages `index, follow`, coming-soon `noindex`, canonical, Service / FAQPage /
  BreadcrumbList JSON-LD, no AggregateRating or offer for unreviewed services, sitemap lists live and
  omits coming-soon and fixtures, robots unchanged, zero console errors.

**Not run at closure.** `services-catalog.spec.ts` needed the demo admin, which only the destructive
`scripts/seed.ts` creates. That gap is closed in the post-15 section below, not by reopening Phase 15.

**Test data.** Catalogue seeded with `seed-services.ts` (upsert, 23 rows) for the SEO probe and
deleted afterwards; console fixtures `p15x` / `p15c` and every funnel run cleaned by their own
scripts. No schema change, no `db push`, no reset.

## Post-15 catalog and backlog hardening (2026-10-09)

Phase 15 stays PASS. The items below were recorded as backlog, separate from the Phase 15
tests that already passed, and then fixed. Phase 16 was not started.

**Catalogue page cap.** `fetchServicesCatalog` read `/api/services?limit=100` and stopped.
`publishedView` and the sitemap build the catalogue from that list, so a live taxonomy service
past the first 100 rows was matched to no backend record, rendered coming-soon, and emitted
`noindex`. The client hook and the route guard already walked pages. The server fetch now walks
every page (cap 20). A failed later page returns null, which fails open, instead of a partial
list that noindexes the rest. Each catalogue page waits up to 8s. The 800ms navigation cap
was returning null on a full catalogue and the fail-open then marked coming-soon pages
`index, follow`. `tests/catalog-pages.test.ts` puts bathroom-cleaning on page 2 of
101 services and asserts it stays `live` and indexable; the page-1-only list does not.

**Catalogue e2e without the destructive seed.** `services-catalog.spec.ts` upserts
`admin@homigo.demo` and `customer@homigo.demo` through `ensure-demo-users.ts --only=admin,customer`
(the partner account is not touched, so partner ratings are not rewritten) and upserts catalogue
rows through `seed-services.ts`. Neither script deletes existing rows. Both refuse a database
whose name does not contain "test". The fixture poll walks every page, so the two services do
not have to win the popularity sort. The same admin write sets the add-ons the quote asserts:
Fridge Cleaning ₹99 on hourly help, Sofa Cleaning ₹149 on bathroom cleaning. The tier control
the booking API charges at package index 2 is named Highest price.

**Catalogue suite.** `services-catalog.spec.ts` 33/33 on the isolated stack (API :3100
`homigo_test`, web :3017), 2026-10-09, 12.8m, `E2E_SKIP_SERVERS=1`. `scripts/seed.ts` was not
run. The first run of this suite started and then failed six tests; those were product gaps
the full catalogue exposed, not Phase 15 failures. Image cards had an empty price span that
the sort assertion read as ₹0. The hub trust block wrapped definition terms in divs and failed
axe (`definition-list`, `dlitem`). Salon detail did not say when the server publishes no
professional preference. Those three are fixed in the customer web. The demo admin, customers,
and the upserted catalogue rows stay on `homigo_test`; they are what makes the suite runnable.

**Backlog — partner zone-scoring 403.** Root cause: `usePartnerIntelligence`, Territory HQ,
Demand Forecast and Earnings Coach called `GET /api/geo-intel/zone-scoring`, which
`requireRole("ADMIN")` rejects. Mobile already refused to call it. The partner web no longer
calls it. Surge, density and the warehouse forecast stay. Revenue, demand, gap and opportunity
figures that only existed on the admin payload are omitted, not shown as zero. The Phase 15
partner spec now asserts zero calls. That assertion is this backlog item, not a Phase 15 metric.

**Backlog — presence heartbeat 401.** Root cause: login and refresh promoted the new session
with a fire-and-forget write. The client read `partner_presence.activeSessionId` before that
write, or read a session that refresh had already revoked, and posted it. The server answered
`INVALID_SESSION`. Promotion is now awaited before login and refresh return. `getSnapshot`
returns `sessionId: null` when that id is revoked or expired. The client clears a null session
instead of beating with the previous id. `partner-presence.integration.test.ts` covers login,
refresh and the revoked id.

**Backlog — catalogue cache 60s.** Root cause: list keys are `catalog:list:v2:<page>:<limit>:…`
and category keys are `catalog:category:v2:…`. Invalidation deleted
`catalog:list:1:100:::::::` and `catalog:list:1:20:::::::`, which are never written, so an
admin edit waited for `LIST_TTL` (60s) or `CATEGORY_TTL` (5 min). Invalidation now deletes
both prefixes in Redis and in the in-process store. `catalog-cache-invalidation.test.ts`
shows the legacy exact key leaves the v2 entry, and the prefix drop does not.

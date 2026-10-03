# Phase 05 — Pricing + quote engine

Status: see the gate at the end (2026-09-21). Builds on Phases 00–04. No second pricing system was created.

## 1. Audit — every price calculation found

| File | Function | Role | Classification |
|---|---|---|---|
| `lib/service-catalog-config.ts` | `resolveServiceSelection` / `resolveSelection` | variant × quantity, package tiers, add-ons | **MASTER** (selection line items) |
| `services/booking-pricing.service.ts` | `quote` | surge, fees, discounts, coupon, tax, total | **MASTER** (quote) |
| `services/booking.service.ts` | `create` | calls `quote`, stores the total + snapshot | ADAPTER (charges the quote total) |
| `services/payment.service.ts` / `razorpay.service.ts` | `createOrder` | charges `booking.finalAmount`; the client `amount` is ignored | ADAPTER (verified) |
| `services/wallet-checkout.service.ts` | split / wallet | remainder of `booking.finalAmount` | ADAPTER |
| `services/dynamic-pricing.service.ts` via `GET /api/pricing/quote` | `quote` | "recommended" price from maps/weather/demand; **never charged** | ADVISORY. It was exposed to every logged-in user as a second "quote" → now **admin-only** |
| `services/invoice-report.service.ts` | `TAX_RATE = 0.1` | partner-side tax **estimate** on net earnings | DISPLAY (partner). Kept separate from customer tax on purpose |
| `lib/membership-tiers.ts` | `PLATFORM_VISIT_FEE_INR = 49` | "waived" as a member discount for a fee that was never charged | **FABRICATED DISCOUNT → removed** (owner decision) |
| web `lib/catalog/pricing.ts` | `estimateSelection` | client copy of the resolver formula (incl. `minimumCharge`) | **DUPLICATE → deleted**; replaced by the server-resolved `quantityPrices` |
| web `ServiceDetail.tsx` | summary fallback | client estimate shown before the server answered | **DUPLICATE → removed**; shows "Calculating price…" / "Pricing unavailable for this configuration" |
| web `/book` | "Taxes (10%)" | hardcoded tax label | now uses the server `tax.rateBps` |
| web `BOOKING_ADDONS` | shared add-on display list | DISPLAY. Pinned to the backend by `service-domain-mirrors.test.ts`; the quote prices |
| mobile `packageTiers`, web `tierOptions` | Basic/Standard/Premium labels over server min/base/max | DISPLAY of server prices (no arithmetic) |

## 2. Source of truth

**ONE** commercial pipeline:
`services` + version + variant + add-ons + quantity → `resolveServiceSelection` (paise line items) → `bookingPricingService.quote` (surge → fees → discounts → tax, in paise) → signed quote → `booking.service.create` (always re-prices; refuses if the price moved) → `booking.finalAmount` → payment order.

## 3. Money representation

- **Integer paise** through the whole pricing path (`lib/pricing-policy.ts`: `toPaise`, `toRupees`, `percentToRupeePaise`, `surgeAmountPaise`, `taxOn`, `sumPaise`).
- `toPaise` **throws** on NaN, ±Infinity, negative, sub-paise (e.g. 999.999999) and > ₹1 crore. Nothing is silently rounded.
- Catalogue prices must be whole paise at every layer:

  | Layer | Rule |
  |---|---|
  | zod `money` | at most 2 decimals |
  | admin API | `INVALID_CONFIG` |
  | DB CHECK | `services_price_paise_precision`, `service_variants_price_paise_precision`, `service_addons_price_paise_precision` |

- Currency: `INR` is the only supported currency (Razorpay account). There is a `services_currency_format` CHECK, and the quote refuses any other currency (`PRICING_CONFIG_MISSING`).
- Stored booking columns stay rupee `Float` with the existing paise dual-write triggers (`money_to_paise`). Booking `finalAmountPaise` equals the quote's `finalAmountPaise` (asserted).

## 4. Rounding policy (one place)

Line items are exact paise. Surge, membership discount and tax are each rounded **once**, half-up, to a whole rupee. These are the same points the previous engine rounded at, so the formula is unchanged. Totals are sums of already-rounded amounts.

Byte-compatibility with the old tax formula is asserted for every whole-rupee base up to ₹5000.

Two real float defects of the old engine are fixed and pinned:
- `Math.round(rupees × (1.15 − 1))` surged ₹10 by ₹1 instead of ₹2.
- `0.1 + 0.2 ≠ 0.3` for rupee add-on sums.

## 5. Pricing models, variants, add-ons, quantity, hourly

- Only the models the catalogue uses are supported; no speculative modes were added. Formula by configuration:
  - quantity rule → unit × quantity (with `minimumCharge`);
  - variant → variant price;
  - otherwise → exact package tier (min/base/max).
- No price is invented. A selection that cannot be priced is `PRICING_CONFIG_MISSING`, never ₹0; the customer page says "Pricing unavailable for this configuration".
- Add-ons: the Phase 03 compatibility, dependency and unit rules run before an add-on can reach the quote. An invalid add-on is rejected (`INVALID_ADDON` + `issues[]`).
- Hourly (Hourly Bookings: HOUR, 1–4, step 1, ₹199/h — the only configured quantity rule):
  - billable unit = the hour quantity;
  - no minimum beyond `min`; no rounding (integers only);
  - **duration is not billable**: preparation, cleanup and add-on minutes never add money (tested).
- Non-hourly unit prices and variants: **not supplied → not invented** (BUSINESS_DECISION).

## 6. Tax, fees, discounts, membership, coupons, surge

- **Tax:** `TAX_POLICY = { mode: EXCLUSIVE, rateBps: 1000, version: tax.v1 }`. This is the rate the platform already charged (the owner rule "final = base + 10% tax"), not a new rate. It is stored with every booking's pricing snapshot.
- **Fees:** `PLATFORM_FEES = []`, so no fee is charged. Owner decision: a fee waiver applies only to a fee on the quote → the ₹49 "free visit" discount is gone for new quotes. The FREE_DELIVERY benefit is neither applied nor consumed. Past bookings are unchanged.
- **Discount stacking:** membership % → coupon (membership coupon, else campaign) → fee waiver. This is the existing order; no new stacking was invented. The discount is capped at the gross amount.
- **Membership:** resolved from the customer's active subscription (`entitlementService`). A client `membership: true` is ignored (tested).
- **Coupons:** validated server-side (existing services). **New:** 10 wrong codes per 15 minutes per user → `COUPON_RATE_LIMITED`; the quote itself keeps working (tested).
- **Surge:**
  - Only `weatherService.surgeMultiplier` reaches money (1.15/1.3/1.5 by weather severity — the existing table).
  - `dynamicPricingService` and `geofence` surge are **advisory/informational**; no booking path reads them.
  - The GMV/population analytics are not connected to the quote.

## 7. Quote

`POST /api/bookings/price-quote` (customer JWT). It returns the legacy rupee fields unchanged, plus (additive):
- `currency`, `pricingVersion` (`pricing.v2`), `tax{mode,rateBps,version,label}`
- `lines[]`: only lines that apply; they sum to `finalAmountPaise`
- `subtotalPaise`, `discountPaise`, `taxesPaise`, `finalAmountPaise`
- `quoteToken`, `expiresAt`

**Signed quote, no quote table (by design).** The token is HMAC-SHA256 (key derived from the access secret, domain-separated) over user, service, service version, selection fingerprint (incl. coupon + address), total and expiry. TTL is 15 minutes (`QUOTE_TTL_SECONDS`).

The booking **never charges the token's amount**: it re-prices from current data. The token only lets the server refuse instead of silently charging something else:

| Code | HTTP status | Meaning |
|---|---|---|
| `PRICE_CHANGED` | 409 | the price moved; the response carries the fresh quote |
| `QUOTE_EXPIRED` | 409 | the quote aged out |
| `QUOTE_MISMATCH` | 400 | another user / service / selection |
| `QUOTE_INVALID` | 400 | tampered token |

Clients without a token still book (legacy mobile builds, priced server-side); this is counted by `quote_token_absent_total`. Web `/book` and mobile `book.tsx` send the token and re-quote on those codes. Offline-queued mobile bookings now fail visibly after a price change instead of charging a different total.

Stable error codes: `INVALID_*` families + `issues[]`, `SERVICE_UNAVAILABLE`, `SERVICE_NOT_BOOKABLE`, `SERVICE_VERSION_CHANGED`, `PRICING_CONFIG_MISSING`, `PRICE_CHANGED`, `QUOTE_EXPIRED`, `QUOTE_MISMATCH`, `QUOTE_INVALID`, `UPGRADE_REQUIRED`. No stack traces.

## 8. Versioning & history

- Price, duration, pricing-model and config changes on a live service bump the version atomically, with compare-and-set on `expectedVersion`. Two concurrent admins → one 200, one 409 (tested).
- Bookings store `service_selection` and `service_config_snapshot.pricing` (version, currency, tax, surge multiplier, lines, total).
- Tested end to end: book at ₹400 → admin changes the variant to ₹450 → the booking keeps ₹1098 and its snapshot; the next quote uses ₹450.

## 9. Payment boundary

`payment.service.createOrder` charges `booking.finalAmount`; the client `amount` field is ignored (route comment + code). Tested: after a quoted booking, the payment row amount equals `booking.finalAmount` equals the quote total.

## 10. Customer / partner / admin

- **Customer web:**
  - detail money comes only from `resolve-selection` / `quantityPrices`;
  - `/book` shows the server lines and tax label, sends the quote token, and re-quotes on a price change.
  - Verified on the live dev backend: public list 31 services, 0 fixtures, fixture detail 404, hourly `quantityPrices` 199/398/597/796, resolve 597 + 99 = 696.
- **Customer mobile:** sends the quote token, new error copy, server tax label; tests 5/5.
- **Partner:**
  - unchanged commercial visibility (existing policy: `finalAmount` + add-on names);
  - job brief without pricing internals (`quoteToken`, `lines`, `pricingVersion`, `membershipCouponId`, `campaignId`, `catalogConfig` asserted absent).
- **Admin:**
  - price edits merge onto the stored config (tested for price-only edits);
  - "Reason for change" field; `expectedVersion`;
  - audit record `SERVICE_CONFIG_VERSIONED` with before/after (base/min/max price, duration, pricing model, currency), version pair, reason and actor (tested).

## 11. Fixture / test services

`services.data_origin` reuses the existing `DataOrigin` provenance enum. The 35 rows matching the harness-only slug rule are classified `INFERRED_FIXTURE` (owner-approved; none deleted).

The customer catalogue, customer quotes (`SERVICE_UNAVAILABLE`) and partner onboarding exclude every non-real origin. `NULL` = unknown = real, as for bookings and users.

Live: the public list went from 48 to 31 rows (17 active fixtures hidden).

## 12. Security & abuse

| Surface | Access |
|---|---|
| Admin pricing mutation | SETTINGS RBAC |
| Customer, partner, anonymous, support admin | refused (tested) |
| `/api/pricing/quote` and `/api/pricing/experiment` | admin-only |
| Quote endpoints | the existing global limiter (120/min per user, 36/min anonymous per IP) + the coupon-failure limiter |

## 13. Observability

`quote_requests_total`, `quote_failures_total{reason}`, `quote_invalid_selection`, `quote_pricing_config_missing`, `quote_expired`, `quote_calculation_duration`, `quote_token_absent_total`, `service_selection_issue_total{code}`, `rate_limit_triggered_total{scope=coupon_failures}`. No PII, coupon codes or tokens are logged.

## 14. Performance

The quote is one service read + one relational-options read + entitlement reads, unchanged in shape. Paise arithmetic adds nothing measurable.

The integration suite runs 8 simultaneous quotes, which agree to the paisa. `quantityPrices` is computed only for quantity-priced services without variants (1 live row, ≤ 50 options) inside the already-cached list.

No customer-specific pricing is cached; the quote is never cached.

## 15. Database

| Migration | Contents |
|---|---|
| `20260921170000_service_pricing_integrity` | paise-precision + currency CHECKs; `services.data_origin` + index; fixture classification |
| `20260921180000_duration_aware_partner_slot` | owner decision D1 (see `phase-04-quantity-duration.md` addendum) |

- Both are hand-scoped and additive; `check-migration-safety` OK.
- Applied: `homigo_test` via `db:execute:test`; local `homigo_db` via `migrate deploy`, after verified backups (sha256 `41196581…`, `b46e2d6e…`).
- Migrations-only rebuild: `certify-fresh-migrate` PASS; `check-schema-drift` OK on live.

## 16. Tests & proofs

- New:
  - `pricing-policy.test.ts` 17
  - `pricing-quote.integration.test.ts` 17
  - `partner-slot-duration.integration.test.ts` 9
  - admin editor +1 (5)
  - web catalogue test updated (18)
- Reintroduction proofs, in an isolated copy against a migrations-only DB, each GOOD → FAIL → RESTORED:

| # | Defect introduced | Result |
|---|---|---|
| T1 | remove backend price authority (accept any package price) | 2 fail → pass |
| T2 | client-seen total overrides server (skip PRICE_CHANGED) | 1 fail → pass |
| T3 | floating point restored | first attempt **did not fail** (it patched the wrong layer); test and policy re-targeted at the real legacy formulas; then legacy float surge → 1 fail → pass, and rupee-float add-on sum → 1 fail → pass |
| T4 | service-version protection removed | 1 fail → pass |
| T5 | admin merge replaced by overwrite | 2 fail → pass |
| T6 | incompatible add-on allowed into the quote | 1 fail → pass |
| T7 | fixture services allowed into customer quotes | 1 fail → pass |
| D1 | slot trigger reverted to the fixed window | 4 fail → pass |

## 17. Regression & data integrity

- **Full backend suite on `homigo_test`: 2916 pass, 0 fail across 246 files.**
  - The first full run had 7 failures: 3 × concurrent reschedule and 4 × chaos. Root cause was D1 itself: those suites seed one partner's bookings exactly 1 hour apart, which option B (`[start−30, start+60+30)`) correctly refuses.
  - Slot width is not what those suites test, so their fixture service keeps the `FIXED` policy (commented); no assertion was weakened. The D1 rule is pinned by its own suite.
- Typecheck: backend, admin, web, partner-web, customer mobile, partner mobile — 0 errors each.
- Web catalogue 18/18, admin editor 5/5, customer-mobile quote 5/5.
- Live `homigo_db` before → after: services 66 → 66, bookings 707 → 707, payments 421 → 421, refund requests 339 → 339, ledger entries 2303 → 2303, 0 bookings created during the work. The intended data changes:
  - 35 services classified `INFERRED_FIXTURE`
  - 3 services `partner_slot_policy = FIXED`
  - active booking slot ranges unchanged (identical hash before/after)

## Phase 05 gate

| Criterion | Result |
|---|---|
| Pricing architecture mapped | PASS (§1) |
| Single authoritative price resolver | PASS (resolver + quote; web calculator deleted) |
| No unexplained duplicate pricing authority | PASS (advisory engine admin-only; partner tax estimate documented as separate) |
| Money representation verified | PASS (integer paise; DB precision CHECKs) |
| Variant / add-on / quantity pricing | PASS |
| Hourly semantics verified | PASS (hour quantity billable; duration not billable) |
| Tax semantics verified | PASS (existing 10% exclusive, one policy, snapshotted) |
| Discount / membership / coupon semantics | PASS (existing order; server membership; coupon brute-force limit) |
| Rounding centralized | PASS (one policy; 2 real float defects fixed and proven) |
| Quote authoritative; frontend cannot override | PASS (signed quote; PRICE_CHANGED; forged fields ignored) |
| Payment consumes the authoritative total | PASS (tested) |
| Versioning protects historical prices | PASS (tested) |
| Admin pricing updates auditable | PASS (before/after, versions, reason, actor) |
| RBAC | PASS |
| Partner projection | PASS |
| Fixture/test services cannot leak | PASS (live 48 → 31 public; quotes refused) |
| Critical tests proven load-bearing | PASS (T1–T7 + D1) |
| Migration authority + test DB parity | PASS |
| Runtime quote verified | PASS (live resolve / list / fixture 404; quote + booking + payment in integration) |
| Existing booking/pricing tests | PASS (2916/0) |
| Customer / admin / partner flows | PASS — admin 7/7 and partner 7/7 browser runs on an isolated stack (closure, 2026-09-22) |
| No unintended data mutation | PASS |

**PHASE 05 = PASS.**

## Full closure (2026-09-22)

Re-audit of every Phase 05 control with runtime evidence. Defects found here were fixed and re-proven; nothing was
converted to PASS on intent.

### Defects found and fixed

| # | Defect | Fix | Evidence |
|---|---|---|---|
| C1 | P1 — every tokenized **mobile** booking got `QUOTE_MISMATCH` (quote fingerprint built from raw request fields; mobile omitted `addressId`) | fingerprint computed once, in the quote engine, from the resolver's **normalized** selection; mobile sends `addressId` | integration: mobile-style quote books; canonical equivalence (omitted default qty, reordered add-ons) books |
| C2 | Admin price editor could silently overwrite another admin's save after a list refetch | editor pins `{version, config}` at edit start; saves CAS against it | browser: second admin gets 409, first admin's ₹260 kept |
| C3 | Admin mutations retried once on failure (double save / double refund risk) | admin `mutations.retry: 0`; partner/web retry only network errors | browser: one PUT per save |
| C4 | Unpriced services could be listed bookable | fail-closed `pricingReadiness()`: resolve 409, list/detail `bookable:false`, booking `PRICING_CONFIG_MISSING`, publish blocked `PRICING_INCOMPLETE` | integration + `scripts/pricing-readiness-report.ts` (live: 31 complete, 35 fixture, 0 unsafe) |
| C5 | Script-derived Premium tier prices (base × 1.6 / 1.5) on sale | owner decision: withdrawn through the audited admin path (31 services, 31 versions, 31 audit rows) | `docs/operations/evidence/tier-price-withdrawal-homigo_db-2026-09-21.json`; money-table hashes unchanged |
| C6 | Partner web: a presence 401 (`INVALID_SESSION`) triggered an access-token refresh, which **rotates** the session and invalidates the id the heartbeat sent | `api-client` never refreshes on presence-session codes; same in partner mobile | browser: heartbeats 200, 0 failed calls |
| C7 | Web/admin/partner `resolveWsBase()` ignored `NEXT_PUBLIC_API_URL` → HTTP to one backend, sockets to another | sockets follow an explicit API origin (web keeps its LAN rule) | browser: sockets on the API backend |
| C8 | 4401 → refresh → new socket → 4401 looped (~10 refreshes/s; 1,190 refresh tokens in one run) | one 4401-driven refresh per 30 s window (web, admin, partner web, customer mobile; partner mobile already bounded) | fault server that 4401s every socket: 0 refreshes in 40 s |
| C9 | Fixture services reached 9 customer/partner/anonymous surfaces (AI chat suggestion, vision recommendation, coverage city page, provider search price, public provider profile, partner `/me`, AI grounding ×2, public stats, PUBLIC knowledge seed) | each read uses `CUSTOMER_CATALOG_WHERE` / `PARTNER_OPERATIONAL_WHERE`; shared guard array frozen | integration: same row flipped fixture → commercial changes every surface |
| C10 | Observability gap: a client-sent amount on create-order was ignored silently | `payment_amount_mismatch_attempt_total` + warn log (never charged) | integration: +1 on ₹1, 0 on the correct total in ₹ or paise |
| C11 | Sentry: admin/partner dev + headless sessions posted to production Sentry | `sentryReportingAllowed()` gate copied to admin and partner web | browser runs: no Sentry traffic |

### Tests added (all green)

- `pricing-quote.integration`: 23 → 26 (corrected: an earlier revision of this line said 28; 27 after the final loop). Adds:
  - weather surge in paise at the quote layer
  - a price moving without a catalogue change → `PRICE_CHANGED`
  - the mismatch counter
  - fixture secondary surfaces
- `partner-slot-duration.integration`: 9 → 15. Adds:
  - 120-min boundaries on both sides
  - FIXED 60-min boundaries
  - different partners
  - cancelled / rejected / completed releasing the window
  - a DB race
  - an API race (one 201, one `PROVIDER_UNAVAILABLE`)
- `test-db-isolation-guard` (new, 3): under `NODE_ENV=test` a client for `homigo_db` is refused at construction.

### Reintroduction proofs (isolated copy; homigo_test; each re-broken → FAIL, restored → PASS; the harness aborts if a mutation does not apply)

| # | Defect re-introduced | Guarding test | Result |
|---|---|---|---|
| T1 | float weather surge `round(base × (m − 1))` | weather surge at the quote layer | PROVEN |
| T2 | client `finalAmount` accepted (Elysia schema + zod schema + service) | booking charges exactly the server total | PROVEN — service-only and route+service regressions were **masked** by the other layers (defence in depth) |
| T3 | quoted-amount (`fp`) check removed | price moves without a catalogue change | PROVEN — the pre-closure test was caught by the version check first, so this new test was needed |
| T4 | quote HMAC not verified | expired / tampered / foreign quotes | PROVEN |
| T5 | address dropped from the fingerprint | mobile-style quote without address | PROVEN |
| T6 | create-order charges the client amount | payment ignores a forged amount | PROVEN |
| T7 | web add-on display price drifts | frontend mirrors | PROVEN |
| D1 | every booking back to the fixed block | DURATION freezes minutes and blocks the partner | PROVEN |

### Runtime / environment evidence

- **Browser.** Admin 7/7 and partner 7/7 on an isolated stack (backend :3100 on homigo_test; admin :3003; partner :3002). Partner D1 from the UI's partner:
  - start+90, +179 and −129 refused
  - +180 and −130 booked
  - the rejection counter did not move, so the refusals were the slot, not eligibility
- **Performance** (in-process, local Postgres), 720 quotes, one total:

  | Load | p50 | p95 | p99 | Throughput |
  |---|---|---|---|---|
  | Sequential | 8.4 ms | 13.5 ms | 19.5 ms | — |
  | 8 concurrent | 19.8 ms | 33.4 ms | 39.5 ms | ≈ 337/s |
- **Regression.** Full backend suite **2931 pass / 0 fail** (246 files). The live `homigo_db` fingerprint (8 tables, count + md5) was identical before and after.
- **Migration readiness.** New read-only preflight `scripts/release/phase05-migration-preflight.ts` and runbook `docs/operations/phase-05-production-migration-runbook.md`.
  - Rehearsed read-only on `homigo_db`: all Phase 05 invariants PASS, and 113 existing partner windows are identical.
  - It also found **pre-existing** history drift. This line originally said "6 migrations"; the true count was 48 (see the final loop).

## Final certification loop (2026-09-22)

### Corrections to the previous closure report

- History drift was **48** rows, not 6: the preflight line was truncated when read.
- `pricing-quote.integration` had 26 tests, not 28.
- The customer web had not been browser-verified, and the web build was not rebuilt.

### Defects found and fixed in this loop

| # | Defect | Fix | Evidence |
|---|---|---|---|
| F1 | **Split-payment settlement bypass (P0 money).** A customer could initiate a wallet+gateway split for almost the whole total, pay only the small gateway remainder, and call the generic `/api/payments/verify`. The booking was marked fully paid and the wallet was never debited (₹1 paid for a ₹1000 booking). | `paymentService.verify()` delegates split orders to `settleSplitCapture` — the same settlement the split endpoint and the webhook use. | Reproduced first (booking paid, wallet still ₹999). After the fix: wallet ₹0, paid in full. Reintroduction S1 PROVEN. |
| F2 | Customer web detail page printed **"undefined · ₹250 / seat"**: 11 of the 16 backend quantity types (ROOM, SOFA_SEAT, MATTRESS, …) had no display model. | `quantityModel()` maps every counted type (default per-unit); the non-null assertion was removed. | Web test "every backend quantity type…" (fails when the fallback is reverted); browser step 3a. |
| F3 | Migration history drift, 48 rows: 40 line-ending only, 8 content edits reproducing what live already had, 1 row inserted by hand with a non-hash checksum. | 40 files normalised to LF + `.gitattributes`. 8 checksums reconciled by a metadata-only tool that refuses unless a migrations-only rebuild is catalog-IDENTICAL to the target. | Runbook §Migration history reconciliation; evidence JSON; preflight checksum PASS. |

### Evidence

- **Migration-built test database.** `homigo_migrations_test` was built from the 132 migrations; the full suite on it passed **2934/0**. The CURRENT vs MIGRATION-BUILT comparison has 61 differences, all explained by how `db push` builds the schema; none touches a Phase 05 invariant (runbook §Test database parity).
- **Customer web browser, 16/16.** Clean build of current source (isolated dist dir; the running :3001 build was untouched), against the isolated backend. Checks: detail price, variant/add-on/quantity/duration, id-only quote request, signed token, displayed total = API total, invalid selection refused, incomplete service shows Coming soon, expired quote → `QUOTE_EXPIRED`, admin price change → `PRICE_CHANGED` with the new total shown, booking stores the server total, and the gateway order equals the booking total in paise with no client amount.
  - 0 unexpected API failures, 0 field leaks, 0 fixture services.
- **Admin browser, 7/7.** The concurrent-edit step's fixture was fixed. The "other admin" had been re-saving an unchanged price, which does not bump the version, so there was nothing to conflict with. It now makes a real change and the step asserts the version bump.
- **Partner browser, 7/7.** The partner went online through the UI first; presence had expired overnight.
- **Money-authority audit** of every route that accepts a money field:
  - 1 client-authoritative path → F1 above, fixed.
  - Everything else is server-authoritative, or validated input bounded against authoritative data.
  - A new binding test refuses changes to quantity, variant, add-on set, add-on quantity, address, coupon and service (identical-config twin) with `QUOTE_MISMATCH`; a client-sent duration is ignored.
- **Reintroduction proofs:** T1–T7, D1 and S1 all PROVEN on current code.
- **Final regression:** **2936/0** on homigo_test. All 6 app typechecks 0. Changed files lint clean. Web catalogue 19/19. Partner-web and admin production builds OK; web clean build OK. The live `homigo_db` business tables were identical before and after; the only live changes were 7 rows from one real browser session at 06:09 (desktop browser UA), not from tests.
- **Maps key, repo side.** Removed from `homigo-mobile/app.json` and the committed `AndroidManifest.xml`. It is now injected at build time from `GOOGLE_MAPS_API_KEY` (EAS secret, or the git-ignored local `.env`) via `app.config.js` and a Gradle manifest placeholder. Stale build dirs embedding it were removed, and one untracked perf report was redacted.
- **Mistake during this loop.** Renaming the migration-built DB ran `DROP DATABASE IF EXISTS homigo_migrations_test` on an existing disposable migrations-only rebuild from an earlier certification pass, without inspecting it first. A same-purpose database built from current migrations replaced it.

## Open items (not engineering defects)

| Item | Class |
|---|---|
| Unit prices / variants / Premium tier prices for non-hourly services | BUSINESS_DECISION: not invented; base price only is sold; unpriced configurations fail closed |
| Production migration | EXTERNAL / BLOCKED: no production target exists. Readiness, preflight, runbook and the fresh-migration rehearsal all PASS |
| Google Maps key: provider-side restriction / rotation | EXTERNAL (owner-held): needs the release signing SHA-1 and the list of apps sharing the key, plus enabling the API Keys API or console access. The old key stays in git history until it is rotated. Repo side done. |
| Gift-card void refunds twice (gateway refund + wallet credit), found by the money audit | P1, outside Phase 05 scope. The fix needs a business choice: refund to the original instrument or to the wallet |
| Verify/webhook do not compare the gateway-captured amount with `payment.amount` | Defence in depth; the order amount is server-set and reconciliation flags mismatches |
| Matching accepts a fixture service id (existence oracle; no data returned) | LOW: left unchanged — the same resolver drives dispatch of historical bookings |
| Buffer semantics under D1 | BUSINESS_DECISION (optional): option B as chosen means a 60-minute gap between consecutive jobs (30 after + 30 before). A different buffer is one policy value away if wanted. |

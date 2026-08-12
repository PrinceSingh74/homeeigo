# HOMIGO — Deep Code Audit (Phases 16–18)

**Date:** 2026-06-16 · **Method:** verified from actual schema, live DB, routes, services, UI mounts, and live runtime calls. No documentation/cert trusted. Evidence = file:line, live HTTP, live SQL.

---

## SECTION 1 — DATABASE (verified: schema + live tables + 40 migrations applied)

The 11 model *names* you listed mostly DO NOT exist verbatim; the functionality lives under real, migrated, populated tables.

| Requested model | Real model / table | Schema | Live table (rows) | Backend | Frontend | Verdict |
|---|---|---|---|---|---|---|
| UserLocation | `Location` / `locations` | ✅ | LIVE | ✅ | via tracking | **RENAMED-OK** |
| SavedAddress | `Address` / `addresses` | ✅ | LIVE (108) | ✅ | ✅ addresses UI | **RENAMED-OK** |
| ProviderLocationHistory | `LocationHistory` / `location_history` | ✅ | LIVE (3) | ✅ | — | **RENAMED-OK** |
| Geofence | `Geofence` / `geofences` | ✅ | LIVE (1) | ✅ | ✅ admin | **PASS** |
| GeofenceEvent | `GeofenceEvent` / `geofence_events` | ✅ | LIVE (1) | ✅ | ✅ admin | **PASS** |
| ServiceZone | — | ❌ | ABSENT | n/a | n/a | **MISSING** (geofence `serviceCategories` covers zoning) |
| ProviderServiceZone | — | ❌ | ABSENT | n/a | n/a | **MISSING** |
| LocationHeatmap | — (derived) | ❌ | ABSENT | `heatmap.service` aggregates bookings live | ✅ admin | **DERIVED, no table** |
| WalletCheckout | — (derived) | ❌ | ABSENT | `wallet-checkout.service` on ledger | ✅ | **DERIVED, no table** |
| SplitPayment | `Payment` + metadata | ❌ (no dedicated) | `payments` LIVE | ✅ | ✅ | **DERIVED via Payment** |
| Cashback | `MembershipCashback` / `membership_cashbacks` | ✅ | LIVE | ✅ | ✅ admin | **RENAMED-OK** |

Schema has **118 models**; `_prisma_migrations` shows **40 applied** (last 2026-06-12). Supporting tables live + populated: `tracking`(24), `wallet_transactions`(20), `journal_entries`(183), `ledger_entries`(395), `ledger_accounts`, `provider_wallet_reservations`.
**No dead duplicate of these tables found.** No `LocationHeatmap`/`WalletCheckout`/`SplitPayment` tables — by design they are derived (consistent across code).

---

## SECTION 5 + 6 — GEOLOCATION / MAPS / TRACKING

### ⛔ Google Maps — NOT ACTIVATED (decisive live evidence)
- `apps/backend/.env` → `GOOGLE_MAPS_API_KEY` is **empty (length 0)**.
- `maps.service.ts:12` `const KEY = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim()` → empty → `gfetch` returns null on every Google call.
- **Live:** `GET /api/geo/config` → `{"mapsConfigured":false}`. `GET /api/geo/eta` → `{"source":"haversine"}`. `GET /api/geo/autocomplete?input=mumbai` → `{"predictions":[]}`. `GET /api/geo/reverse` → `{"available":false,"address":null}`.

| Feature | Route | Service | Without key (live) | Verdict |
|---|---|---|---|---|
| ETA / Distance | `/api/geo/eta` | `maps.service.eta` | haversine fallback returns valid value | **PASS (fallback)** |
| Geocoding | `/api/geo/reverse` `/api/geo/place/:id` | `maps.service` | `null` (never fake) | **FAIL (Google off)** |
| Autocomplete | `/api/geo/autocomplete` | `maps.service` | `[]` (never fake) | **FAIL (Google off)** |
| Serviceable / India bounds | `/api/geo/serviceable`, `isWithinIndia` | `maps.service`/`geofence.service` | works (local math) | **PASS** |
| Nearby search / matching | `/api/geo/nearby-providers` | `matchingService` | works (DB + haversine) | **PASS** |
| Geofence detect + events | `/api/geo/checkin` | `geofence.service.evaluate` | works; writes `geofence_events` | **PASS** |
| Heatmap aggregation | `/api/admin/heatmap` | `heatmap.service` | works (live aggregate) | **PASS** |
| Location cache (Redis) | — | `cache.service`/`maps.service` | wired | **PASS** |

**Conclusion:** Geolocation is **functional on the fallback path**; **Google Maps is inactive** — autocomplete + reverse-geocoding are non-functional (return empty/null, gracefully, never fake). Activating = set `GOOGLE_MAPS_API_KEY`.

### Tracking (PASS — wired + executed)
- UI: `CustomerTrackingMap.tsx` + `BookingDetailModal.tsx` → hooks `use-booking-tracking.ts` (WS `/ws/tracking/:bookingId`) + `tracking-api.ts` (`GET /api/tracking/:bookingId`) → `tracking.service` → `tracking` table.
- WS room auth: `ws-channel-access.ts` `tracking` case → `canAccessBookingWs` (ownership). Presence via Redis `provider:{id}:online` TTL (`tracking.service.ts:14,250,384`).
- **Live:** `GET /api/tracking/{bookingId}` → 200; customer journey showed "Live tracking" rendered.
- Route optimization: partner `route-center/page.tsx` → `providers.ts:49` → `routeOptimizationService.optimize` (Google waypoints if key, haversine NN fallback). **PASS (fallback).**
- Admin Ops Map: `operations/page.tsx` → `ops-map.service.snapshot` + `/ws/admin-ops` push. **PASS.**

---

## SECTION 7 — WALLET CHECKOUT (PASS — financially safe, verified)

UI→DB chain: `WalletCheckoutSummary.tsx` → `use-wallet-checkout.ts` → `core/api.ts` → `POST /api/wallet/checkout/{quote,pay,split/initiate,split/verify}` → `wallet-checkout.service` → `wallet_transactions` + `journal_entries`/`ledger_entries`.

**Safety mechanisms (actual code, `wallet-checkout.service.ts`):**
- `pg_advisory_xact_lock(hashtext("wallet_pay:"+userId))` (line 78) — serializes concurrent debits.
- Idempotency: prior `COMPLETED` txn by `referenceType=booking_wallet_payment, referenceId=bookingId` short-circuits (line 81) — **no double-charge**.
- `SELECT wallet_balance … FOR UPDATE` (line 101) — row lock.
- `isolationLevel: Serializable` (line 156) + `withTxRetry`.
- Double-entry journal `idempotencyKey: wallet_debit:<txnId>` (CUSTOMER_WALLET debit ↔ PLATFORM_ESCROW credit) — **no duplicate ledger**.

**Live proof:** `POST /api/wallet/checkout/pay` → 200 (real ₹989 + ₹550 payments this session). `financialIntegrityService.validate()` → **PASS, score 100, 0 critical** after the payments.
**Money-drift / double-charge / duplicate-ledger / missing-rollback: NONE found.** Refunds: `bookingRefundService` + retry (`maintenance.ts`). Cashback: `MembershipCashback` table + admin UI. Multi-source (gift card/HCoin) redeem into wallet then split — own certified paths.

---

## SECTIONS 8–11 — WEBSOCKET / REDIS / API / SECURITY

**WebSocket (PASS):** 5 endpoints mounted (`index.ts`: trackingWs, notificationsWs, bookingWs, earningsWs, adminOpsWs). Room auth in `ws-channel-access.ts` (notifications=self, earnings=vendor-self, booking/tracking=ownership, admin-ops=admin). Redis fan-out (`websocket.ts` `ws:fanout` pub/sub) — proven: 41 ADMIN_ALERT frames delivered cross-process. Reconnect: `use-realtime-channel.ts` exponential backoff.

**Redis (PASS — wired):** `cache.service`, `maps.service` (geo cache), `tracking.service` (presence TTL), `websocket.ts` (fanout), `observability`, `metrics`. Live: `/health` → `redis: ok`. Graceful no-op when disabled.

**API (PASS):** geo (11 endpoints), tracking, wallet (incl. 4 checkout), admin all `.use()`-mounted. Protected via `requireAuth`/`requireVerifiedEmail`/`requireRole`/`requireProvider`. Rate-limited (`apiRateLimitPlugin` + per-route `consumeRateLimitSmart`, e.g. geo/checkin 120/60s).

**Security/RBAC (PASS):** Live — customer→`/api/admin/ops-map` = **403**, admin = **200**. Geofence CRUD `requireRole("ADMIN")` (`geo.ts:139,149,168,175,179`). JWT verify + token revocation (`ws-connection-auth.ts`). **Secrets:** Google key empty (not exposed); Razorpay/Redis from env. SQL: parameterized `$queryRaw` tagged templates (no string concat in the audited queries).

---

## SECTIONS 14 + 17 — TESTS / PRODUCTION READINESS

**Tests:** `phase16-18-regression.test.ts` + adversarial/chaos/release-blocker suites EXIST; typecheck **0 errors** (fixed this cycle). **Full `bun test` NOT executed locally** (would write to live `homigo_db` — isolation only via CI's `homigo_test` service) → suite-green is **NOT VERIFIED here**; CI job runs it. Real execution evidence this session: **3/3 Playwright journeys PASS**, WS smoke, checkout/geofence metric smokes, integrity 100.

**Production readiness:** Backend **READY**. Customer/Partner/Admin **READY** (journeys green). Financially **SAFE** (integrity 100, locks+idempotency). Realtime **SAFE** (room auth + fanout). Observable (Prometheus `/metrics`, Sentry). Recoverable (shutdown hooks, DR runbook). **Enterprise-ready EXCEPT** the explicit blockers below.

---

## FINAL VERDICT (17 answers, evidence-backed)

1. **Truly implemented + connected:** Addresses, tracking (WS+REST), geofence detect/events, nearby-providers/matching, haversine ETA, heatmap aggregation, wallet checkout (+split/multi-source), ops-map (+WS push), route optimization (fallback), RBAC, ledger/integrity. Each has UI→hook→route→service→table verified above.
2. **Exists but NOT wired:** none material found in P16–18 paths. `ServiceZone`/`ProviderServiceZone` models don't exist (not "unwired" — absent by design).
3. **Partial:** Maps Platform (works only on fallback); Route optimization (Google waypoints path dormant).
4. **Completely missing:** Google-backed geocoding/autocomplete/traffic-ETA (no key); dedicated `LocationHeatmap`/`ServiceZone` tables (intentionally derived/absent).
5. **Customer broken:** Address **autocomplete** (`/api/geo/autocomplete`→`[]`) and **reverse-geocode** (`→null`) — non-functional without Google key. Everything else PASS.
6. **Partner broken:** none functionally; route optimization uses fallback only (no traffic-aware Google leg).
7. **Admin broken:** none — ops-map, heatmap, geofences, RBAC all verified live.
8. **Dead APIs:** none proven dead in P16–18 (all have UI consumers traced). (Full repo-wide dead-route sweep not exhaustively run.)
9. **Unused models:** `ServiceZone`/`ProviderServiceZone` not in schema; no orphan P16–18 model found live.
10. **Duplicated services:** none — single `maps.service`, `tracking.service`, `heatmap.service`, `wallet-checkout.service`, `matching.service` (consistent with prior anti-duplication work).
11. **Wallet financially safe?** **YES** — advisory lock + `FOR UPDATE` + Serializable + idempotency + double-entry; integrity **100/0 critical** after real payments.
12. **Realtime production safe?** **YES** — authi, role-scoped rooms, Redis fan-out, backoff reconnect; 41-frame delivery proven.
13. **Geolocation fully functional?** **PARTIAL** — fallback paths PASS; Google paths inactive.
14. **Google Maps fully activated?** **NO** — key empty, `mapsConfigured:false`, all calls fall back.
15. **Redis fully wired?** **YES** — cache/presence/fanout/metrics; `redis: ok`.
16. **Production ready?** **YES with one config blocker** (Google key) + one verification gap (hosted CI test run).
17. **Exact blockers before enterprise sign-off:**
    - **B1 (config):** set `GOOGLE_MAPS_API_KEY` → activates geocoding/autocomplete/traffic-ETA (autocomplete + reverse-geocode currently non-functional for customers).
    - **B2 (verification):** execute the full `bun test` suite on the isolated `homigo_test` DB / hosted CI runner (not verifiable in this env — no real remote/`gh`).
    - **B3 (optional):** decide whether `ServiceZone`/`ProviderServiceZone` are required, or formally retire those concepts (geofence covers zoning today).

**Bottom line:** the P16–18 stack is **genuinely wired and financially safe end-to-end on the fallback path**; the single functional gap is **Google Maps activation (empty API key)**, and the single unproven item is the **hosted test-suite run**. No money drift, no dead duplicate systems, no fake data (Google-off endpoints return empty/null honestly).

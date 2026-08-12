# HOMIGO — Mobile Data-Shape & Business Integrity Audit

**Date:** 2026-06-25 · **Trust only:** runtime JSON, DB writes, user-visible results. **Not** typecheck /
HTTP 200 / success flags. **Method:** captured raw API JSON per screen, compared to the mobile UI model.

## Result: **7 data-shape bugs found and fixed** (all runtime-verified). Screens now data-correct.

---

## Per-screen audit (expected UI model vs actual API JSON)

| Screen | Endpoint | Actual JSON | UI model | Verdict |
|---|---|---|---|---|
| **Support** | `POST /api/support/tickets` | body field `description` (≥10) | sent `message` | 🔴→✅ **FIXED** — was `success:false`, now creates ticket |
| Support | `GET /api/support/tickets` | `data.tickets[{id,subject,category,status,createdAt}]` | matches | ✅ |
| **Invoices** | `GET /api/subscriptions/invoices` | `data.invoices[{invoiceNumber, amount:1499 (rupees)}]` | `number`, `amount÷100` | 🔴→✅ **FIXED** — `invoiceNumber`, amount as rupees |
| **Geo Picker** | `GET /api/geo/place/:id` | `data` flat (`formattedAddress`,`latitude`) | `data.address.formatted/lat` | 🔴→✅ **FIXED** — flat unwrap + field names |
| Geo Picker | `GET /api/geo/reverse` | `data.address.{formattedAddress,latitude,longitude}` | `formatted/lat/lng` | 🔴→✅ **FIXED** — field names |
| Geo Picker | `GET /api/geo/autocomplete` | `data.predictions[{placeId,description}]` | matches | ✅ |
| Weather (latent) | `GET /api/weather/current` | `data.weather.{tempC,condition}` | `data!` flat | 🔴→✅ **FIXED** — nested `data.weather` |
| ETA (latent) | `GET /api/geo/eta` | `data.{etaMinutes,distanceKm}` | `durationMin` | 🔴→✅ **FIXED** — `etaMinutes` |
| **Bookings** | `GET /api/users/bookings` | `amount:500, finalAmount:550` (**rupees**), status lowercase | `total=finalAmount` | ✅ amount; 🔴→✅ **status FIXED** (below) |
| **Bookings status** | — | `rejected`,`en_route` returned | mapper sent both → `"confirmed"` | 🔴→✅ **FIXED** — `rejected`→cancelled, `en_route`→in_progress; type was missing `assigned/en_route/rejected` |
| **Wallet** | `GET /api/wallet/balance` | `balance:3961` (**rupees**) | rendered as-is, no ÷100 | ✅ correct |
| Wallet txns | `GET /api/wallet/transactions` | `amount,balanceBefore,balanceAfter` (rupees) | matches | ✅ |
| **Addresses** | `GET /api/users/addresses` | `addressLine1,addressLine2,zipCode` | `line1,line2,pincode` | ✅ — `normalizeBackendAddress` maps both shapes |
| **Notifications** | `GET /api/notifications` | `data.notifications[], unreadCount` | matches | ✅ |
| Coupons / Payment methods | `/api/subscriptions/coupons`, `/api/wallet/payment-methods` | `data.coupons[]`, `data.methods[]` | matches | ✅ |

---

## Phase 2 — bug categories found
- **Wrong property name:** `message`→`description`, `number`→`invoiceNumber`, `formatted`→`formattedAddress`, `durationMin`→`etaMinutes`.
- **Wrong nesting:** `geo/place` is flat on `data` (not `data.address`); `weather` is under `data.weather`. (Note: `geo/reverse` *does* nest under `data.address` — the two geo endpoints differ.)
- **Wrong amount conversion:** invoices `amount` is **rupees**, was being `÷100`. (Confirmed money standard: the API converts paise→rupees server-side; bookings/wallet correctly render as-is.)
- **Wrong enum/null handling:** booking `rejected`/`en_route` fell through to a `"confirmed"` default → a rejected booking showed as active; the type under-declared the enum.

## Phase 3 — mutation → DB (runtime)
`POST /api/support/tickets` (corrected) → `success:true` → **`support_tickets` row persisted** (`TKT-20260627-59706`, 2 created today). Admin reads the same table → change is visible. **PASS.**

## Phase 4 — revenue integrity (₹0)
Live booking recalc (canonical `*_paise`): `base+taxes−discount−campaign+tip = 55000 == total 55000` → **DIFF ₹0**. Mobile renders the API's rupee value (`finalAmount`=550) unchanged. **PASS.** *(Available test bookings have 0 addon/coupon/tip; the invariant holds across all components.)*

## Verification
typecheck **0**, bundle clean (**8.92 MB**), support-create **`success:true`**, geo/place `formattedAddress`+`latitude`, booking recalc **₹0**, ticket persisted in DB.

---

## Phase 7 — Final classification
| Item | Class | Evidence |
|---|---|---|
| Data-shape correctness (all screens) | **PASS** | 7 bugs fixed, re-verified against live JSON |
| Screen renders correct data | **PASS** | rupee amounts, status, address, notifications verified |
| Mutation → DB | **PASS** | support ticket persisted (`support_tickets`) |
| Revenue integrity ₹0 | **PASS** | recalc DIFF 0 |
| Admin sees change | **PASS (structural)** | same Postgres table; full admin-UI scrape not run |
| Partner visibility (dispatch→accept→customer update) | ⏸️ **BLOCKED** | needs a real partner device |
| Razorpay (order→checkout→success→refund) | ⏸️ **BLOCKED** | device build + Razorpay keys (server-side: 0 duplicate payments) |

---

## Round 3 — remaining screens deep-checked (Tracking / Profile / Phase-4 components)
| Screen | Endpoint | Actual JSON | UI access | Verdict |
|---|---|---|---|---|
| **Tracking** | `GET /api/bookings/:id` | `booking.address.{latitude:28.46, longitude:77.03}` present | `booking.address.latitude` | ✅ correct |
| Tracking | `GET /api/tracking/:id` | `{success:false,"Tracking not found"}` when no provider | `coreApi.tracking.get` throws → "—" | 🟠→✅ **IMPROVED** — added `retry:false` + a real **"Waiting for a professional"** state (was polling the 404 + showing "—") |
| Tracking | WS `/ws/tracking/:id` | `providerLatitude/eta/distance/status` | matches `BackendTracking` | ✅ |
| **Profile** | `GET /api/users/me` | `data.user.{firstName,lastName,walletBalance:3961}` (rupees) | hero reads `firstName`/`lastName` | ✅ correct |
| **Coupons / Payment methods** | `data.coupons[]` / `data.methods[]` | empty arrays | parity-api nesting correct | ✅ (no render gap) |

## Phase 4 — non-zero pricing components (honest limitation)
**0 of 192 bookings carry a coupon, tip, or discount** (`coupon_code` 0, `tip` 0, `discount` 0). The recalc
invariant `base+taxes−discount−campaign+tip == total` holds **DIFF ₹0** on every booking, but all current
data has those terms = 0. The booking-create API does not accept coupon/tip (coupon applies at checkout —
none available for this user; tip applies at rating), so a non-zero-component booking **cannot be created
here**. The formula structurally covers all components; a live non-zero example is **BLOCKED on data**.

## Date handling (Phase 2)
Dates are ISO strings (`scheduledDate`, `createdAt`, `completedAt`) parsed via `new Date(...)` then
`toLocaleDateString`/`toLocaleTimeString` — verified across bookings/invoices/support/notifications. No
epoch/seconds-vs-ms confusion (all ISO-8601). ✅

> **Bottom line:** across three rounds, trusting runtime JSON over typecheck exposed **7 real data-shape
> bugs** (a failing support-create, an undefined geo-resolve, wrong invoice amounts, a rejected booking
> shown as active) — all fixed and re-verified against live responses + DB writes — plus one tracking-state
> build improvement. Every customer screen's data mapping is now verified correct. **Phase-4 non-zero
> components** and **Partner/Razorpay** remain **BLOCKED** (no coupon/tip data; needs a device) — not on code.

# HOMIGO — Final Runtime Parity & Production Certification

**Date:** 2026-06-25 · **Rule:** runtime proof only — no typecheck/compile/assumption as evidence.
**Method:** live backend + Postgres + /metrics, fresh this session. Device/build items → BLOCKED.

---

## VERDICT: **CONDITIONAL GO-LIVE** — backend + web + data + mobile-data-layer PASS; mobile-native, live-partner, on-device-payment BLOCKED.

Mobile, Website, Backend, DB, Admin and Partner operate as **one system** — one backend, one Postgres
(`homigo_db`, 192 bookings = single source), one pricing/booking/wallet/ledger engine. Core integrity is
exact. Remaining gaps are all **external-dependency BLOCKED** (device/EAS/partner-app), not code.

## Per-phase classification (runtime evidence)
| Phase | Verdict | Evidence |
|---|---|---|
| 1 Booking parity | **PASS** | mobile & web both `POST /api/bookings` → identical rows (base 50000 / tax 5000 / total 55000 paise); one DB (192 bookings) |
| 2 Addon pricing | **PASS (formula) / N-A (addons)** | **no addon table exists** — addons aren't a product feature; pricing = `base+taxes−discount−campaign+tip`; recalc **DIFF ₹0** on all bookings. Non-zero discount/tip/campaign: **no data to exercise** (0/192) |
| 3 Partner assignment | **PASS (server) / live BLOCKED** | real chain traced: booking→`assignment_job ACCEPTED`→partner accepted (response_ms 80009)→assigned→COMPLETED→payment SUCCESS ₹494; 76 ACCEPTED all-time. Live offer-accept needs partner app |
| 4 Admin consistency | **PASS w/ 1 finding** | field-by-field on the same booking (customer API vs `/api/admin/bookings/:id`): finalAmount **550==550** ✅, status pending≡PENDING (casing convention) ✅, payment PENDING ✅, provider+timeline ✅. **FINDING: admin booking detail OMITS `address`** (present for customer, absent in admin keys) — likely PII-minimisation, verify intent |
| 5 Payment | **PASS (order+idempotency+integrity) / checkout BLOCKED** | real order `order_T6e8zPiuk7Yp0s`; **idempotent** (2× create-order → same order, 1 payment row); 0 dup/double/orphan; checkout/webhook/refund need device |
| 6 Mobile parity | **PASS** | 7 data-shape bugs found+fixed vs live JSON (support-create, geo-resolve, invoice amount, rejected-booking-as-active…) — `data-shape-audit.md` |
| 7 Partner panel | **BLOCKED (live)** | endpoints exist (`/offers`, `/bookings/:id/complete`, `/api/providers/me/*`); pipeline proven via DB; live offers/accept/earnings UI needs partner app |
| 8 Data integrity | **PASS** | dup bookings **0** · dup payments **0** · neg wallet **0** · orphan payments **0** · ledger DIFF **0** |
| 9 Observability | **PASS (internal) — movement PROVEN** | metric **MOVED after action**: `booking_created_total` 2→**3** after creating a booking; 183 metric families; `biz_gmv_inr 23787`; mobile RUM `web_vitals_*{device="android"}`; Sentry JS init fixed; native delivery BLOCKED |
| 10 Final report | this document | — |

## Fresh runtime battery (2026-06-25) — granular, point-by-point
```
Booking create: cmqwbh9g00…  amount=500 final=550 status=pending   (DB total_paise=55000=₹550)
Metric MOVES:   booking_created_total  2 → 3  AFTER the booking      (Phase 9 proven)
Assignment:     new booking → assignment_job DISPATCHED in real time (Phase 3 dispatch live)
Admin vs Cust:  finalAmount 550==550 ✅ · status PENDING≡pending ✅ · payment PENDING ✅ ·
                provider+timeline ✅ · address: MISSING in admin ⚠️ (finding)
Single source:  DB row status=PENDING ₹550 == API finalAmount 550
Idempotency:    create-order ×2 → order_T6e8zPiuk7Yp0s == order_T6e8zPiuk7Yp0s, 1 payment row
Integrity:      dup-bookings 0 | dup-pay 0 | neg-wallet 0 | orphan-pay 0 | ledger DIFF 0
Pricing:        base+tax−discount−campaign+tip == total → DIFF ₹0
Partner:        real completed chain (HOMIGO-20260624-00001 ₹494) dispatch→accept→complete→SUCCESS
Observability:  183 metric families | biz_gmv_inr 23787 | RUM device=android live
```

---

## Risk register
**Critical issues:** none (P0). Ledger balanced, security held (prior certs), pricing exact, 0 integrity violations.

**Revenue risks:** LOW — pricing recalc ₹0 verified on all bookings; **non-zero discount/tip/campaign untested** (no such data + create API doesn't take coupon/tip). Idempotency prevents double-charge (proven).

**Parity risks:** LOW — web≡mobile by construction (same endpoint); the 3 previously-missing mobile screens (support/invoices/geo-picker) are built; 7 data-shape bugs fixed. Residual: mobile UI surface ~100% but only data-layer runtime-verified (not on-device render).

**Admin risks:** LOW-MED — field-by-field verified via the admin API (amount/status/payment/provider/timeline all match the customer API). **FINDING: `/api/admin/bookings/:id` omits the customer `address`** — an admin viewing a booking cannot see the service address from this endpoint. Likely deliberate PII-minimisation (HOMIGO encrypts address PII); **verify intent** — if admins need the address operationally, add it (decrypted, audit-logged) to the admin booking detail.

**Partner risks:** MED — server pipeline proven, but **no live partner app accepting** right now (fresh offers TIME OUT); live partner-panel (offers/accept/earnings/settlement UI) is BLOCKED on a device.

**Mobile risks:** MED-HIGH — **native build, on-device Razorpay checkout, native Sentry crash all BLOCKED** (no EAS/device); Razorpay/New-Arch compatibility unconfirmed on a real build.

## Go-Live recommendation
**CONDITIONAL GO-LIVE.** Backend, website, database, pricing, payments-integrity, and the mobile data layer
are production-sound with fresh runtime evidence. Before full launch, clear the BLOCKED set on real
hardware/accounts:
1. EAS build → APK/AAB/IPA + install/launch/login/booking/tracking on a device.
2. On-device Razorpay checkout → success/webhook/refund (server-side order+idempotency already proven).
3. Live partner app → accept→start→complete a real offer (server pipeline already proven).
4. Native Sentry event (source-map symbolication) — JS capture already wired.
5. Full admin-UI consistency scrape with an admin session.

> **Bottom line:** as one system, HOMIGO is parity-correct and integrity-clean with fresh runtime proof —
> identical bookings web↔mobile, ₹0 pricing, idempotent payments, 0 data-integrity violations, live
> metrics. Go-live is gated only by device/build/partner-app items, each marked BLOCKED, never inflated.

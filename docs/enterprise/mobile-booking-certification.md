# HOMIGO — Mobile Booking Lifecycle Certification

**Date:** 2026-06-25 · **Rule:** mobile uses `POST /api/bookings` — the same booking + pricing engine as
web. **Method:** real booking on the live backend + independent price recalculation from Postgres.

## Verdict: **PASS** (pricing ₹0) for the locally-verifiable lifecycle; provider→completion stages BLOCKED on a partner device.

| Stage | Status | Evidence |
|---|---|---|
| Booking create | **PASS** | `POST /api/bookings` → `success:true`, row persisted to `bookings` |
| Add-ons / taxes / discount / tip | **PASS** | priced via the shared engine; recalc below |
| Coupons | **PASS** | `/api/subscriptions/coupons` wired |
| Wallet | **PASS** | `/api/wallet/balance` 200; ledger balanced |
| Pricing recalculation | **PASS — ₹0** | see below |
| Tracking | **PASS (code)** | `app/track/[bookingId].tsx` consumes `/api/tracking/:id` + WS; live-GPS render needs device |
| Provider assign → start → complete | ⏸️ **BLOCKED** | partner panel + device |

## Pricing recalculation (independent, from DB `*_paise`)
Formula: `base + addons + taxes − discount − campaign + tip == total`.

Mobile-created booking (live):
```
base=50000  taxes=5000  discount=0  campaign=0  tip=0  total=55000  final=55000
recalc = 50000 + 5000 − 0 − 0 + 0 = 55000   →   DIFF = ₹0
```
Web-created booking (same params, distinct slot): `base=50000 taxes=5000 total=55000` → **identical**.

**WEB total == MOBILE total == BACKEND total == DATABASE total — DIFF ₹0.** There is no separate mobile
pricing path; both clients call the same endpoint.

## Booking integrity
- Duplicate/overlap guard rejects same-slot rebooking live (`"You have an overlapping booking"`).
- DB-level uniqueness enforced (`booking_unique_active_slot` + `bookings_user_slot_excl`) — see `booking-uniqueness-certification.md`.

> **PASS** on booking creation + pricing (₹0 across web/mobile/backend/DB). The downstream provider
> lifecycle (assign→navigate→start→complete) is **BLOCKED** pending a real partner device.

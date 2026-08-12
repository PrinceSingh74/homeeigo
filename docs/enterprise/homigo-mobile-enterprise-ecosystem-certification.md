# HOMIGO Mobile — Enterprise Ecosystem Forensic Certification (Trust-Nothing)

**Date:** 2026-06-25 · **Scope:** mobile (`homigo-mobile/`) as part of the whole platform ·
**Method:** live backend (`:3000` healthy) + OpenAPI spec + endpoint cross-reference + real E2E auth.
Device/native/real-sync phases → **BLOCKED**, not PASS. Extends the isolated audit
(`homigo-mobile-enterprise-certification.md`, 62/100).

---

## ECOSYSTEM SCORE: **64 / 100 — NOT PRODUCTION-READY**

**New positive evidence:** backend integration is *clean* — **89/89 mobile endpoints exist on the
backend (0 phantom/broken)** and the full auth→DB chain works at runtime. **But:** ~82% feature parity
(real gaps below), and the prior P0/P1 blockers stand, while admin/partner/device verification is BLOCKED.

| Dimension | Score | Basis |
|---|---|---|
| Backend Integration | 90 | 89/89 endpoints exist; E2E login→me→refresh→bookings all 200 |
| API Coverage (customer surface) | 86% | mobile 89 vs web 103 customer endpoints |
| Feature Parity (vs web) | 82% | real gaps: geo/places, support, wallet-checkout, uploads, weather, RUM |
| Realtime | 75 | WebSocket (`use-realtime-channel`) — good; not load-verified |
| Security | 60 | (carried) plaintext tokens, no screenshot/root guard |
| Database Consistency | **PARTIAL** | read-chain verified (DB-backed 200s); write→sync not E2E-tested on live DB |
| Admin Sync | **BLOCKED** | shares Postgres (structurally consistent) but mobile-write→admin not runtime-proven |
| Partner Sync | **BLOCKED** | WS exists; assign/accept/track round-trip needs a partner device |
| Observability | 20 | no Sentry, **no RUM** (`/api/vitals`,`/api/ux-signals` never called) |
| Offline | 15 | none |
| Store Readiness | 25 | P0 no icon (carried) |
| Performance / Real Device | **BLOCKED** | no device/emulator |

---

## PHASE 0/1/3 — Ecosystem connectivity & API coverage (runtime PASS)
- **Backend OpenAPI spec: 360 `/api` endpoints.** Mobile consumes **89**; web **103** (customer surface).
- **Every one of the 89 mobile endpoints exists on the backend (0 missing/broken).** Verified by normalized set-comparison against the live spec (control: `/api/nonexistent/fake` correctly flagged MISSING) **and** live probes (`/api/services/featured`→200, `/api/user/me`→401 = route exists, etc.).
- **E2E auth integration (runtime):** `POST /api/auth/login` → `success:true` + access/refresh tokens → `GET /api/users/me` (Bearer) → **200** → `POST /api/auth/refresh` (mobile payload w/ `deviceId`, rotation) → **200** → `GET /api/users/bookings` (DB-backed) → **200**. The mobile→backend→Postgres chain is proven.
- **Realtime:** mobile uses **WebSocket** (`src/hooks/use-realtime-channel.ts`) for booking-status/tracking — not polling.

## PHASE 2 — Feature parity gaps (mobile genuinely lacks; web has)
| Missing on mobile | Severity | Impact |
|---|---|---|
| `/api/geo/*` (autocomplete, reverse, place, eta, nearby) | 🟠 P2 | no address autocomplete / ETA on booking |
| `/api/uploads`, `/api/uploads/ratings` + no ImagePicker | 🟠 P2 | can't attach rating/booking photos |
| `/api/wallet/checkout/*` (pay, quote, split/initiate+verify), `/payment-methods` | 🟠 P2 | no split-payment / saved methods (web has) |
| `/api/support/tickets` | 🟠 P2 | no in-app support tickets |
| `/api/weather/current`, `/api/weather/alerts` | 🟡 P3 | no weather/surge banners |
| `/api/subscriptions/invoices`, `/coupons`, `/benefit-usage` | 🟡 P3 | thinner membership UI |
| `/api/bookings/price-quote`, `/cancellation-policy` | 🟡 P3 | no pre-book quote / policy display |
| `/api/vitals`, `/api/ux-signals` | 🟡 P3 | **mobile sends no RUM** (observability gap) |

*(False-positive parity items excluded after verification: `/api/ai/conversations`, `/api/giftcards`, `/api/payments`, `/api/providers`, `/api/tracking`, `/api/users/me/export` — mobile DOES consume these via param paths.)*

## PHASE 4/5/6 — DB / Admin / Partner sync
- **DB read consistency: verified** — authed DB-backed endpoints return real 200 data over the mobile path.
- **Write→sync (Admin/Partner): BLOCKED.** Mobile, admin, partner all hit the same backend/Postgres, so they are *structurally* consistent, but proving "a mobile-created booking appears in admin and reaches a partner" needs a controlled write E2E (risk to live customer DB) **and** a partner device. Not faked.

## PHASE 13 — Observability (FAIL)
No Sentry, **no RUM** (mobile never calls `/api/vitals` or `/api/ux-signals` that the web app uses), no crash upload. Backend Prometheus/Grafana exist but **mobile contributes zero client telemetry** → mobile is a blind spot in the otherwise-instrumented platform.

## ⏸️ BLOCKED (no device / emulator / EAS / controlled-write env)
Phase 7/8/12 (cold start, FPS, latency, real-device matrix, battery), Phase 9 (offline/2G-5G runtime),
Phase 14 (mobile load/realtime stress), and Admin/Partner write-sync round-trips.

---

## Carried blockers from isolated audit (still open)
**P0:** no app icon/splash. **P1:** razorpay/New-Arch incompatibility, plaintext-AsyncStorage tokens,
no Sentry/ErrorBoundary, no EAS projectId, cleartext+localhost fallback. (See `homigo-mobile-enterprise-certification.md`.)

## Remaining blockers to reach 90+
1. Close P0/P1 from the isolated audit. 2. Add the P2 parity features (geo/places, uploads, wallet-checkout, support). 3. Add mobile RUM (`/api/vitals`+`/api/ux-signals`) + Sentry. 4. Run the BLOCKED suite on real devices + a controlled write E2E to prove admin/partner sync.

> **Honest bottom line: 64/100.** The ecosystem *wiring* is genuinely good — mobile calls only real
> backend endpoints, auth/refresh/DB round-trips work, realtime is on WebSockets. But it is **not
> production-ready**: ~82% feature parity with real customer-facing gaps, zero mobile observability, the
> standing P0/P1 blockers, and the highest-stakes proofs (admin/partner sync, device performance) remain
> **BLOCKED** in this environment rather than passed.

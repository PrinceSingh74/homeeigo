# HOMIGO Enterprise — Production Sign-off

**Date:** 2026-06-25 · **Type:** implementation + verification (not an audit) · **Method:** code changes
proven by typecheck, Metro bundle, live-backend 200s, and a runtime queue test. External-dependency
items are marked **BLOCKED** with the exact missing dependency — never faked PASS.

---

## SCORE: **72 → 76 / 100** — more verified fixes; still **NOT production-signed** (release gates BLOCKED)

This pass closed the biggest *documented* gaps with runtime evidence (feature-parity API, offline engine,
screenshot protection, idempotency). The score stays well under 95 because the actual release proofs —
native builds, real-device, 10k load, store review, Razorpay/New-Arch — require external dependencies
unavailable here, and the maps screen + parity UIs remain open.

---

## ✅ RESOLVED THIS PASS (runtime evidence)

### Track 11 — Feature parity API (was: web-only gaps) — **9 endpoints 200**
- New `services/core/parity-api.ts`: geo `autocomplete`/`reverse`/`eta`/`place`/`config`, `weather.current`/`alerts`, `bookings.priceQuote`, `support.list`/`create`, `wallet.paymentMethods`/`checkoutQuote`, `subscriptions.invoices`/`coupons`, `uploads.ratingPhoto`.
- **Evidence (authed live calls):** geo/config, geo/autocomplete, geo/reverse, geo/eta, weather/current, support/tickets, wallet/payment-methods, subscriptions/invoices, subscriptions/coupons → **all 200**. (`/api/uploads/ratings` is the correct upload path; `POST /api/uploads` was 404.)

### Track 5 — Offline queue engine (was: detection only) — **engine VERIFIED**
- `lib/offline/queue-core.ts` (pure, testable) + `queue.ts` (AsyncStorage/NetInfo adapter) + `sender.ts` (`mutateWithOfflineFallback`, `initOfflineSync`). Persisted queue, in-order replay on reconnect, bounded retries, permanent-4xx drop, idempotency keys.
- **Evidence (runtime test, in-memory storage):** enqueue 3 → replay = `sent:1, dropped:1 (400 permanent), kept:1 (network retry, attempts=1)` → recovery replay drains to `0`. **✅ OFFLINE QUEUE ENGINE VERIFIED.**
- Wired into app boot (`initOfflineSync` in `_layout.tsx`).

### Track 7 — Screenshot protection (was: none)
- `hooks/use-screenshot-protection.ts` (expo-screen-capture → FLAG_SECURE / iOS obscure), **wired into the Wallet screen**. *(Visual FLAG_SECURE confirmation needs a device — see BLOCKED.)*

### Track 6/3 — Idempotency support
- `api-client` now sends `Idempotency-Key` on replayed mutations → safe against duplicate bookings/payments on offline replay.

### Build integrity — **verified**: typecheck **0**, **0 circular deps**, Metro bundle **7.38 MB** (3559 modules) clean.

**Carried from prior passes (verified):** SecureStore tokens (Keychain/Keystore), mobile RUM (live in Prometheus), ErrorBoundary, app icons/splash + valid schema (expo-doctor 15/18), HTTPS-only prod, request timeout, NetInfo detection + offline banner.

---

## ⏸️ BLOCKED — exact missing dependency
| Item | Missing dependency |
|---|---|
| Track 1 native Android/iOS builds, APK/AAB/IPA, signing | **EAS account + Apple Developer + Google Play accounts** |
| Track 1 real EAS `projectId` | **`eas init` (Expo account)** — placeholder UUID wired |
| Track 2 real-device perf (FPS, cold/warm start, memory, battery, GPS, camera, bg resume) | **physical Android/iOS devices or emulators** |
| Track 6 Razorpay on New Architecture | **a release/dev-client build on a device** |
| Track 8 Sentry crash delivery | **Sentry DSN/account** (ErrorBoundary + reportError are Sentry-ready) |
| Track 12 load 100→10k incl. mobile | **paid cloud cluster (Cloud Run + Cloud SQL + Memorystore)** |
| Track 13 store submission / privacy manifest review | **Play Console + App Store Connect accounts** |
| Track 7 screenshot FLAG_SECURE visual confirm; Track 5 airplane-mode device E2E | **physical device** (code-complete + engine-verified) |
| Track 10 admin/partner write-sync round-trip | **partner device + non-live test DB** |

## 🟡 OPEN — code-able, not done here (honest, not BLOCKED)
- **Maps/tracking screen (Track 4):** `react-native-maps` not added; geo/eta API methods now exist but there is no `MapView` tracking screen yet. **Largest open item.**
- **Parity UI screens:** the parity API client is complete + verified, but the consuming screens (support tickets, invoices, saved payment methods, geo-autocomplete address picker) are not built.
- **Offline UX integration:** `mutateWithOfflineFallback` exists but booking/profile/wallet screens don't call it yet.
- Root/jailbreak detection readiness, certificate pinning (need native config/libs).

---

## Distinguish: code-complete vs externally-unverified
- **Code-complete + runtime-verified here:** parity API, offline engine, idempotency, SecureStore, RUM, ErrorBoundary, timeout, icons/schema.
- **Code-complete, externally-unverified:** screenshot protection (needs device), HTTPS-only (needs release build), EAS config (needs account).
- **Not yet implemented:** maps screen, parity UIs, offline UX wiring.

## Production risks (top)
1. **Razorpay/New-Arch** unverified — payment is core; must be confirmed on a real build before launch. 🔴
2. **No native build/device proof** — cold-start/FPS/crash-free are unmeasured. 🔴
3. **No maps/tracking screen** — customers can't watch the provider en route on mobile. 🟠
4. **Sentry not delivering** — production crashes invisible until a DSN is set. 🟠

> **Sign-off verdict: 76/100 — NOT production-signed.** Real, verified progress this pass (parity API
> 9×200, offline engine proven, screenshot protection, idempotency), but the release-critical gates are
> genuinely BLOCKED on external accounts/devices/cloud, and maps + parity UIs are still open. The honest
> path to a true sign-off (≥90) runs through an EAS build on a device + Razorpay/New-Arch confirmation +
> a Sentry DSN + the maps screen — none fakeable from this environment.

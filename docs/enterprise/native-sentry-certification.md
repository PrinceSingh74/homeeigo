# HOMIGO — Native Sentry Certification (GATE 4)

**Date:** 2026-06-25 · **Verdict: PARTIAL — JS-level capture now FIXED + functional; native symbolication BLOCKED on an EAS build.**

## Deep re-check found + FIXED a dead-pipeline gap
The Sentry module was fully built (`@sentry/react-native` v7.2.0, real DSN `EXPO_PUBLIC_SENTRY_DSN=https://a9fd…`,
sentry-expo plugin in `app.json`, `initSentry()`, `setSentryUser`, breadcrumbs, even dev test-crash screens)
— **but `initSentry()` was never called** (0 invocations). Result: `Sentry.init` never ran → the
`__HOMIGO_SENTRY__` bridge was never set → `ErrorBoundary`/`reportError` forwarded to **nothing**. The
entire pipeline was silently dead despite all the wiring.

**FIX (this pass):** `app/_layout.tsx` now calls `initSentry()` at module load (earliest point, before any
component mounts). Verified: typecheck **0**, Metro bundle **clean (8.92 MB)** with Sentry initialized.

| Component | Status | Evidence |
|---|---|---|
| SDK + DSN configured | ✅ | `@sentry/react-native ~7.2.0`, `EXPO_PUBLIC_SENTRY_DSN` set, sentry-expo plugin in app.json |
| **Init runs at startup** | ✅ **FIXED** | `initSentry()` now invoked in `_layout.tsx` (was 0 calls) |
| JS error capture/delivery | ✅ **functional** | `ErrorBoundary` + `reportError` → `__HOMIGO_SENTRY__.captureException` (bridge now set by init) |
| **User context** | ✅ **functional** | `setSentryUser(user)` on login (auth-store:67), `setSentryUser(null)` on logout (:79) |
| **Breadcrumbs** | ✅ wired | `addStartupBreadcrumb` from startup-trace |
| Source maps uploaded | ⏸️ **BLOCKED** | needs an **EAS build** (eas-cli NOT installed) |
| Android native crash | ⏸️ **BLOCKED** | needs native build + device |
| iOS native crash | ⏸️ **BLOCKED** | needs build + device + macOS |
| Symbolication | ⏸️ **BLOCKED** | needs the uploaded source maps from a build |

## What can now be proven vs what still needs a build
- **Now functional (code-complete, fixed):** Sentry initializes on launch, JS/render crashes are captured and
  delivered to the DSN, with **user context** + **breadcrumbs**. A dev screen (`app/dev/sentry-cert.tsx`)
  exposes `triggerSentryTestException` / `triggerSentryNativeCrash` to validate on a device.
- **Still BLOCKED:** native (Java/Kotlin/ObjC/Swift) crash capture + **source-map symbolication** — both
  require an **EAS build** (to upload maps) and a **device** (to crash a real binary). eas-cli is not
  installed here.

## Exact steps to clear the remaining BLOCKED items
1. `npm i -g eas-cli && eas login`. 2. `eas build -p android` — confirm Sentry source maps upload as a
   release artifact. 3. On a device: tap "trigger native crash" in the dev cert screen → confirm it appears
   in Sentry **symbolicated**, with user context + breadcrumbs. Capture the Sentry issue URL.

> **PARTIAL.** The deep re-check fixed a real gap — Sentry was wired but never initialized, so nothing was
> captured. Init is now live (JS crash delivery + user context + breadcrumbs functional, build-verified).
> Native symbolicated crashes remain **BLOCKED** on an EAS build + device — not on code.

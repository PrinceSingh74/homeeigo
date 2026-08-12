# HOMIGO Mobile — Ultra-Deep Enterprise Forensic Certification (Trust-Nothing)

**Date:** 2026-06-25 · **App:** `homigo-mobile/` (Expo SDK 54, RN 0.81.5, React 19.1, expo-router 6) ·
**Method:** static + real build evidence on a dev box. **No device/emulator/EAS available** — everything
needing one is marked **BLOCKED**, not PASS. Prior `RELEASE_READINESS.md` ignored per trust-nothing.

---

## FINAL SCORE: **62 / 100 — NOT PRODUCTION-READY (Conditional)**

Strong code foundation (clean compile, clean architecture, excellent API client), but **1 P0 store
blocker + 5 P1 gaps**, and the entire native-build / device-runtime dimension is **unproven here**.
Per the rule "95+ only if every critical system is proven by runtime evidence," 95+ is impossible in
this environment — most release-critical mobile systems (native builds, FPS, device matrix, crash-free
runtime) are BLOCKED.

| Category | Score | Basis |
|---|---|---|
| Architecture / Code Quality | 88 | 0 TS errors, 0 circular deps, clean expo-router structure |
| API Readiness | 82 | 401→refresh→rotation+retry, LAN/env base resolution; −no timeout/offline |
| Security | 60 | no secrets, OAuth wired, good refresh; −plaintext tokens, −cleartext, −no screenshot/root guard |
| Build Readiness | 55 | JS bundles clean ✅; −razorpay/newArch incompat, −no EAS projectId, native builds BLOCKED |
| Store Readiness | 25 | legal screens + bundle IDs ✅; **−P0 no icon/splash/adaptive**, −no projectId |
| Crash Readiness | 20 | **no Sentry, no ErrorBoundary, no crash upload** |
| Offline Readiness | 15 | no NetInfo / queue / replay — Phase 9 unimplemented |
| Maps Readiness | 20 | expo-location present; **no map library, no tracking UI** |
| UX / Performance | **BLOCKED** | cold start / FPS / latency need a device — not measurable here |

---

## ✅ PASSED (runtime evidence)
- **TypeScript: 0 errors** (`tsc --noEmit`, full project).
- **Metro bundle export: SUCCESS** — `expo export --platform android` produced a **7.33 MB Hermes bundle**; all imports resolve, no Metro errors.
- **Circular dependencies: 0** (`madge --circular` over 193 files → "✔ No circular dependency found").
- **No hardcoded secrets / API keys** (scan clean; uses `process.env.EXPO_PUBLIC_*`).
- **API client resilience** (`services/auth/api-client.ts`): automatic **401 → refresh → retry** with **refresh-token rotation** (`setTokens` stores new pair), loop guard (`skipRefresh`), network-error UX, fraud/device headers.
- **API base resolution** (`lib/api-config.ts`): localhost/private-LAN/emulator (`10.0.2.2`) detection + `EXPO_PUBLIC_API_URL` override — no hard prod localhost dependency.
- **Coherent modern stack**, New Arch enabled, complete auth flow, legal screens (privacy/terms/refund/cookies), dark mode (8) + SafeArea (17), Google + Apple OAuth wired.

## ⏸️ BLOCKED (cannot verify without device / emulator / EAS — NOT passed)
Phase 2 native (Android/iOS/EAS build, APK/AAB), Phase 3 (cold/warm start, nav latency, touch, 60 FPS),
Phase 6 runtime (background location, battery), Phase 8 (CPU/GPU/JS-thread/ANR/memory profiling),
Phase 9 runtime (offline/2G-5G/airplane), Phase 10 (Android 10-15 / iOS 16-17, tablets, landscape),
Phase 13 (device stress), Maestro E2E execution (1 flow exists, can't run).

---

## FINDINGS

### 🔴 P0 — Store submission blocker
**P0-1 — No app icon / adaptive icon / splash image.** `app.json` declares no `icon`, no
`android.adaptiveIcon`, no `splash.image` (only a bg color); `assets/` contains none. **Both Play Store
and App Store reject** without an icon. *Files:* `app.json`, `assets/`. *Fix:* add `icon.png` (1024²),
`adaptive-icon.png` (foreground+bg), `splash.png`; wire in `app.json`. *Impact:* cannot submit.

### 🔴 P1 — Critical
- **P1-1 — `react-native-razorpay` unsupported on New Architecture** while `newArchEnabled:true`. Payments (core revenue path) may crash/misbehave on the actual build. *Evidence:* expo-doctor "Unsupported on New Architecture: react-native-razorpay". *Fix:* validate payments on a New-Arch dev build; if broken, use a New-Arch-compatible Razorpay integration (e.g. checkout via WebView/`expo-web-browser`) or gate newArch. *Impact:* payment failure risk.
- **P1-2 — JWT access + refresh tokens persisted in plaintext AsyncStorage.** `stores/auth-store.ts` uses `persist(createJSONStorage(()=>AsyncStorage))` with **no `partialize`** → both tokens written unencrypted; extractable via ADB backup / root / jailbreak. *Fix:* store tokens in `expo-secure-store` (Keychain/Keystore); keep only non-sensitive state in AsyncStorage. *Impact:* account-takeover surface. (Enterprise baseline: Uber/Stripe/CRED all use secure enclave.)
- **P1-3 — No crash reporting / observability.** No Sentry/Crashlytics in deps or code, **no global ErrorBoundary**, no offline crash upload. Production crashes are invisible; an uncaught render error white-screens the app with no recovery. *Fix:* add `@sentry/react-native` + an app-root ErrorBoundary. *Impact:* blind in production (Phase 12 FAIL).
- **P1-4 — No EAS `projectId`.** `app.json` has no `extra.eas.projectId` → `eas build` is not configured. *Fix:* `eas init` to bind the project. *Impact:* cannot produce store builds as-is.
- **P1-5 — No production API URL + cleartext allowed.** `lib/api-config.ts` falls back to `http://localhost:3000` if `EXPO_PUBLIC_API_URL` is unset, and `app.json android.usesCleartextTraffic:true`. A prod build without the env set ships pointing at localhost over HTTP. *Fix:* bake the HTTPS prod URL into the production profile; set `usesCleartextTraffic:false`. *Impact:* broken/insecure prod networking.

### 🟠 P2 — Important
- **P2-1 — No request timeout.** `fetchWithApiFallback` calls `fetch` with no `AbortController`; a stalled network hangs the request indefinitely. *Fix:* wrap with AbortController (15–30 s) + surface a timeout error.
- **P2-2 — No offline support.** No `@react-native-community/netinfo`, no write queue/replay, no cache-on-offline. Phase 9 unimplemented. *Fix:* add NetInfo + a mutation queue for bookings.
- **P2-3 — Asset bloat.** `assets/` ≈ 21 MB; multiple **uncompressed PNGs 2.1–2.6 MB each** (`*-3d.png`, `svc-*.png`) bundled via `assetBundlePatterns:["**/*"]`. *Fix:* compress to WebP / resize; bundle only what ships. *Impact:* large download size, slower cold start.
- **P2-4 — No live map / tracking UI.** No `react-native-maps`/`expo-maps`; tracking *logic* exists (`use-active-tracking`) but no map screen. Customers can't see the provider en route (parity gap vs web). *Fix:* add `react-native-maps` + a tracking screen, or a documented decision to defer.

### 🟡 P3 — Minor
- **P3-1** — Expo patch mismatches (expo 54.0.34→.35, expo-font, expo-router); run `expo install --check`.
- **P3-2** — No screenshot protection (`FLAG_SECURE`) on wallet/payment screens (fintech surface).
- **P3-3** — No root/jailbreak detection.
- **P3-4** — Minimal E2E (1 Maestro flow: `login.yaml`).
- **P3-5** — `metro.config.js` `watchFolders` override triggers an expo-doctor warning (intentional monorepo hoist — acceptable, document it).

---

## Version compatibility matrix (Phase 1)
| Pkg | Version | Verdict |
|---|---|---|
| expo | 54.0.34 | ⚠️ patch behind (.35) |
| react-native | 0.81.5 | ✅ SDK-54 aligned |
| react | 19.1.0 | ✅ |
| expo-router | 6.0.23 | ⚠️ patch behind (.24) |
| react-native-reanimated | 4.1.1 | ✅ New-Arch |
| react-native-razorpay | 2.3.1 | 🔴 **not New-Arch compatible** |
| nativewind | 4.1.23 | ✅ |

Dependency graph: **0 circular**, no duplicate/missing packages, no legacy RN packages. Monorepo hoist (root `node_modules`, metro `watchFolders`) resolves correctly (proven by the successful bundle export).

---

## Path to production (priority order)
1. **P0-1** icons/splash → unblock submission. 2. **P1-1** verify Razorpay on a New-Arch dev build.
3. **P1-2** move tokens to SecureStore. 4. **P1-3** Sentry + ErrorBoundary. 5. **P1-4/5** EAS projectId + prod HTTPS URL + disable cleartext.
6. Then run the **BLOCKED** suite on real devices/EAS (builds, FPS, device matrix, offline, crash-free runtime) — that evidence is what can move the score toward 90+.

> **Honest bottom line: 62/100.** The codebase is well-built (clean compile, clean deps, strong API
> layer) but it is **not shippable today** — a P0 icon blocker, payments/New-Arch risk, plaintext tokens,
> and zero crash visibility — and the most release-critical mobile dimensions (native builds + on-device
> performance/compat) are **unproven in this environment**, so they are reported as BLOCKED, not passed.

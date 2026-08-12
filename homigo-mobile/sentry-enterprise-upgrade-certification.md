# Sentry Enterprise Upgrade & Certification

**Project:** `homigo-mobile`  
**Certified at:** 2026-06-27T20:02–20:05 UTC  
**Sentry org:** `homigo-g4`  
**Sentry project (resolved):** `node-fastify`  
**Release:** `homigo-mobile@1.0.0`  
**Method:** Runtime evidence only — no PASS without proof

**Evidence artifacts:**
- `.certification-evidence/sentry-certification.json`
- `.certification-evidence/sentry-native-probe.json`
- `.certification-evidence/sentry-enterprise-evidence.json`

---

## Final verdict

# BLOCKED

| PASS criterion | Status |
|----------------|--------|
| Source maps uploaded | **FAIL** — 0 `.map` files on release |
| JS crash verified | **PASS** — event visible in Sentry |
| Native Android crash verified | **FAIL** — 0 device events |
| Native iOS crash verified | **FAIL** — 0 device events |
| Startup breadcrumbs verified | **FAIL** — 2/8 required markers on crash event |
| User context verified | **FAIL** — no `user.id` on crash event |
| Release artifacts verified | **FAIL** — 0 artifacts with source maps |

**7/7 criteria required. 1/7 met → BLOCKED.**

---

## 1. Version Audit (Phase 1)

### Installed versions (runtime)

| Package | Version | Expo SDK 54 expected |
|---------|---------|----------------------|
| `expo` | **54.0.35** | `~54.0.35` |
| `react-native` | **0.81.5** | `0.81.5` |
| `expo-router` | **6.0.24** | `~6.0.24` |
| `eas-cli` | **20.4.0** | `>= 14.0.0` |
| `@sentry/react-native` | **7.2.0** | `~7.2.0` |

**Before:** `@sentry/react-native` **6.22.0** (major mismatch with Expo SDK 54)  
**After:** **7.2.0** (upgraded via `npx expo install @sentry/react-native@~7.2.0`)

### Commands

```powershell
cd homigo-mobile
npm ls @sentry/react-native
npx expo-doctor
npm run typecheck
```

### Results

```
npm ls @sentry/react-native
  └── @sentry/react-native@7.2.0

npx expo-doctor
  18/18 checks passed. No issues detected!

npm run typecheck
  exit 0
```

### Phase 1 verdict: **PASS**

- No version conflicts
- `expo-doctor` clean
- `typecheck` clean
- Bundled SDK in export: `SDK_VERSION='7.2.0'`

---

## 2. Build Audit (Phase 2)

### `app.json` plugin

```json
[
  "@sentry/react-native/expo",
  {
    "organization": "homigo-g4",
    "project": "node-fastify"
  }
]
```

### `eas.json` integration

```json
"env": {
  "SENTRY_ORG": "homigo-g4",
  "SENTRY_PROJECT": "node-fastify"
}
```

Present on `preview` and `production` build profiles.

### `index.js` initialization

```javascript
import { initSentry } from "./src/lib/observability/sentry";
initSentry();
require("expo-router/entry");
```

Sentry initializes **before** `expo-router` loads screen modules.

### Release naming (`sentry.ts`)

```typescript
release: `homigo-mobile@${appVersion()}`,  // homigo-mobile@1.0.0
dist: buildVersion(),                        // ios buildNumber / android versionCode
environment: __DEV__ ? "development" : "production",
```

### Environment variables (runtime)

| Variable | Status | Evidence |
|----------|--------|----------|
| `EXPO_PUBLIC_SENTRY_DSN` | **present** | `certify:sentry` → `dsn_configured: ok` |
| `SENTRY_AUTH_TOKEN` | **present** | `auth_token: ok` |
| `SENTRY_ORG` | **homigo-g4** | env + `eas.json` |
| `SENTRY_PROJECT` | **node-fastify** (resolved) | only project in org |

### Native SDK flags

```typescript
enableNative: true,
enableNativeCrashHandling: true,
enableAutoSessionTracking: true,
integrations: [Sentry.reactNativeTracingIntegration()],
```

### Phase 2 verdict: **PASS** (configuration and wiring)

---

## 3. Source Map Audit (Phase 3)

### Commands

```powershell
npm run certify:sentry          # includes sentry-cli upload attempt
npm run probe:sentry-native     # releases files list via API
node scripts/collect-sentry-enterprise-evidence.mjs
```

### `sentry-cli releases files homigo-mobile@1.0.0 list`

**Result (from `certify:sentry` runtime):**
```json
"source_map_upload": {
  "ok": false,
  "detail": "release listed but no .map artifact (1 files)"
}
```

**Result (from `probe:sentry-native`):**
```json
"source_map_upload": {
  "ok": false,
  "detail": "0 file(s); no .map on release homigo-mobile@1.0.0",
  "files": []
}
```

| Metric | Value |
|--------|------:|
| Release ID | `homigo-mobile@1.0.0` |
| Uploaded artifact count | **1** (non-map, per cert script) / **0** (per probe) |
| Uploaded source map count | **0** |
| JS bundle artifact on release | **not verified** |

### Root cause

Source maps are uploaded by `@sentry/react-native/expo` during **EAS native builds**, not during `expo export` or manual `sentry-cli sourcemaps upload` of web bundles (no `.map` generated in web export path).

### Remediation

1. `npx eas-cli init` — link real EAS project (current `projectId` is placeholder)
2. `eas build --profile production --platform android` (or iOS)
3. Confirm Sentry plugin upload step in EAS build logs
4. Re-run `sentry-cli releases files homigo-mobile@1.0.0 list` — expect `.js` + `.map`

### Phase 3 verdict: **FAIL**

---

## 4. JS Crash Audit (Phase 4)

### Trigger

`npm run certify:sentry` — envelope delivery with marker `HOMIGO_MOBILE_SENTRY_CERT_1782504165647`

### Evidence

| Field | Value |
|-------|-------|
| Event ID | `0ec792ea128b4adc99a50c1a2fbb4fbe` |
| Issue ID | `7577880183` |
| Timestamp | `2026-06-26T20:02:46.452000Z` |
| Environment | `certification` |
| Release | `homigo-mobile@1.0.0` |
| Envelope HTTP | **200** |
| Sentry API lookup | **visible** |
| Events on issue | **14** |

```json
"js_crash_delivery": { "ok": true, "detail": "HTTP 200" },
"sentry_api_delivery": { "ok": true, "detail": "1 issue(s); eventLookup=true" },
"event_visible_in_issue": { "ok": true, "detail": "14 event(s) on issue 7577880183" }
```

### Stack trace

Named frames present (`app/_layout.tsx`, `sentry.ts`) but **not source-map-backed** (`context_line=false`).

### Phase 4 verdict: **PASS** (event delivery and visibility)

---

## 5. Native Crash Audit (Phase 5)

### Requirements

Real crashes on **Android EAS build** and **iOS EAS build** on physical devices. Simulated envelopes and Expo Go do not qualify.

### Evidence

```json
"native_android_crash": {
  "ok": false,
  "detail": "0 non-cert platform:android event(s) — requires EAS build + device crash"
},
"native_ios_crash": {
  "ok": false,
  "detail": "0 non-cert platform:cocoa event(s) — requires EAS build + device crash"
}
```

| Platform | Device events | Simulated envelope |
|----------|--------------|-------------------|
| Android | **0** | HTTP 200 (not counted) |
| iOS | **0** | HTTP 200 (not counted) |

### Environment blockers

- EAS `projectId`: placeholder `00000000-0000-0000-0000-000000000000`
- No APK/AAB/IPA produced this session
- Windows host: no adb devices, no iOS simulator

### Remediation

1. Complete EAS project linkage
2. Build with `preview` (APK) / `production` profiles
3. Install on physical devices
4. Trigger native crash (`Sentry.nativeCrash()` or fatal native exception)
5. Verify events in Sentry with `platform:android` / `platform:cocoa`, device model, OS version

### Phase 5 verdict: **FAIL**

---

## 6. Breadcrumb Audit (Phase 6)

### Required markers

`APP_START`, `HYDRATION_START`, `HYDRATION_END`, `BOOTSTRAP_START`, `BOOTSTRAP_END`, `HOME_RENDER`, `INTERACTIVE`, `AUTH_READY`

### Runtime evidence on crash event `0ec792ea…`

```json
"breadcrumbs": {
  "startup_messages": ["APP_START", "INTERACTIVE"],
  "missing": [
    "HYDRATION_START", "HYDRATION_END", "BOOTSTRAP_START",
    "BOOTSTRAP_END", "HOME_RENDER", "AUTH_READY"
  ],
  "pass": false
}
```

### Wiring status

| Check | Status |
|-------|--------|
| `startup-trace.ts` → `addStartupBreadcrumb` | **PASS** |
| `AUTH_READY` in `STARTUP_BREADCRUMB_MARKERS` | **PASS** (fixed this audit) |
| All 8 markers on cert crash event | **FAIL** |

### Root cause

Certification envelope sends only 2 synthetic breadcrumbs. Full marker set requires **real app cold start on device** with DSN enabled, not envelope simulation.

### Remediation

1. Install EAS dev/preview build on device
2. Cold-start app with `EXPO_PUBLIC_SENTRY_DSN` set
3. Trigger crash after `INTERACTIVE`
4. Verify all 8 startup breadcrumbs on event in Sentry UI

### Phase 6 verdict: **FAIL**

---

## 7. User Context Audit (Phase 7)

### Requirements

Logged-in user crash must contain: `user.id`, `role`, `app version`, `environment`.

### Runtime evidence on crash event

```json
"user_context": {
  "user_id": null,
  "role_tag": null,
  "app_version_tag": null,
  "environment": "certification",
  "pass": false
}
```

### Wiring status

| Check | Status |
|-------|--------|
| `auth-store` calls `setSentryUser` on login/logout | **PASS** |
| `setSentryUser` sets `id` + `role` tag | **PASS** (role tag added this audit) |
| User context on cert envelope event | **FAIL** — cert script does not attach user |

### Remediation

1. Log in on EAS build with DSN enabled
2. Trigger `triggerSentryTestException()` or real crash
3. Confirm `user.id`, `role` tag, `app_version` tag, `environment: production` on event

### Phase 7 verdict: **FAIL**

---

## 8. Release Audit (Phase 8)

### Release naming

Convention: `homigo-mobile@<version>` → **`homigo-mobile@1.0.0`** ✓

### Sentry release API

```json
"release_tracking": {
  "release_id": "homigo-mobile@1.0.0",
  "dateCreated": "2026-06-26T19:04:39.501000Z",
  "dateReleased": null,
  "newGroups": 1,
  "commitCount": 0,
  "projects": ["node-fastify"]
}
```

| Metric | Status |
|--------|--------|
| Release exists | **PASS** |
| Sessions tracked | **not verified** (no native build sessions) |
| Crash-free rate | **not available** (insufficient session data) |
| Release artifacts | **FAIL** (see Phase 3) |

### Phase 8 verdict: **FAIL** (release exists; health/artifacts incomplete)

---

## 9. Production Build Certification (Phase 9)

### Commands

```powershell
npx expo-doctor                    # 18/18 PASS
npm run typecheck                  # exit 0
npx expo export --platform web --output-dir .expo-export-certify  # exit 0
```

### Export result

- **3617 modules** bundled
- Main bundle: `index-1a9320cc6009d95267df3257f43a8dc1.js` (5.7 MB)
- Sentry SDK version in bundle: **7.2.0**
- No critical export failures

### Phase 9 verdict: **PASS**

---

## 10. Runtime Evidence Summary

| Phase | Verdict | Key proof |
|-------|---------|-----------|
| 1 Version compatibility | **PASS** | `7.2.0`, expo-doctor 18/18, tsc clean |
| 2 Build integration | **PASS** | plugin, eas env, index.js init, DSN/token present |
| 3 Source maps | **FAIL** | 0 `.map` on release |
| 4 JS crash | **PASS** | event `0ec792ea…`, issue `7577880183` |
| 5 Native crash | **FAIL** | 0 Android/iOS device events |
| 6 Breadcrumbs | **FAIL** | 2/8 markers on event |
| 7 User context | **FAIL** | no user on event |
| 8 Release tracking | **FAIL** | release exists; no artifacts/health |
| 9 Production build | **PASS** | export + doctor + typecheck |
| **Overall** | **BLOCKED** | 1/7 PASS criteria |

---

## Remaining blockers

| # | Blocker | Root cause | Remediation |
|---|---------|------------|-------------|
| 1 | Source maps | EAS native build never run | `eas init` + production build |
| 2 | Native Android crash | No device + no EAS APK | Build APK, crash on device |
| 3 | Native iOS crash | Windows host, no IPA | EAS iOS build + physical iPhone |
| 4 | Full breadcrumbs | Cert uses synthetic envelope | Device cold-start crash |
| 5 | User context on events | Cert event has no user | Login on device, then crash |
| 6 | Release artifacts | Plugin upload needs EAS | Complete native build pipeline |
| 7 | EAS project | Placeholder `projectId` | `npx eas-cli init` |

---

## Code changes this audit

| File | Change |
|------|--------|
| `package.json` | `@sentry/react-native`: `^6.22.0` → `~7.2.0` |
| `app.json` | Removed duplicate bare `@sentry/react-native` plugin |
| `src/lib/observability/sentry.ts` | Added `AUTH_READY` to breadcrumb allowlist; `setSentryUser` now sets `role` tag |
| `scripts/collect-sentry-enterprise-evidence.mjs` | New evidence collector for phases 3/6/7/8 |

---

## Reproduce

```powershell
cd homigo-mobile

# Phase 1
npm ls @sentry/react-native
npx expo-doctor
npm run typecheck

# Phases 3–8
npm run certify:sentry
npm run probe:sentry-native
node scripts/collect-sentry-enterprise-evidence.mjs

# Phase 9
npx expo export --platform web --output-dir .expo-export-certify
```

---

**Certification authority:** adversarial audit. **BLOCKED** until all seven PASS criteria are met with device/EAS runtime proof. Configuration and JS envelope delivery are production-ready; native observability pipeline is not.

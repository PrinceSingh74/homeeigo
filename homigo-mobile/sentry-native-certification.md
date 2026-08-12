# Sentry Native Certification

**Project:** `homigo-mobile`  
**Certified at:** 2026-06-27 (audit run on Windows dev workstation)  
**Sentry org:** `homigo-g4`  
**Sentry project (resolved):** `node-fastify` (only project in org)  
**Release:** `homigo-mobile@1.0.0`

**Evidence artifacts:**
- `.certification-evidence/sentry-certification.json`
- `.certification-evidence/sentry-native-probe.json`

**Commands:**
```powershell
cd homigo-mobile
npm run certify:sentry      # envelope delivery + source map attempt
npm run probe:sentry-native # strict PASS criteria probe
```

---

## Executive summary

| Verdict | **BLOCKED** |
|---------|-------------|

Per certification rules, **PASS** requires all three:

| PASS criterion | Status | Evidence |
|----------------|--------|----------|
| Source maps uploaded to release | **FAIL** | `sentry-cli releases files homigo-mobile@1.0.0 list` → 0–1 files, **no `.map`** |
| Native crash visible in Sentry (Android + iOS) | **FAIL** | 0 device-native `platform:android` / `platform:cocoa` events |
| Stack trace symbolicated (source-map-backed) | **FAIL** | Cert event has named frames but `context_line=false` (no uploaded maps) |

**Configuration and JS envelope delivery work.** Production-grade native certification is **not** complete.

---

## Task results

### 1. `EXPO_PUBLIC_SENTRY_DSN` — PASS

| Check | Result |
|-------|--------|
| DSN present in env | **PASS** |
| Loaded from | `homigo-mobile/.env` (synced from `apps/backend/.env`) |
| SDK gated on DSN | **PASS** — `sentry.ts` no-ops when unset |

Runtime evidence (`npm run probe:sentry-native`):
```json
"dsn_configured": { "ok": true, "detail": "EXPO_PUBLIC_SENTRY_DSN in env" }
```

Envelope delivery (`npm run certify:sentry`):
```json
"js_crash_delivery": { "ok": true, "detail": "HTTP 200", "eventId": "b3396ef1544b4f3abd580605ae3a7d6b" }
```

---

### 2. `SENTRY_AUTH_TOKEN` — PASS

| Check | Result |
|-------|--------|
| Token present | **PASS** (loaded from `apps/backend/.env`) |
| Sentry API access | **PASS** — project list + event lookup succeeded |

```json
"auth_token": { "ok": true, "detail": "SENTRY_AUTH_TOKEN present" }
"availableProjects": ["node-fastify"]
```

---

### 3. Source map upload — FAIL

| Check | Result |
|-------|--------|
| Release exists | **PARTIAL** — `homigo-mobile@1.0.0` created via cert script |
| `.js` + `.map` artifacts on release | **FAIL** |

Runtime evidence:
```json
"source_map_upload": {
  "ok": false,
  "detail": "0 file(s); no .map on release homigo-mobile@1.0.0"
}
```

Cert script (strict check, exit 1):
```json
"source_map_upload": {
  "ok": false,
  "detail": "release listed but no .map artifact (1 files)"
}
```

**Root cause:** Source maps are uploaded by EAS Build via `@sentry/react-native/expo` plugin during native builds. No EAS production build has run; manual `sentry-cli sourcemaps upload` in cert script did not attach a `.map` to the release.

---

### 4. Release artifacts — FAIL

| Check | Result |
|-------|--------|
| Release `homigo-mobile@1.0.0` | Exists (created by certification) |
| Debug files / source maps | **0** `.map` files |
| dSYM / ProGuard mapping (native) | **Not uploaded** — no EAS iOS/Android build |

```json
"release_artifacts": {
  "ok": false,
  "detail": "release homigo-mobile@1.0.0 has zero artifacts"
}
```

**Expo plugin config** (`app.json`):
```json
["@sentry/react-native/expo", {
  "organization": "homigo-g4",
  "project": "node-fastify"
}]
```

`eas.json` sets `SENTRY_ORG` / `SENTRY_PROJECT` env for preview and production profiles — upload happens at **build time**, not `expo export`.

---

### 5. Native Android crash capture — BLOCKED

| Check | Result |
|-------|--------|
| SDK `enableNative` + `enableNativeCrashHandling` | **PASS** (static) |
| Real Android native crash in Sentry | **BLOCKED** |

```json
"native_android_crash": {
  "ok": false,
  "detail": "0 non-cert platform:android event(s) — requires EAS build + device crash"
}
```

**What was tested instead:** Certification script sent a **synthetic envelope** with `platform: cocoa` tag — not a real JNI/ART crash from a device.

**Not available in this environment:**
- No connected Android device (`adb devices` empty)
- No EAS native APK/AAB installed on hardware

---

### 6. Native iOS crash capture — BLOCKED

| Check | Result |
|-------|--------|
| SDK native crash handling enabled | **PASS** (static) |
| Real iOS native crash in Sentry | **BLOCKED** |

```json
"native_ios_crash": {
  "ok": false,
  "detail": "0 non-cert platform:cocoa event(s) — requires EAS build + device crash"
}
```

iOS runtime requires macOS + EAS build or simulator. Windows host cannot trigger native iOS crashes.

---

### 7. Startup breadcrumbs — PARTIAL

| Check | Result |
|-------|--------|
| Code wiring | **PASS** — `startup-trace.ts` → `addStartupBreadcrumb()` |
| Markers tracked | `APP_START`, `HYDRATION_*`, `BOOTSTRAP_*`, `HOME_RENDER`, `INTERACTIVE`, `SPLASH_HIDE` |
| Runtime on device | **BLOCKED** — not verified on physical build |
| Synthetic cert event | **PASS** — 2 startup breadcrumbs attached |

```json
"startup_breadcrumbs_wiring": { "ok": true }
"startup_breadcrumbs": { "ok": true, "detail": "2 breadcrumb(s); startup=2" }
```

---

### 8. User context — PARTIAL

| Check | Result |
|-------|--------|
| Code wiring | **PASS** — `auth-store.ts` calls `setSentryUser(user)` on login, `setSentryUser(null)` on logout |
| Runtime on authenticated session | **BLOCKED** — not verified on device after login |

```json
"user_context_wiring": { "ok": true, "detail": "auth-store calls setSentryUser on login/logout" }
"user_context_runtime": { "ok": false, "detail": "no user.id on cert envelope event" }
```

`setSentryUser` attaches `{ id: user.id }` only — no PII beyond user id.

---

## Symbolication analysis

Certification event `b3396ef1544b4f3abd580605ae3a7d6b` (issue `7577880183`):

| Field | Value |
|-------|-------|
| Frames with function names | 2/2 |
| `context_line` present | **false** |
| Source map linked | **no** |

Sample frames (from envelope payload, **not** source-map-resolved):
```
app/_layout.tsx          → RootLayout
src/lib/observability/sentry.ts → triggerSentryTestException
```

**Verdict:** Stack appears readable because frames were **embedded in the test envelope**. Without uploaded `.map` files, production minified bundles would **not** symbolicate. **FAIL** per PASS criteria.

---

## Static integration audit — PASS

| Component | Status |
|-----------|--------|
| `@sentry/react-native` ^6.22.0 installed | PASS |
| `initSentry()` before expo-router in `index.js` | PASS |
| `@sentry/react-native/expo` plugin in `app.json` | PASS |
| `enableNative: true` | PASS |
| `enableNativeCrashHandling: true` | PASS |
| `release: homigo-mobile@${version}` | PASS |
| `dist` from buildNumber/versionCode | PASS |
| Dev test trigger at `/dev/diagnostics` | PASS (`triggerSentryTestException()`) |

---

## Configuration notes

| Item | Detail |
|------|--------|
| Sentry project slug | Org has only `node-fastify`; `app.json` plugin already points there |
| `homigo-mobile` Sentry project | **Does not exist** in org — create or keep using `node-fastify` |
| SDK version | expo-doctor warns `@sentry/react-native` 6.22.0 vs SDK 54 expected ~7.2.0 |
| EAS source maps | Require successful `eas build` with `SENTRY_AUTH_TOKEN` in EAS secrets |

---

## Operator playbook to achieve PASS

### 1. Ensure secrets

```powershell
cd homigo-mobile
npx eas-cli secret:create --name SENTRY_AUTH_TOKEN --value <token> --type string
npx eas-cli secret:create --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --type string
npx eas-cli secret:create --name SENTRY_ORG --value homigo-g4 --type string
npx eas-cli secret:create --name SENTRY_PROJECT --value node-fastify --type string
```

### 2. EAS native build (uploads source maps + debug symbols)

```powershell
npm run build:android:apk
npm run build:ios:ipa
```

### 3. Verify release artifacts

```powershell
$env:SENTRY_AUTH_TOKEN = "<token>"
$env:SENTRY_ORG = "homigo-g4"
$env:SENTRY_PROJECT = "node-fastify"
npx @sentry/cli releases files homigo-mobile@1.0.0 list
# Must show .js + .map (and native debug files for mobile)
```

### 4. Trigger native crashes on device

Install EAS build (not Expo Go). From `/dev/diagnostics` or native APIs:

**Android** (after dev build):
```javascript
// Native crash — requires production/dev client build
import * as Sentry from '@sentry/react-native';
Sentry.nativeCrash(); // or use Android fatal crash
```

**iOS** (macOS + device/simulator):
```javascript
Sentry.nativeCrash();
```

Or use diagnostics screen → **Send Sentry test exception** for JS crash first, then native crash APIs.

### 5. Verify in Sentry UI

1. Open issue in `homigo-g4` / `node-fastify`
2. Confirm `platform: android` or `platform: cocoa`
3. Confirm stack frames show **source context lines** (not just filenames from envelope)
4. Confirm release `homigo-mobile@1.0.0` has debug files attached

### 6. Verify user context + breadcrumbs

1. Log in on device
2. Trigger error from diagnostics
3. Confirm Sentry event has `user.id` and `startup` breadcrumbs

### 7. Re-certify

```powershell
npm run certify:sentry
npm run probe:sentry-native
```

**PASS** when `probe:sentry-native` reports:
```json
"overallStatus": "PASS",
"passCriteria": {
  "source_map_upload": true,
  "native_android_crash": true,
  "native_ios_crash": true,
  "stack_trace_symbolicated": true
}
```

---

## Certification verdict

| Verdict | Reason |
|---------|--------|
| **BLOCKED** | No `.map` on release; no device-native Android/iOS crashes; stack traces not source-map-symbolicated |

JS envelope ingestion and SDK wiring are production-ready. Native crash capture, source map upload, and symbolication require **EAS native build + physical device verification**.

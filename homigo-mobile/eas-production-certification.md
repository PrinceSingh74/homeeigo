# EAS Production Build Certification

**Project:** `homigo-mobile`  
**Certified at:** 2026-06-27T00:00:00Z (audit run on dev workstation)  
**Evidence artifact:** `.certification-evidence/eas-build.json`  
**Certification script:** `npm run certify:eas`

---

## Executive summary

| Area | Status | Notes |
|------|--------|-------|
| Static EAS config (`eas.json`, `app.json`, `package.json`) | **PASS** | Profiles, channels, bundle IDs verified |
| EAS CLI availability | **PASS** | `eas-cli/20.4.0` |
| EAS account login | **BLOCKED** | `npx eas-cli whoami` → `Not logged in` |
| EAS project link (`projectId`) | **BLOCKED** | Placeholder `00000000-0000-0000-0000-000000000000` |
| Android APK build (cloud) | **BLOCKED** | Requires login + real `projectId` |
| Android AAB build (cloud) | **BLOCKED** | Requires login + real `projectId` |
| iOS IPA build (cloud) | **BLOCKED** | Requires login + real `projectId` + Apple credentials |
| OTA Updates (EAS Update) | **PARTIAL** | `expo-updates` installed; `updates.url` pending `eas init` |
| Release channels | **PASS** | `development` / `preview` / `production` wired in `eas.json` |
| JS bundle compile | **PASS** | `expo export --platform web` succeeded |
| TypeScript | **PASS** | `npm run typecheck` exit 0 |
| expo-doctor | **WARN** | 17/18 checks — `@sentry/react-native` major version mismatch |

**Overall production certification: BLOCKED** — Expo account access required to link project and trigger cloud builds.

---

## Config audit

### `eas.json` — PASS

| Profile | Channel | Android output | iOS | Distribution |
|---------|---------|----------------|-----|--------------|
| `development` | `development` | APK | default | internal + dev client |
| `preview` | `preview` | APK | device (`simulator: false`) | internal |
| `preview-aab` | `preview` | AAB (`app-bundle`) | inherits preview | internal |
| `production` | `production` | AAB (`app-bundle`) | store-ready | store (`autoIncrement: true`) |

Update profiles (`eas.json` → `update`):

| Profile | Channel |
|---------|---------|
| `development` | `development` |
| `preview` | `preview` |
| `production` | `production` |

CLI settings: `appVersionSource: remote`, `cli.version >= 14.0.0`.

### `app.json` — PARTIAL

| Field | Status | Value |
|-------|--------|-------|
| `slug` | PASS | `homigo-mobile` |
| `version` | PASS | `1.0.0` |
| `runtimeVersion` | PASS | `{ "policy": "appVersion" }` |
| `ios.bundleIdentifier` | PASS | `com.homigo.mobile` |
| `android.package` | PASS | `com.homigo.mobile` |
| `extra.eas.projectId` | **BLOCKED** | `00000000-0000-0000-0000-000000000000` (placeholder) |
| `expo.updates.url` | **BLOCKED** | Missing — written by `eas init` |
| `expo-updates` plugin | PASS | Listed in `plugins` |

### `package.json` — PASS

Build/update scripts added:

```json
"build:android:apk": "eas build --platform android --profile preview",
"build:android:aab": "eas build --platform android --profile production",
"build:ios:ipa": "eas build --platform ios --profile production",
"update:preview": "eas update --channel preview",
"update:production": "eas update --channel production",
"certify:eas": "node scripts/certify-eas-build.mjs"
```

Dependency: `expo-updates@~29.0.18` (SDK 54 compatible).

---

## Runtime evidence (this audit)

Commands executed on 2026-06-27 from `homigo-mobile/`:

```powershell
npx eas-cli --version
# eas-cli/20.4.0 win32-x64 node-v22.22.0

npx eas-cli whoami
# Not logged in  → BLOCKED

npx eas-cli project:info
# An Expo user account is required to proceed.  → BLOCKED

npx expo-doctor
# 17/18 checks passed. @sentry/react-native expected ~7.2.0, found 6.22.0  → WARN

npm run typecheck
# exit 0  → PASS

npm run build:verify
# expo export --platform web succeeded  → PASS

npm run certify:eas
# staticConfig: PASS, cloudBuild: BLOCKED  → see .certification-evidence/eas-build.json
```

Cloud build commands were **not** attempted (would fail without auth):

```powershell
npx eas-cli build --profile preview --platform android --non-interactive --no-wait
npx eas-cli build --profile production --platform android --non-interactive --no-wait
npx eas-cli build --profile production --platform ios --non-interactive --no-wait
```

---

## Build target readiness

### Android APK — BLOCKED

- **Config:** PASS — `preview` profile sets `android.buildType: "apk"`.
- **Cloud build:** BLOCKED — no EAS login, placeholder `projectId`.
- **Operator command (after unblock):**

```powershell
cd homigo-mobile
npm run build:android:apk
# equivalent: npx eas-cli build --platform android --profile preview --non-interactive
```

### Android AAB — BLOCKED

- **Config:** PASS — `production` and `preview-aab` profiles set `android.buildType: "app-bundle"`.
- **Cloud build:** BLOCKED — no EAS login, placeholder `projectId`.
- **Operator command (after unblock):**

```powershell
cd homigo-mobile
npm run build:android:aab
# equivalent: npx eas-cli build --platform android --profile production --non-interactive
```

### iOS IPA — BLOCKED

- **Config:** PASS — `com.homigo.mobile`, `buildNumber: 1`, `ITSAppUsesNonExemptEncryption: false`.
- **Credentials:** BLOCKED — Apple Developer account + EAS iOS credentials not configured in this environment.
- **Operator command (after unblock):**

```powershell
cd homigo-mobile
npm run build:ios:ipa
# equivalent: npx eas-cli build --platform ios --profile production --non-interactive
npx eas-cli credentials --platform ios
```

### OTA Updates — PARTIAL

| Check | Status |
|-------|--------|
| `expo-updates` package | PASS |
| `expo-updates` plugin in `app.json` | PASS |
| `runtimeVersion` policy | PASS (`appVersion`) |
| `expo.updates.url` | BLOCKED (needs `eas init`) |
| EAS Update publish tested | BLOCKED (needs login) |

**Operator commands (after unblock):**

```powershell
cd homigo-mobile
npx eas-cli init                                    # writes projectId + updates.url
npx eas-cli update --channel preview --message "smoke test"
npx eas-cli update --channel production --message "release"
# or: npm run update:preview / npm run update:production
```

### Release channels — PASS

Channels are aligned between build and update profiles:

| Channel | Build profiles | Update profile |
|---------|----------------|----------------|
| `development` | `development` | `development` |
| `preview` | `preview`, `preview-aab` | `preview` |
| `production` | `production` | `production` |

---

## Fixes applied in this audit

1. Installed `expo-updates@~29.0.18` for OTA support.
2. Added `expo-updates` to `app.json` plugins.
3. Added `channel` to all EAS build profiles in `eas.json`.
4. Added `update` section to `eas.json` with channel mappings.
5. Added explicit APK/AAB/IPA and OTA npm scripts to `package.json`.
6. Expanded `scripts/certify-eas-build.mjs` for static + CLI evidence collection.

**Not applied (requires Expo account):** replacing placeholder `projectId` — must be done interactively via `eas init`.

---

## Operator unblock checklist

Run in order from `homigo-mobile/`:

### 1. Authenticate

```powershell
cd homigo-mobile
npx eas-cli login
npx eas-cli whoami
```

CI alternative:

```powershell
$env:EXPO_TOKEN = "<token-from-https://expo.dev/accounts/[account]/settings/access-tokens>"
npx eas-cli whoami
```

### 2. Link EAS project (replaces placeholder projectId)

```powershell
cd homigo-mobile
npx eas-cli init
# Select: link to existing project OR create new "homigo-mobile"
# Verify app.json now has a real UUID in extra.eas.projectId
# Verify app.json now has expo.updates.url like https://u.expo.dev/<uuid>
```

Validate:

```powershell
npx eas-cli project:info
```

### 3. Set production secrets

```powershell
npx eas-cli secret:create --name EXPO_PUBLIC_API_URL --value https://api.your-domain.com --type string
npx eas-cli secret:create --name EXPO_PUBLIC_RAZORPAY_KEY_ID --value rzp_live_<REDACTED — read from your Razorpay dashboard> --type string
npx eas-cli secret:create --name EXPO_PUBLIC_SENTRY_DSN --value https://...@sentry.io/... --type string
npx eas-cli secret:list
```

### 4. Configure signing credentials

```powershell
npx eas-cli credentials --platform android
npx eas-cli credentials --platform ios
```

### 5. Trigger certification builds

```powershell
npm run certify:eas

npm run build:android:apk
npm run build:android:aab
npm run build:ios:ipa

npx eas-cli build:list --limit 5
```

### 6. Publish OTA smoke update

```powershell
npm run update:preview -- --message "post-cert smoke"
npx eas-cli channel:list
```

### 7. Optional — resolve expo-doctor warning

```powershell
npx expo install @sentry/react-native@~7.2.0
npx expo-doctor
```

---

## Known warnings (non-blocking for config)

| Item | Severity | Detail |
|------|----------|--------|
| `@sentry/react-native` version | LOW | SDK 54 expects `~7.2.0`, installed `6.22.0` |
| `EXPO_PUBLIC_API_URL` in local `.env` | INFO | Points to LAN IP — must be production URL in EAS secrets |
| Push credentials (FCM/APNs) | INFO | Not verified — see `RELEASE_READINESS.md` |
| `react-native-razorpay` | INFO | Requires native dev/production build, not Expo Go |

---

## Re-certification

After unblocking, re-run:

```powershell
cd homigo-mobile
npm run certify:eas
```

Pass criteria for full **PASS**:

- `eas_login.ok === true`
- `project_id.ok === true` (non-placeholder UUID)
- `updates_url.ok === true`
- At least one `builds[]` entry with `ok: true` per target (APK, AAB, iOS)
- `eas update` publish succeeds on `preview` channel

---

## Certification verdict

| Verdict | Reason |
|---------|--------|
| **BLOCKED** | Expo account not authenticated; `projectId` is a placeholder; no cloud build artifacts produced |

Static pipeline configuration is production-ready. Cloud builds and OTA publishing require operator steps in **Operator unblock checklist** above.

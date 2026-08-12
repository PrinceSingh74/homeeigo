# EAS Project Activation Certification — HOMIGO Mobile

**Generated:** 2026-06-27T04:50:00Z  
**Project path:** `homigo-mobile/`  
**EAS CLI:** `eas-cli/20.4.0 win32-x64 node-v22.22.0`

---

## Executive Summary

| Task | Status | Evidence |
|------|--------|----------|
| 1. EAS project linking | **PASS** | `eas init` created `@harekrishna_2003/homigo-mobile` |
| 2. Replace placeholder `projectId` | **PASS** | Real UUID in `app.json` |
| 3. Generate `updates.url` | **PASS** | `eas update:configure` wrote URL |
| 4. Verify EAS project ownership | **PASS** | `whoami` + `project:info` + `app.json` owner align |
| 5. Verify production channels | **PARTIAL** | `eas.json` configured; cloud channel pending first build |
| 6. Verify `expo-updates` configuration | **PASS** | Package, plugin, `runtimeVersion`, `updates.url` |
| `expo-doctor` | **PASS** | 18/18 checks passed |
| Cloud builds (APK/AAB/IPA) | **READY** | Project link blockers removed; no artifacts yet |

---

## 1. EAS Project Linking — PASS

### Command

```text
cd homigo-mobile
npx eas-cli init --non-interactive --force
```

### Runtime output

```text
Using default account harekrishna_2003 for non-interactive and force mode
- Creating @harekrishna_2003/homigo-mobile
√ Created @harekrishna_2003/homigo-mobile: https://expo.dev/accounts/harekrishna_2003/projects/homigo-mobile
√ Project successfully linked (ID: e78603fa-82a0-442a-ac86-e59c4629b235) (modified app.json)
```

### Pre-requisite fix

`eas init` initially failed because `eas.json` contained an invalid top-level `"update"` key rejected by `eas-cli/20.4.0`:

```text
eas.json is not valid.
- "update" is not allowed
```

The invalid `"update"` block was removed. Release channels remain defined on each `build` profile (`development`, `preview`, `production`), which is the supported configuration for EAS CLI 20.x.

---

## 2. Placeholder `projectId` Replaced — PASS

### Before

```json
"projectId": "00000000-0000-0000-0000-000000000000"
```

### After (`npx eas-cli project:info`)

```text
fullName  @harekrishna_2003/homigo-mobile
ID        e78603fa-82a0-442a-ac86-e59c4629b235
```

### Programmatic verification

```text
node -e "..." 
{
  "projectId": "e78603fa-82a0-442a-ac86-e59c4629b235",
  "placeholder": false
}
```

**Result:** `placeholder: false` — not a zero UUID.

---

## 3. `updates.url` Generated — PASS

### Command

```text
npx eas-cli update:configure --non-interactive
```

### Runtime output

```text
√ Configured updates.url to "https://u.expo.dev/e78603fa-82a0-442a-ac86-e59c4629b235"
√ Configured eas.json.
🎉 Your app is configured to use EAS Update!
```

### `app.json` excerpt (post-configure)

```json
"updates": {
  "url": "https://u.expo.dev/e78603fa-82a0-442a-ac86-e59c4629b235"
}
```

---

## 4. EAS Project Ownership — PASS

### Authenticated account (`npx eas-cli whoami`)

```text
harekrishna_2003
princesingh40343@gmail.com

Accounts:
• harekrishna_2003 (Role: Owner)
• harekrishna2003s-team (Role: Owner)
```

### Project scope (`npx eas-cli project:info`)

| Field | Value |
|-------|-------|
| `fullName` | `@harekrishna_2003/homigo-mobile` |
| `ID` | `e78603fa-82a0-442a-ac86-e59c4629b235` |

### `app.json` owner field

```json
"owner": "harekrishna_2003"
```

**Result:** Logged-in user owns the account that owns the linked Expo project. Account slug matches `app.json` `owner` and `project:info` `fullName` prefix.

---

## 5. Production Channels — PARTIAL

### Static configuration (`eas.json`) — PASS

```json
"production": {
  "autoIncrement": true,
  "channel": "production",
  ...
}
```

Programmatic check:

```json
{ "productionChannel": "production" }
```

### Cloud channel state — PENDING (expected before first build)

```text
npx eas-cli channel:list --json
{ "currentPage": [] }

npx eas-cli channel:view production
Could not find channel with the name production
```

**Interpretation:** `eas.json` correctly maps the `production` build profile to channel `production`. Expo does not provision named update channels on the server until the first build or `eas update` publish targets that channel. This is expected pre-build state, not an activation failure.

| Check | Status |
|-------|--------|
| `eas.json` `build.production.channel` = `"production"` | **PASS** |
| Cloud channel `production` exists | **PENDING** (first build/update required) |

---

## 6. `expo-updates` Configuration — PASS

| Requirement | Value | Status |
|-------------|-------|--------|
| Package | `expo-updates@~29.0.18` in `package.json` | PASS |
| Plugin | `"expo-updates"` in `app.json` plugins | PASS |
| `runtimeVersion` | `{ "policy": "appVersion" }` | PASS |
| `updates.url` | `https://u.expo.dev/e78603fa-82a0-442a-ac86-e59c4629b235` | PASS |
| `extra.eas.projectId` | `e78603fa-82a0-442a-ac86-e59c4629b235` | PASS |

---

## 7. `expo-doctor` — PASS

### Command

```text
npx expo-doctor
```

### Runtime output (final run)

```text
Running 18 checks on your project...
18/18 checks passed. No issues detected!
```

> Note: One intermediate run failed with `ConnectTimeoutError` to `exp.host:443` (transient network). Retry succeeded with 18/18.

---

## 8. Cloud Build Readiness (APK / AAB / IPA)

| Artifact | Profile | Platform config | Prior status | Current status |
|----------|---------|-----------------|--------------|----------------|
| APK | `preview` | `android.buildType: apk` | BLOCKED (placeholder `projectId`) | **READY_TO_ATTEMPT** |
| AAB | `production`, `preview-aab` | `android.buildType: app-bundle` | BLOCKED | **READY_TO_ATTEMPT** |
| IPA | `production` | iOS profile defined | BLOCKED | **READY_TO_ATTEMPT** (Apple credentials still required at build time) |

No cloud build was submitted during activation. Blockers from placeholder `projectId` and missing `updates.url` are resolved.

### Suggested next commands

```bash
cd homigo-mobile
npx eas-cli build --profile preview --platform android        # APK
npx eas-cli build --profile production --platform android     # AAB
npx eas-cli build --profile production --platform ios         # IPA
```

---

## Files Modified During Activation

| File | Change |
|------|--------|
| `app.json` | Real `projectId`, `owner`, `updates.url`; deduplicated Android location permissions |
| `eas.json` | Removed invalid `"update"` top-level key (blocked `eas init` on CLI 20.4.0) |

---

## Certification Verdict

**EAS project activation: PASS** (with production cloud channel provisioning pending first build).

All activation criteria met with runtime evidence:

- [x] `projectId` is a real UUID (not `00000000-0000-0000-0000-000000000000`)
- [x] `expo.updates.url` generated and matches project ID
- [x] EAS project linked to `@harekrishna_2003/homigo-mobile`
- [x] Ownership verified via CLI and config
- [x] `expo-updates` fully configured
- [x] `expo-doctor` clean (18/18)
- [ ] Cloud `production` channel exists on Expo servers — **pending first build/update**

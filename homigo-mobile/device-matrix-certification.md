# Device Matrix Certification

**Project:** `homigo-mobile`  
**Certified at:** 2026-06-27 (audit run on Windows dev workstation)  
**Evidence artifacts:**
- `.certification-evidence/device-results.json`
- `docs/enterprise/mobile-runtime-evidence.json`

**Certification command:** `npm run certify:device-matrix`

---

## Executive summary

| Metric | Value |
|--------|-------|
| **Overall verdict** | **BLOCKED** |
| Devices in matrix | 11 |
| Flows per device | 9 |
| Total test cells | 99 |
| Cells with runtime proof | **0 / 99** |
| Screenshots collected | **0** |
| Device logs collected | **0** |

No physical device or emulator was available on the certification host. Per certification rules, every cell is marked **BLOCKED** — not PASS.

---

## Host environment (runtime evidence)

Probed on 2026-06-27 from `homigo-mobile/`:

```powershell
# ADB — SDK present, zero devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
# List of devices attached
# (empty)

# Maestro — not installed
where maestro
# INFO: Could not find files for the given pattern(s).

# iOS — unavailable on Windows
xcrun simctl list devices available
# xcrun: command not found

npm run certify:device-matrix
# overallStatus: BLOCKED, passedCells: 0/99

bun run scripts/enterprise/run-mobile-runtime.ts
# exit 2 — maestro_cli: fail, android_device: fail, ios_runtime: fail
```

| Probe | Result | Detail |
|-------|--------|--------|
| Host OS | `win32` | Windows — no iOS simulator support |
| ADB binary | **FOUND** | `Android Debug Bridge version 1.0.41` at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` |
| Connected Android devices | **0** | `adb devices` returned empty list |
| Maestro CLI | **NOT INSTALLED** | `where maestro` — not found |
| iOS runtime (`xcrun`) | **UNAVAILABLE** | Requires macOS host |
| Proof files | **0** | `.certification-evidence/device-proofs/` has no `*.json` proofs |
| Screenshots | **0** | `.certification-evidence/device-proofs/screenshots/` empty |
| Logs | **0** | `.certification-evidence/device-proofs/logs/` empty |

**Environment blockers:**

1. No Android device or emulator connected (`adb devices` empty).
2. Maestro CLI not installed (required for automated flow execution).
3. iOS certification requires macOS (`xcrun` / Xcode Simulator unavailable on Windows).

---

## Device matrix

### Android OEM targets

| Device | Platform | Flows passed | Status | Blocker |
|--------|----------|--------------|--------|---------|
| Samsung | Android | 0/9 | **BLOCKED** | No device connected |
| Google Pixel | Android | 0/9 | **BLOCKED** | No device connected |
| OnePlus | Android | 0/9 | **BLOCKED** | No device connected |

### Android API level targets

| Device | API | Flows passed | Status | Blocker |
|--------|-----|--------------|--------|---------|
| Android 10 | 29 | 0/9 | **BLOCKED** | No emulator/API 29 image running |
| Android 11 | 30 | 0/9 | **BLOCKED** | No emulator/API 30 image running |
| Android 12 | 31 | 0/9 | **BLOCKED** | No emulator/API 31 image running |
| Android 13 | 33 | 0/9 | **BLOCKED** | No emulator/API 33 image running |
| Android 14 | 34 | 0/9 | **BLOCKED** | No emulator/API 34 image running |
| Android 15 | 35 | 0/9 | **BLOCKED** | No emulator/API 35 image running |

### iOS targets

| Device | Platform | Flows passed | Status | Blocker |
|--------|----------|--------------|--------|---------|
| iPhone | iOS | 0/9 | **BLOCKED** | Windows host — requires macOS + simulator/device |
| iPad | iOS | 0/9 | **BLOCKED** | Windows host — requires macOS + simulator/device |

---

## Flow certification matrix

Flows tested per device: **none** (no runtime execution possible).

| # | Flow | Samsung | Pixel | OnePlus | A10 | A11 | A12 | A13 | A14 | A15 | iPhone | iPad |
|---|------|---------|-------|---------|-----|-----|-----|-----|-----|-----|--------|------|
| 1 | Launch | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 2 | Login | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 3 | Signup | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 4 | Booking | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 5 | Tracking | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 6 | Wallet | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 7 | Payment | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 8 | Notifications | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| 9 | Background Resume | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

**Screenshots:** none  
**Logs:** none

---

## Existing automation (not executed)

A single Maestro flow exists but was **not run** (no Maestro CLI, no device):

- Path: `homigo-mobile/.maestro/flows/login.yaml`
- **Config issue:** `appId: com.homigo.app` — production bundle ID is `com.homigo.mobile` (`app.json`). Flow will fail until corrected.

```yaml
appId: com.homigo.app   # ← mismatch; should be com.homigo.mobile
---
- launchApp
- assertVisible: "Sign in"
# ...
```

No Maestro flows exist yet for: signup, booking, tracking, wallet, payment, notifications, background resume.

---

## Proof format (required to unblock a cell)

Each passing cell requires a proof JSON **and** at least one artifact (screenshot or log file).

**Proof JSON path:**  
`.certification-evidence/device-proofs/{deviceId}__{flowId}.json`

**Screenshot path:**  
`.certification-evidence/device-proofs/screenshots/{deviceId}__{flowId}.png`

**Log path:**  
`.certification-evidence/device-proofs/logs/{deviceId}__{flowId}.log`

**Example** (`pixel__login.json`):

```json
{
  "ok": true,
  "deviceId": "pixel",
  "flowId": "login",
  "testedAt": "2026-06-27T12:00:00.000Z",
  "deviceModel": "Pixel 8",
  "androidVersion": "14",
  "screenshot": "pixel__login.png",
  "log": "pixel__login.log",
  "durationMs": 2100,
  "notes": "Login completed; home tab visible"
}
```

Re-run certification after uploading proofs:

```powershell
cd homigo-mobile
npm run certify:device-matrix
```

---

## Operator playbook

### 1. Android — install tooling

```powershell
# Install Maestro (see https://maestro.mobile.dev/getting-started/installing-maestro)
# Ensure Android SDK platform-tools on PATH or use full adb path

# Start emulator (example: Pixel API 34)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_8_API_34

# Verify device
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
```

### 2. Install dev/production build on device

Expo Go is insufficient for payment (`react-native-razorpay`) and push notifications. Use an EAS dev or preview build:

```powershell
cd homigo-mobile
npm run build:android:apk
# Install APK via adb install <path-to.apk>
```

### 3. Start backend + set API URL

```powershell
# homigo-mobile/.env — use LAN IP or production API
# EXPO_PUBLIC_API_URL=http://<host>:3000

cd apps/backend
npm run dev
```

### 4. Run flows manually or via Maestro

**Manual per flow:** execute flow on device, capture screenshot + logcat:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" exec-out screencap -p > .certification-evidence/device-proofs/screenshots/pixel__login.png
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -d > .certification-evidence/device-proofs/logs/pixel__login.log
```

**Maestro (login only today):**

```powershell
# Fix appId in .maestro/flows/login.yaml first
cd homigo-mobile
maestro test .maestro/flows/login.yaml
```

### 5. Flow-specific notes

| Flow | Requirements |
|------|--------------|
| Launch | Cold start from killed state; measure time-to-interactive |
| Login | Demo creds or test account; verify home screen |
| Signup | New phone/email; OTP if enabled in backend |
| Booking | Active backend + provider availability |
| Tracking | Active booking + GPS permission + WebSocket |
| Wallet | Authenticated user; backend wallet endpoints |
| Payment | **Native build required** — Razorpay test keys |
| Notifications | **Native build required** — FCM configured; app killed state |
| Background Resume | Send app to background 30s+; verify session + WS reconnect |

### 6. iOS — macOS CI required

```bash
# On macOS runner only
xcrun simctl list devices available
xcrun simctl boot "iPhone 15"
# or connect physical iPhone/iPad via USB

cd homigo-mobile
npm run build:ios:ipa   # or expo run:ios
maestro test .maestro/flows/login.yaml
```

### 7. API-level emulator matrix (Android 10–15)

Create one AVD per API level and repeat flows:

| AVD name | API | Android version |
|----------|-----|-----------------|
| `Homigo_API_29` | 29 | Android 10 |
| `Homigo_API_30` | 30 | Android 11 |
| `Homigo_API_31` | 31 | Android 12 |
| `Homigo_API_33` | 33 | Android 13 |
| `Homigo_API_34` | 34 | Android 14 |
| `Homigo_API_35` | 35 | Android 15 |

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" "system-images;android-34;google_apis;x86_64"
& "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\avdmanager.bat" create avd -n Homigo_API_34 -k "system-images;android-34;google_apis;x86_64"
```

### 8. Re-certify

```powershell
cd homigo-mobile
npm run certify:device-matrix
```

**PASS criteria:** `passedCells === 99` and `overallStatus === "PASS"` in `device-results.json`.

---

## Certification verdict

| Verdict | Reason |
|---------|--------|
| **BLOCKED** | Zero physical devices/emulators connected; zero screenshots/logs; zero flow proofs; Maestro not installed; iOS runtime unavailable on Windows host |

This certification documents **environment readiness only**. No HOMIGO mobile flow was executed on any target device during this audit.

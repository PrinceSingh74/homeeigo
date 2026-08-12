# HOMIGO — Native Build Certification (GATE 3)

**Date:** 2026-06-25 · **Verdict: BLOCKED — no build toolchain / accounts in this environment.**

## Why BLOCKED (runtime evidence)
| Artifact / step | Probe result |
|---|---|
| `eas-cli` | **NOT installed** → no `eas build` |
| `ANDROID_HOME` / Android SDK | **NOT set** → no local APK/AAB |
| `adb` / emulator | **NOT available** → can't install/launch |
| `xcodebuild` | **NOT available** (not macOS) → no IPA |
| EAS account login | none (a projectId string exists in `app.json` but no authenticated EAS session here) |

APK / AAB / IPA / OTA all require EAS (or a local Android/Xcode toolchain) + Apple Developer + Google Play
credentials. None are present, so install → launch → login → booking → tracking on a real binary **cannot
be performed**.

## What IS ready (so the build will succeed once tooling/accounts exist)
- **JS bundle builds clean**: `expo export --platform android` → Hermes bundle **8.92 MB**, 0 errors (reproduced every round).
- **Config valid**: expo-doctor 15/18; `app.json` has icon/adaptive-icon/splash (1024² PNG), bundle IDs `com.homigo.mobile`, version 1.0.0 / build 1, scheme `homigo://`, EAS `projectId` populated, `eas.json` profiles (dev/preview/production).
- New-Arch enabled; New-Arch caveat = `react-native-razorpay` (see GATE 2).

## Exact steps to clear
1. `npm i -g eas-cli && eas login`. 2. `eas build -p android --profile production` (AAB) + `--profile preview` (APK).
3. `eas build -p ios` (needs Apple Developer). 4. Install on a device → verify launch, login, create booking, open
   tracking, no crash. 5. `eas update` for OTA. Capture install logs + screen recordings as evidence.

> **BLOCKED — eas-cli + Android SDK + Xcode + developer accounts.** The project is build-config-ready (JS
> bundles clean, valid icons/schema); producing signed binaries needs external tooling/accounts.

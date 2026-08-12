# HOMIGO — Mobile Native Build Certification

**Date:** 2026-06-25 · **Status: BLOCKED.**

## Verdict: **BLOCKED — requires an EAS account + Apple Developer + Google Play credentials.**

| Artifact | Status | Blocker |
|---|---|---|
| Android APK | BLOCKED | `eas build -p android` needs an **EAS (Expo) account** |
| Android AAB | BLOCKED | same |
| iOS IPA / Archive | BLOCKED | **Apple Developer account** + signing certs |
| Release signing | BLOCKED | Android keystore / iOS provisioning |
| OTA (EAS Update) | BLOCKED | EAS account + `runtimeVersion` channel |
| Deep links runtime | BLOCKED | install on device (scheme `homigo://` configured in `app.json`) |

## What IS ready (engineering-controlled, verified here)
- **JS bundle builds clean:** `expo export --platform android` → Hermes bundle **8.92 MB**, 0 errors.
- **typecheck 0**, **0 circular deps**.
- **App config valid:** expo-doctor **15/18** (remaining 3 = pre-existing metro-monorepo + razorpay-newArch + patch-versions).
- **Store assets present:** `icon.png`, `adaptive-icon.png`, `splash.png` (1024², valid PNG), bundle IDs `com.homigo.mobile`, version 1.0.0 / build 1.
- **`eas.json` profiles** (development/preview/production) present; `extra.eas.projectId` is a **placeholder** (real one needs `eas init`).

## To clear
1. `eas init` (binds a real `projectId`). 2. `eas build -p android --profile production` (AAB) and `-p ios`.
3. Configure signing. 4. Install on a device → verify launch, login, booking, tracking, no crash.

> **BLOCKED.** The project is build-config-ready (JS bundles clean, valid icons/schema), but producing
> signed native binaries requires external developer accounts unavailable in this environment.

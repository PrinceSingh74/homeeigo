# Mobile Runtime Report

**Generated:** 2026-06-26T19:26:19.422Z
**Host:** win32

## Result

| Check | Status | Detail |
|-------|--------|--------|
| maestro_cli | ❌ | not installed |
| adb_cli | ❌ | not installed |
| android_device | ❌ | adb unavailable |
| maestro_login_flow | ❌ | requires maestro + connected Android emulator/device |
| ios_runtime | ❌ | iOS simulator not available on this Windows host — run on macOS CI |

## Success criteria

| Criterion | Target | This run |
|-----------|--------|----------|
| Crashes | 0 | not measured (no device) |
| ANRs | 0 | not measured |
| Startup | < 3s | not measured |
| Memory stable | yes | not measured |

## Verdict

**BLOCKED** — install Maestro + Android emulator, or run on macOS for iOS Detox/Maestro

# Mobile App Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Screens: 27

| Area | Screens | API | Status |
|------|---------|-----|--------|
| Auth | login, signup | authApi | CONNECTED |
| Booking | book, track, rate | coreApi + WS | CONNECTED |
| Wallet | wallet tab | coreApi | CONNECTED |
| Push | AppOverlays | device push token API | CONNECTED |
| Maps | track, address/picker | parityApi.geo | CONNECTED |
| Realtime | RealtimeBridge | 5 WS channels | CONNECTED |
| Offline | lib/offline | queue hooks | PARTIAL |

## Gaps

- **P3:** Static SERVICES catalog fallback when API empty (homigo-mobile/src/hooks/use-catalog.ts)
- **apps/mobile** is stub — real app is homigo-mobile

## Dead Screen Check

No orphaned screens detected in expo-router app/ directory.

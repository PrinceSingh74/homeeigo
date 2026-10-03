# Mobile real-device certification — BLOCKED (no physical device)

Status: **BLOCKED — NO PHYSICAL DEVICE.** `adb devices` lists none attached (verified 2026-09-20).
No mobile flow below has been exercised on hardware in this pass, and none is claimed as PASS.

TypeScript, unit and integration results do **not** substitute for any line in this checklist:
permissions, background execution, GPS behaviour, the payment SDK and OS lifecycle only exist on a
device.

## What is prepared
- Apps: `homigo-mobile` (customer) and `homigo-partner-mobile` (partner), Expo 54 / RN 0.81.
- A dev build is required, not Expo Go — reanimated 4, maps and the Razorpay SDK are native
  (memory: `mobile-usb-dev-workflow`).
- Device workflow: USB dev build + `adb reverse` + `EXPO_PUBLIC_DEV_API_MODE=usb`.
- Point the app at an **isolated** backend (`NODE_ENV=test` → `homigo_test`), never `homigo_db`.
- Seed demo accounts into that database first (`scripts/ensure-demo-users.ts`,
  `scripts/ensure-demo-partner.ts` with `NODE_ENV=test`).

## Customer app — required evidence per row
| # | Flow | Pass criteria | Result |
|---|---|---|---|
| 1 | Login (password + OTP) | session established; token stored in SecureStore, not AsyncStorage | NOT TESTED |
| 2 | Location permission | grant, deny and "while using" all handled without a crash | NOT TESTED |
| 3 | GPS fix | real coordinates; unknown fix is `null`, never `0,0` | NOT TESTED |
| 4 | Address create/select | saved and reused; geocode degrades gracefully when Maps is unavailable | NOT TESTED |
| 5 | Price quote | matches the web quote for the same inputs | NOT TESTED |
| 6 | Booking create | booking appears with the same number on web and admin | NOT TESTED |
| 7 | Razorpay checkout | **test keys only**; success, failure and user-cancel paths | NOT TESTED |
| 8 | Wallet payment | balance debited once; ledger balanced | NOT TESTED |
| 9 | Split payment (wallet + gateway) | both legs recorded; no double charge | NOT TESTED |
| 10 | Live tracking | partner position updates; map recovers after backgrounding | NOT TESTED |
| 11 | Reschedule | slot moves; old slot released | NOT TESTED |
| 12 | Cancel + refund | refund matches the published policy tier | NOT TESTED |
| 13 | Access-token expiry | silent refresh; exactly one refresh flight for concurrent 401s | NOT TESTED |

## Partner app — required evidence per row
| # | Flow | Pass criteria | Result |
|---|---|---|---|
| 1 | Login | session established | NOT TESTED |
| 2 | Token refresh | body-token mode still works (web moved to cookies; mobile did not) | NOT TESTED |
| 3 | Go online | presence fresh; roster shows the partner | NOT TESTED |
| 4 | Offer received | push + in-app offer with countdown | NOT TESTED |
| 5 | Countdown expiry | offer expires and re-dispatches | NOT TESTED |
| 6 | Accept | exactly one owner; other partners' offers close | NOT TESTED |
| 7 | En route | status + GPS recorded | NOT TESTED |
| 8 | Arrived | geofence respected; arrival without GPS refused | NOT TESTED |
| 9 | Start PIN | correct PIN starts the job; wrong PIN locks after N attempts | NOT TESTED |
| 10 | In progress | state survives app restart | NOT TESTED |
| 11 | **Background location** | see the dedicated section below | NOT TESTED |
| 12 | Screen lock | heartbeat continues per platform policy | NOT TESTED |
| 13 | Network loss | queued updates; no duplicate writes on reconnect | NOT TESTED |
| 14 | Reconnect | WebSocket re-authenticates; no zombie connection | NOT TESTED |
| 15 | Complete | earning credited once; wallet and ledger agree | NOT TESTED |
| 16 | Earnings screen | matches the backend ledger exactly | NOT TESTED |

## Background location (Phase 10) — test explicitly, do not infer
Foreground · background · screen locked · network lost · network restored · GPS disabled ·
permission revoked mid-job · app killed and restarted · battery saver / Doze (Android) and Low Power
Mode (iOS).

For each: heartbeat continuity, location update cadence, presence state transitions, stale detection,
and recovery after the condition ends.

**Honesty rule:** iOS and Android both suspend or throttle background location under battery
policies. Do not claim "continuous background tracking" — record the observed cadence per state and
state the platform limits. If a state cannot be tested, mark it NOT TESTED rather than inferring it.

## Exit criteria
Every row above carries an observed result, a device model and an OS version, with screenshots or a
recording for the money and location rows. Until then this gate stays **BLOCKED**.

**Owner:** QA / mobile engineering — requires one Android and one iOS device.

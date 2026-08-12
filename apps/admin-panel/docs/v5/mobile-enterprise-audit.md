# Mobile Enterprise Audit — HOMIGO V5

**Method:** code + config audit of the mobile workspaces. Device FPS/battery telemetry requires a physical-device run (tooling exists; see below).

## App inventory (fact-checked)
| Path | Role | Reality |
|---|---|---|
| `homigo-mobile` | **Customer app** | Only real RN/Expo app |
| `apps/mobile` | stub | `homigo-mobile-stub`, redirect only — no code |
| Partner mobile | **does not exist** | Partner surface is `apps/partner-web` (web); documented gap in `docs/enterprise/partner-device-certification.md` |
| Admin mobile | **does not exist** | Admin is `apps/admin-panel` (web) |

> Audit therefore covers **`homigo-mobile`** only. There is no second native app to certify.

## Stack (from `homigo-mobile/package.json`)
| Item | Version |
|---|---|
| Expo SDK | ~54.0.35 |
| React Native | 0.81.5 |
| React | 19.1.0 |
| Expo Router | ~6.0.24 |
| State | Zustand 4.5.5 + TanStack Query 5.100 + Axios 1.7 |
| Maps | react-native-maps 1.20.1 |
| Animation | reanimated ~4.1.1 + worklets 0.5.1 |
| Payments | react-native-razorpay 2.3.1 |
| Observability | @sentry/react-native ~7.2.0 |

> README is stale (claims SDK 52 / RN 0.76). `package.json` is source of truth.

## Config
| Setting | State | Evidence |
|---|---|---|
| New Architecture (Fabric) | **Enabled** | `app.json` `newArchEnabled: true` |
| Hermes | implicit (managed Expo default) | no explicit `jsEngine` |
| inlineRequires / RAM bundle | **not configured** | `babel.config.js`, `metro.config.js` |
| assetBundlePatterns | `**/*` (bundles everything matched) | `app.json` |

## API / network behavior
- React Query: `staleTime 30s`, `gcTime 5m`, `refetchOnWindowFocus:false`, `networkMode: offlineFirst`, `retry 2`.
- Polling: bookings **8s** only while a booking is active (disabled otherwise) — good; tracking screen falls back to **30s** poll only when WS disconnected.
- WebSocket: single custom hook, 25s keepalive, 10s watchdog, exponential reconnect ≤30s, dedup via `BoundedEventCache` (2000 keys / 8h).
- **Verdict:** disciplined network usage; no obvious over-fetch storms.

## Battery / location
- Foreground, one-shot `getCurrentPositionAsync` only; **no** `watchPositionAsync`, **no** background location, **no** foreground service, **no** `ACCESS_BACKGROUND_LOCATION`.
- Battery cost dominated by persistent WS + 25s ping when authenticated — acceptable.

## Startup
- Splash hidden on first render or 1.5s fallback; 3s root failsafe.
- Auth bootstrap decoupled from splash (3s hydration timeout).
- Startup budgets enforced in CI: hydration 500ms, bootstrap 5000ms, interactive 2000ms (`scripts/startup-performance-budget-check.mjs`).

## Performance optimizations present
- Offline-first queries, deferred non-critical I/O (`onInteractive`), startup tracing, Sentry breadcrumbs.
- FlatList used in 5 places; **reanimated** used extensively.

## Findings / risks
| Severity | Finding | Recommendation |
|---|---|---|
| Medium | Home tab mounts **11 sections in a single non-virtualized ScrollView**; bookings list uses ScrollView | Convert long feeds to `FlashList`/`FlatList` with `getItemLayout`, `windowSize`, `removeClippedSubviews` |
| Medium | `React.memo` used in only 1 component (`TrackMap`) | Memoize list rows and heavy cards |
| Medium | No image caching layer (`expo-image`/FastImage) | Adopt `expo-image` with disk cache + `prefetch` |
| Low | `book.tsx` is 841 lines | Split into subcomponents for faster JS parse/render |
| Low | `expo-av` declared but unused | Remove to shrink bundle |
| Low | inlineRequires not enabled | Enable in `metro.config.js` for faster cold start |

## Device evidence (tooling available, not yet run here)
`homigo-mobile` ships `certify:native-performance`, `startup:budget`, `startup:certify`, `track-perf-probe.mjs`, and root `enterprise:mobile`. **Action:** run `npm run startup:certify` + `certify:native-performance` on a mid-tier Android device to capture FPS, cold-start, and memory; attach JSON output here.

## Verdict
**Customer app: PASS with medium-priority optimizations** (list virtualization, memoization, image caching). No partner/admin native apps exist — partner mobile remains a documented product gap, not a codebase defect.

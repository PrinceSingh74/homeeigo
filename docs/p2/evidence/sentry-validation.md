# Evidence — Sentry Delivery Validation

Generated: 2026-06-21T06:48:16.228Z  ·  Marker: `p2-sentry-drill-1782024486593`  ·  Release: `homigo-backend@1.0.0`
Verdict: **PARTIAL (emitted; delivery unconfirmed)**

## Synthetic failures emitted (backend)
| Category | Emitted |
|---|:--:|
| database | ✅ |
| payment | ✅ |
| integration | ✅ |
| auth | ✅ |
| security | ✅ |

## Delivery / Grouping / Release tracking
- Delivery confirmed via Sentry API: ❌ — 0 issue group(s) found for marker (grouping ✅ if >0)
- Release tag attached to events: `homigo-backend@1.0.0` (set in observability.init)

## Frontend / Mobile (validated in their own SDKs)
Trigger from each client and confirm the issue appears under the same project:
```ts
// web (apps/web) & partner-web: @sentry/nextjs initialised, then:
Sentry.captureException(new Error('p2 web synthetic'));
// mobile (apps/mobile): @sentry/react-native, then:
Sentry.captureException(new Error('p2 mobile synthetic'));
```
- Source maps: confirm `sentry-cli sourcemaps upload` runs in each client's release build (CI).

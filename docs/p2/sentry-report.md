# HOMIGO — Sentry Report

**Date:** 2026-06-17 · verified from actual code/deps.

## Backend — ✅ CONFIGURED
- Dep: `@sentry/bun@^10.56.0` (package.json).
- `lib/observability.ts`: lazy-loads `@sentry/bun` **only when `SENTRY_DSN` is set** (no-op otherwise — zero overhead in dev). Exposes `captureException(e, ctx)`.
- Wired into `middleware/error.middleware.ts` (lines 144, 170) → **API failures, payment failures, dispatch failures captured** (they all surface as thrown errors through the middleware).
- Captures: backend exceptions, request context. Release tagging available via env.

## Frontends — ❌ NOT CONFIGURED (gap)
- `apps/web`, `apps/admin-panel`, `apps/partner-web`: **no `@sentry/nextjs`**, no `sentry.client.config.ts`/`sentry.server.config.ts`/`instrumentation.ts`.
- Therefore **JavaScript errors, React errors, session replay, frontend performance, source-map symbolication are NOT active** for customer/partner/admin.

## Recipe to close the gap (per app)
```
npm i @sentry/nextjs
npx @sentry/wizard@latest -i nextjs   # generates sentry.*.config.ts + wraps next.config
# set NEXT_PUBLIC_SENTRY_DSN, enable tracesSampleRate + replaysSessionSampleRate + sourcemaps
```
Then: release tracking (`SENTRY_RELEASE`), source maps upload in CI, session replay, performance (`tracesSampleRate`), error fingerprinting (default + custom `beforeSend`).

## Status
| Surface | JS/React errors | API/payment/dispatch failures | Session replay | Source maps |
|---|---|---|---|---|
| Backend | n/a | ✅ (DSN-gated) | n/a | n/a |
| Customer / Partner / Admin | ❌ | ❌ | ❌ | ❌ |

**Verdict:** backend error tracking PASS (needs DSN at deploy); **frontend error tracking NOT VERIFIED / not installed** — the single largest observability gap. No real Sentry project/DSN exists in this environment, so even backend capture is dormant until DSN is provided.

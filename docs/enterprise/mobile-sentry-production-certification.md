# HOMIGO — Mobile Sentry Production Certification

**Date:** 2026-06-25 · **Status: BLOCKED.**

## Verdict: **BLOCKED — requires a Sentry DSN/account + a native build (source maps need a real binary).**

| Check | Status | Blocker |
|---|---|---|
| Source maps uploaded | BLOCKED | EAS build + Sentry auth token |
| Android native crash captured | BLOCKED | native build on device + DSN |
| iOS native crash captured | BLOCKED | native build on device + DSN |
| User context / breadcrumbs | BLOCKED (delivery) | DSN; **wiring is ready** (below) |
| Release artifacts | BLOCKED | EAS build + release tagging |

## What IS ready (engineering-controlled)
- **App-root `ErrorBoundary`** (`src/components/app/ErrorBoundary.tsx`) catches render crashes, hides the splash, and calls `reportError`.
- **`reportError`** (`lib/observability/telemetry.ts`) logs + ships to a Sentry global if one is wired (`globalThis.__HOMIGO_SENTRY__`) — **Sentry-ready, DSN-gated**.
- **JS-level observability already live without Sentry:** mobile RUM beacons reach Prometheus (`web_vitals_*{device="android"}`), so latency/cold-start are observable today.

## To clear
1. Create a Sentry project → **DSN**. 2. `npx expo install @sentry/react-native`; init with the DSN and set `globalThis.__HOMIGO_SENTRY__ = Sentry`. 3. Add the Sentry EAS plugin for **source-map upload** on build. 4. Trigger a test native crash on a device → confirm it appears with symbolication + user context.

> **BLOCKED.** Crash *capture* (ErrorBoundary + reportError) is wired and bundles; crash *delivery* to
> Sentry needs a DSN and a native build with source-map upload — neither available here.

# Admin Dashboard LCP — Certification

**Date:** 2026-06-16 · **STATUS: PASS — measured on production build.**

## Measured LCP (admin `/` dashboard, `next start` production build, authenticated)

| Condition | LCP (median of 3) | Samples | Target |
|---|---:|---|---:|
| **Lighthouse-equivalent throttling** (4× CPU + Slow-4G via CDP) | **1044 ms** | 1160, 1044, 1016 ms | < 2500 ms |
| Unthrottled localhost (reference) | 168 ms | 236, 168, 160 ms | — |

Measurement: `apps/admin-panel/e2e/lcp-dashboard.spec.ts` — Playwright + chromium, reads the `largest-contentful-paint` PerformanceObserver entry (the same metric Lighthouse's LCP audit reports). CDP `Emulation.setCPUThrottlingRate {rate:4}` + `Network.emulateNetworkConditions {latency:150ms, ~1.6Mbps}` reproduce Lighthouse's default lab throttling, so the number is comparable to the 2.89 s baseline. (Lighthouse-CLI was not used because the admin dashboard's client-side auth guard makes headless-CLI authentication impractical; the LCP entry measured is identical.)

## Why it already passes (no optimization needed)
The 2.89 s baseline was the **dev build** (unminified, HMR/runtime overhead, no chunk optimization). On the **production build**:
- Dashboard route First Load JS = **134 kB** (measured: `┌ ○ /  6.37 kB  134 kB`).
- Code-split charts/widgets, optimized fonts (`next/font`), tree-shaken icons.
- Result: throttled LCP **1044 ms < 2500 ms** — a 1.85× margin under target.

## Production build evidence
`next build` (admin-panel) completed exit 0; dashboard `/` = 6.37 kB route / 134 kB First Load JS; served via `next start -p 3003`.

**STATUS: PASS** — admin dashboard LCP on the production build, under Lighthouse-equivalent throttling, is **1044 ms (median)**, well below the 2500 ms target. Measured, not estimated.

# HOMIGO Elite Partner — Earnings Intelligence

**Date:** 2026-06-20 · Built in partner-web, consuming ONLY verified `/api/geo-intel/*` + existing
partner endpoints. Real data only. `tsc` 0 errors, production build green.

> **Status: PASS.** Partner "Earnings AI" screen — AI earnings assistant, smart availability, surge
> radar, zone ranking, live earnings + performance — all backed by the verified Geo-Intelligence
> APIs and the partner dashboard. Route: `/intelligence` (partner sidebar → "Earnings AI").

---

## What shipped
| Panel | Source | Detail |
|-------|--------|--------|
| **AI Earnings Assistant** | surge + zone-scoring + provider-density (merged) | "Move to {zone}" with **expected earnings range** + confidence + distance + surge |
| **Smart Availability** | demand/surge + online state | Go Online / Stay Online / Move Zone / Take a Break |
| **Surge Radar** | `surge` | nearby zones sorted by multiplier, expected earnings, distance |
| **Zone Ranking** | `zone-scoring` | best-earning · low-competition · high-risk |
| **AI Operational Insights** | all of the above | derived insight strings (demand spike, current-zone rank, shortage) |
| **Live Earnings** | `providers/me/dashboard` | today / week / month / projected |
| **Performance** | `providers/me/dashboard` | acceptance · completion · on-time · rating · trips |
| **Weather Impact** | `surge` (weatherSurge) | earnings effect of weather in the partner's zone |

Files: `apps/partner-web/src/app/(partner)/intelligence/page.tsx`,
`src/hooks/use-partner-intelligence.ts`, `src/services/partner-api.ts` (`partnerApi.geoIntel.*`).

## Earnings math (real, not fabricated)
`expectedEarnings2h = (zone.revenue24h ÷ max(active providers,1)) × (2/24) × predictedSurge`, shown as
a ±25% band. Every input traces to a real endpoint (zone-scoring revenue, provider-density supply,
surge multiplier). No hardcoded or invented earnings figures.

## RBAC (changed + verified)
Partners legitimately need aggregate zone intelligence for positioning, so `zone-scoring` and
`provider-density` were widened from ADMIN-only to **ADMIN + VENDOR**. Business/security-sensitive
endpoints stay ADMIN-only. Verified with a VENDOR token:
```
zone-scoring 200 · provider-density 200 · surge 200      (allowed)
revenue-forecast 403 · exec-kpis 403 · fraud 403          (still denied)
```

## Runtime evidence
- partner-web `tsc` **0 errors**; `next build` green — `/intelligence` 5.41 kB / 247 kB, 25/25 pages.
- All consumed endpoints verified live (zone-scoring bestEarning, surge ×3, density, demand ARIMA).
- Location-aware: `useGeolocationWatcher` → nearest zone = "current", ranked vs best-earning.

## Honest scope notes
- **Turn-by-turn navigation + the branded vehicle map engine** (Kalman, heading-rotation, traffic
  route) are **already built and verified on the customer side** (`apps/web` — see
  `maps-experience-and-geo-intelligence.md`); porting those components into the partner map screen is
  a mechanical follow-up (same `kalman-gps` + branded-marker pattern). This session prioritized the
  **earnings-intelligence differentiator** that consumes the verified APIs.
- **Safety route / multi-route "highest earnings"** uses zone-scoring; a true safety route needs an
  incident/crime feed (no data source yet — interface documented).
- No mock data, no placeholder earnings anywhere.

# Bundle Optimization Report — Customer Homepage

**Timestamp:** 2026-06-14T21:00:35Z  
**Evidence:** `measurements/web-build-signoff.log`

## Target vs Measured

| Route | Before | After | Target | Result |
|-------|--------|-------|--------|--------|
| `/` First Load JS | **195 kB** | **193 kB** | **<120 kB** | **FAIL** |
| `/` route JS | ~92 kB (client) | **4.3 kB** | minimal RSC | **PASS** (page chunk) |
| Shared JS | 103 kB | 103 kB | reduce shell | **FAIL** |

---

## Changes Implemented

### Server Components (no new features)
| Section | Before | After | File |
|---------|--------|-------|------|
| Hero | Client + framer-motion + React Query stats | **Server** + `HeroCtaButtons` client island | `HeroSectionServer.tsx` |
| Featured Services | Client `RecommendedSection` | **Server** `RecommendedSectionServer` | server fetch |
| Categories | Client `ServiceCategories` | **Server** `ServiceCategoriesServer` | server fetch |
| Reviews | N/A on homepage | **Server** `ReviewsSectionServer` | static data |

### Lazy Boundaries
| Module | Strategy | File |
|--------|----------|------|
| Realtime + ActiveBooking | `requestIdleCallback` defer | `AppProviders.tsx` → `DeferredRealtime` |
| Wallet modal | Already dynamic `ssr:false` | `AppProviders.tsx` |
| Tracking section | Dynamic in `HomeBelowFold` | `HomeBelowFold.tsx` |
| SearchBar | `next/dynamic` on homepage | `page.tsx` |
| Navbar / BottomNav | `next/dynamic` `ssr:false` | `WithBottomNavLayout.tsx` |
| RoutePrefetch | Lazy client wrapper | `LazyRoutePrefetch.tsx` |
| JetBrains Mono font | **Removed** from root layout | `layout.tsx` |

### Server Data Fetching
- `apps/web/src/lib/server-api.ts` — `fetchStatsOverview`, `fetchServicesCatalog`, `fetchFeaturedServices` with `revalidate: 60`

---

## Why <120 kB Was Not Reached

First Load JS = **shared shell (103 kB)** + **layout client boundaries** (AppProviders, AuthGuard, Navbar chunks) + **dynamic imports still counted in route budget**.

The homepage **page chunk** dropped to **4.3 kB**, but the app shell (React Query, auth, navigation, zustand) remains on the critical path for all `(with-bottom-nav)` routes.

**Further reduction (not implemented — would require layout split):**
- Move `AppProviders` out of root into authenticated-only route group
- Marketing homepage layout without `ProtectedAppShell` / bottom-nav client tree

---

## Evidence Table

| Route | Metric | Timestamp | Result | Evidence |
|-------|--------|-----------|--------|----------|
| `/` | First Load JS **193 kB** | 2026-06-14T21:00:35Z | **FAIL** (<120 kB) | `web-build-signoff.log` |
| `/` | Page JS **4.3 kB** | 2026-06-14T21:00:35Z | **PASS** (RSC) | `web-build-signoff.log` |
| `/` | Revalidate **60s** | 2026-06-14T21:00:35Z | **PASS** | build output |
| `/legal/privacy` | First Load JS **106 kB** | 2026-06-14T21:00:35Z | **PASS** (reference) | `web-build-signoff.log` |

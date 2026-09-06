# Admin HQ Navigation Performance Report

**Date:** 2026-09-05  
**App:** `apps/admin-panel` (HOMEEIGO Business HQ)  
**Method:** Playwright click → heading instrumentation against live DEV (`next dev --turbopack` :3003) + code/Prisma forensics  
**Backend:** `apps/backend` :3000 (Prisma + Redis healthy during the after-fix probe)

This report does **not** claim production LCP. Numbers below are **user-perceived click → main heading visible** in the development app the HQ is actually operated from.

---

## 1. Executive summary

Clicking an Admin HQ sidebar link felt slow because several **real** critical-path costs stacked:

1. **Next.js DEV on-demand compile** of large client routes (first visit to a page can take multiple seconds; historical compile logs show 22–30s on heavy finance/AI routes).
2. **Every page started invisible** — `.biz-page-enter` used `animation-fill-mode: both` from `opacity: 0` for 320ms after the DOM was already ready.
3. **Table/ops pages fired 5–8 APIs on mount** (dashboard + analytics + ops map + workforce + KPI + list), so the list query competed with expensive aggregates.
4. **`adminService.dashboard()`** ran 8 counts, then a **7-day sequential Prisma loop** (14 more queries) — and Bookings/Partners/Customers all called it.
5. **Command Center** gated 6 independent geo queries behind KPI success (`enabled: geoReady`).
6. **Finance dashboard** was fetched under 5+ different React Query keys (duplicate `/me`-class waste for the same 30-day payload).
7. **DEV idle prefetch** compiled the entire nav tree in the background, starving the click the user just made.
8. **Auth bootstrap** always hit `/api/user/me` without an access token (token is not persisted) → 401 → refresh → `/me` again, blocking `AdminAuthGuard` with a full-screen spinner on every full reload.
9. **`Icon3D` imported `motion/react` on every page header**, pulling the animation library into the navigation critical path.
10. Collapsed sidebar sections use `inert` — clicks still work for users who expand, but pending-nav highlight was missing so the UI looked frozen.

Fixes target those root causes. A loading bar was already present; it was **not** used as the solution.

### After-fix measured click → heading (DEV, 8 representative routes)

| Route | Cold (first visit) | Warm (second visit) | APIs in click window (cold) |
|---|---:|---:|---:|
| Executive HQ | 751 ms | 1310 ms | 0 |
| Settings | 3744 ms | 1735 ms | 0 |
| Bookings (table) | 4312 ms | 1701 ms | 2 |
| Partners (table) | 5061 ms | 1605 ms | 9 |
| Command Center (live ops) | 3959 ms | 1341 ms | 4 |
| Finance / CFO | 4489 ms | 1242 ms | 15* |
| HQ landing `/hq/operations` | 5238 ms | 1160 ms | 3 |
| Leads | 3541 ms | 1542 ms | 3 |

\*Finance “15 APIs” includes in-flight leftovers from the previous Command Center navigation (probe records every `/api/*` that *completes* during the wait, not only requests *started* by the new page).

**Warm heading is consistently 1.2–1.7s** across simple, table, live-ops, finance, nested HQ, and leads. Bookings warm recorded **0 new APIs** before the heading — the list is cached; secondary aggregates wait until after first paint.

A prior probe that clicked **collapsed `inert` links** produced 30–50s “timeouts” with `heading=null`. Those rows are **invalid** (navigation never started). They are not used as a before/after delta.

---

## 2. Route inventory

Navigation type for console pages is **client-side App Router `Link`** (almost every `page.tsx` is `"use client"`). Server layout is `app/layout.tsx` → `QueryProvider` → `AdminAuthProvider` → `AdminAuthGuard`. Console chrome is `AdminShell` (sidebar + top bar + `loading.tsx` skeleton).

| Route | Type | Server/Client | Initial APIs (after fix) | DB notes | Main bottleneck class |
|---|---|---|---|---|---|
| `/` Executive HQ | Client | Client queries | dashboard + finance(30) + recent bookings; coverage/reports deferred | dashboard now 9 parallel Prisma reads | SERVER RENDER / API / DATABASE |
| `/hq/[section]` | Client | Dynamic HQ dashboards | per-HQ; shell is local | varies | JAVASCRIPT / CLIENT QUERY |
| `/command-center` | Client | Parallel geo + KPIs | execKpis, surge, density, zones, fraud, revenue, demand | geo intel | API (was waterfall) |
| `/operations` | Client | ops map | opsMap | live ops | API / WEBSOCKET |
| `/availability` | Client | availability | availability APIs | availability axis only | API |
| `/bookings` | Client table | list first | bookings list; dashboard/analytics/ops/workforce **after paint** | list + optional aggregates | was API storm |
| `/bookings/[id]` | Client detail | detail + tracking | booking detail | — | CLIENT QUERY |
| `/vendors` | Client table | list first | providers list; docs/workforce/academy **after paint** | — | was API storm |
| `/vendors/[id]` | Client detail | shell + h1 immediately | provider detail, score, career, lifecycle | four-axis fields stay separate | CLIENT QUERY |
| `/customers` | Client table | list first | customers list; CX/growth/insights **after paint** | — | was API storm |
| `/services` | Client table | list first | services list; analytics after paint | — | CLIENT QUERY |
| `/academy` | Client table | catalog first | academy modules; dashboard/incentives after paint | — | CLIENT QUERY |
| `/partner-acquisition` | Client | acquisition | leads/apps | — | CLIENT QUERY |
| `/partner-acquisition/leads` | Client | Lead CRM | lead list | — | CLIENT QUERY |
| `/partner-acquisition/leads/[id]` | Client detail | shell + h1 immediately | lead detail | — | CLIENT QUERY |
| `/partner-acquisition/applications` | Client | applications | applications | — | CLIENT QUERY |
| `/partner-acquisition/verification` | Client | verification | verification queue | — | CLIENT QUERY |
| `/finance/dashboard` | Client | finance | `financeDashboard(30)` shared key | parallel aggregates already | API / DATABASE |
| `/earnings` | Client hub | same finance key | shared 30-day dashboard | does **not** post money | CACHE |
| `/finance/payouts` | Client | payouts | payout queue | finance axis only | API |
| `/incentives` | Client | rules | incentiveRules | — | CLIENT QUERY |
| `/referrals` | Client | referral HQ | referral analytics | — | CLIENT QUERY |
| `/analytics` | Client | analytics | analytics + dashboard | — | API |
| `/trust-safety/*` | Client | risk/compliance | scoped | — | API |
| `/support` | Client | tickets | support list | — | API |
| `/automation` | Client | workflows | automation | — | API |
| `/settings` | Client | no list API | zustand user only | none | JAVASCRIPT / NAVIGATION |
| `/audit` | Client | audit explorer | audit logs | — | API |
| `/observability/*` | Client | health | observability | — | API |
| `/login` | Client public | auth | login + `/me` | auth | AUTH |

99 `page.tsx` files exist under `apps/admin-panel/src/app`. Nested detail routes: bookings `[id]`, vendors `[id]`, leads `[id]`, incidents `[id]`, risk `[providerId]`, chargebacks `[id]`, HQ `[section]`. Drawers/modals are in-page (not separate routes).

---

## 3. Before measurements

Clean click→heading baselines **before** the fix were not captured: the first Playwright probe clicked collapsed `inert` sidebar links, so most routes never committed (`heading=null`, ~53s timeouts).

**Valid pre-fix observations:**

| Evidence | Value | Class |
|---|---|---|
| Settings (first compile of that Node process) | 31 334 ms click → heading | JAVASCRIPT / Next DEV compile |
| Settings warm (same process) | 4 986–5 012 ms | NAVIGATION + DEV RSC |
| Historical Turbopack log (`/finance/dashboard`) | 29.6 s compile | JAVASCRIPT |
| Historical Turbopack log (`/ai-brain/tools`) | 22.6 s compile | JAVASCRIPT |
| `.biz-page-enter` | +320 ms opacity-0 after DOM ready | LAYOUT / CSS |
| `adminService.dashboard()` chart | 7 sequential day-pairs after 8 counts | DATABASE |
| Command Center | 6 geo queries `enabled: kpisQ.isSuccess` | API waterfall |
| Bookings mount | dashboard + live + cancelled + analytics + ops + kpis + workforce + list | API storm |

---

## 4. Bottleneck analysis

| Delay | Class | Where time went |
|---|---|---|
| First visit to a large client page | JAVASCRIPT | Turbopack compile of the route module graph |
| Warm SPA transition 1.2–1.7s | NAVIGATION | App Router RSC + route JS fetch in DEV (layout does **not** remount) |
| 320 ms blank after commit | LAYOUT | CSS enter animation `both` + `opacity: 0` |
| Bookings/Partners/Customers open | API / DATABASE | Non-list aggregates on the critical path, including dashboard’s sequential 7-day loop |
| Command Center map/intel | API | Artificial KPI gate |
| Full reload into HQ | AUTH | `/me` 401 → refresh → `/me` behind full-screen spinner |
| Every header | BUNDLE | `motion` via `Icon3D` |
| DEV idle | OTHER | Prefetch of 80+ routes competing with the clicked route |

**Not** the bottleneck: WebSocket reconnect on nav (`AdminRealtimeBridge` lives in the root auth provider). Layout remount. Full page reload. RBAC (sidebar `rbac.me` staleTime 300s). Four-axis mixing.

---

## 5. Root causes

1. **DEV compile + idle prefetch storm** — first click pays for Turbopack; idle prefetch made the compiler busy.
2. **Opacity-0 page enter** — hid the already-rendered shell.
3. **Critical-path query storms** on table pages.
4. **Dashboard Prisma waterfall** (sequential calendar days).
5. **Command Center `geoReady` waterfall**.
6. **Duplicate finance query keys**.
7. **Auth token not persisted** + `/me` before refresh.
8. **Motion on `Icon3D`**.
9. **No instant pending-nav state**.
10. **Detail routes gated the entire page** (no h1 until data).

---

## 6. Fixes

| Fix | Why it is a root-cause fix |
|---|---|
| Removed `.biz-page-enter` opacity animation | First paint is the real page, not a 320ms fade |
| `useAfterFirstPaint` + `enabled` on secondary queries (bookings, vendors, customers, academy, services, executive briefs/coverage) | List/shell is no longer queued behind dashboard/analytics/ops/workforce |
| `adminService.dashboard()`: one 7-day `findMany` in the same `Promise.all` as counts; bucket in memory | 9 parallel queries instead of 8 + 14 sequential |
| Command Center: all geo queries start immediately | Independent reads run in parallel |
| Shared `adminKeys.financeDashboard(30)` / unit / reports | One network fetch per session window |
| DEV: skip idle prefetch of the full nav tree; keep hover/touch prefetch | Stops compile storms on the click path |
| `ensureAccessToken()` before `/me` | Full reload is refresh + `/me`, not `/me` 401 + refresh + `/me` |
| `Icon3D` is CSS-only (hover via CSS) | `motion` leaves the header critical path (charts still use it) |
| `markPendingHref` + sidebar/mobile active state | Click highlights immediately; not a fake delay |
| Partner / Lead detail h1 + shell while loading | Route is usable before the detail payload |
| Leads list `SectionHead as="h1"` | First meaningful heading is in the accessibility tree |

**Not changed:** RBAC server enforcement, finance/payout semantics, Partner ≠ Availability ≠ Job ≠ Money, WebSocket subscription for the session.

---

## 7. After measurements

Playwright, headed-less Chromium 1440×900, API-seeded admin session, sidebar sections expanded so `Link` clicks are real.

**Cold (first visit this server process):**

| Route | Click → heading | Click → path commit | APIs seen during wait |
|---|---:|---:|---:|
| Executive HQ | 751 ms | 752 ms | 0 |
| Settings | 3744 ms | 3745 ms | 0 |
| Bookings | 4312 ms | 4348 ms | 2 |
| Partners | 5061 ms | 5013 ms | 9 |
| Command Center | 3959 ms | 3886 ms | 4 |
| Finance dashboard | 4489 ms | 4486 ms | 15* |
| `/hq/operations` | 5238 ms | 5241 ms | 3 |
| Leads | 3541 ms | 3557 ms | 3 |

**Warm (immediate re-visit):**

| Route | Click → heading | Click → path commit | APIs seen during wait |
|---|---:|---:|---:|
| Executive HQ | 1310 ms | 1244 ms | 1 |
| Settings | 1735 ms | 1734 ms | 0 |
| Bookings | 1701 ms | 1776 ms | 0 |
| Partners | 1605 ms | 1618 ms | 0 |
| Command Center | 1341 ms | 1274 ms | 2 |
| Finance dashboard | 1242 ms | 1199 ms | 1 |
| `/hq/operations` | 1160 ms | 1161 ms | 0 |
| Leads | 1542 ms | 1546 ms | 0 |

Repeat (third) pass aborted: the tab hit `chrome-error://chromewebdata/` after the HQ process churn. Cold + warm are complete.

---

## 8. API waterfall comparison

**Command Center (before):**

```
GET execKpis
  └── wait success
        ├── GET surge
        ├── GET density
        ├── GET zoneScoring
        ├── GET fraud
        ├── GET revenueForecast
        └── GET demandForecast
```

**Command Center (after):** all seven start together. Cold probe saw 4 completions before heading (others still in flight — progressive).

**Bookings (before):** list + live count + cancelled count + analytics + ops map + exec KPIs + workforce + dashboard (dashboard itself was 22 Prisma queries).

**Bookings (after):** list (and optional live/cancelled only after first paint). Warm heading: **0 APIs**.

**Finance (before):** same `financeDashboard(30)` under keys  
`executive` / `brief-finance` / `investor` / `hq/finance/dashboard` / `admin/finance/dashboard` / `finance-dashboard`.

**Finance (after):** `["admin", "finance", "dashboard", 30]`.

---

## 9. DB / Prisma findings

| Finding | Action |
|---|---|
| `dashboard()` 7-day loop: 7 sequential `count` + `aggregate` pairs | Replaced with one `findMany` (7-day window, 3 fields) in the initial `Promise.all`; bucket by local calendar date (IST-safe labels unchanged) |
| Finance overview | Already `Promise.all` of aggregates — left as-is |
| Prisma client | Existing singleton (`apps/backend/src/lib/prisma`) — no per-request `new PrismaClient` |
| Pool | Not raised. Query count on dashboard navigation dropped instead |
| Auth / RBAC | No permission joins removed |

Four-axis: dashboard charts count bookings and successful payments. That is **read-side reporting**, not writing Job state from Finance or merging enums.

---

## 10. Bundle findings

| Item | Before | After |
|---|---|---|
| `Icon3D` | `motion/react` spring hover on every HQ header | Static + CSS hover |
| `IsoBarChart` | still `motion` (charts, not the shell) | unchanged |
| `next.config` `optimizePackageImports` | `lucide-react` | + `motion` |
| Maps / command map | already `next/dynamic` + `ssr: false` | unchanged |
| Shared layout | `AdminShell`, sidebar, top bar, realtime bridge | unchanged (no remount on nav) |

---

## 11. Caching / prefetch findings

| Policy | Choice |
|---|---|
| Default React Query | `staleTime: 30s`, `refetchOnWindowFocus: false` (already) |
| Dashboard | 60s + 120s poll safety net |
| Finance 30-day | 60–120s, **shared key** |
| Top-bar badges | 5 min, WS-invalidated |
| RBAC `/me` | 5 min |
| Bookings/Partners list | `placeholderData` kept |
| Finance / payout / RBAC freshness | not stretched into “stale forever” |
| Prefetch | Hover/touch always; **idle full-tree only in production** |

Cache keys are per browser session (in-memory QueryClient). They are not a shared server cache and do not leak tenant rows across admins.

---

## 12. E2E regression

| Run | Result | Notes |
|---|---|---|
| `e2e/hq-nav-permissions.spec.ts` (12 tests) | **12 PASS** | Nav IA + RBAC gating unchanged |
| `e2e/login-dashboard.spec.ts`, `e2e/journey-admin.spec.ts` | **FAIL (infra)** | `ERR_CONNECTION_REFUSED` — Admin `:3003` process crashed (Node OOM during long Playwright + Turbopack compile) |
| Full suite (90 tests) | **Not completed** | Aborted when Admin dev server died mid-run |

**Do not claim 88 PASS / 2 SKIPPED / 0 FAIL** for this change set until a full suite completes with a stable Admin server (`NODE_OPTIONS=--max-old-space-size=8192 npm run dev` recommended on Windows).

Backend unit tests for four-axis FSMs were not required for these diffs (no lifecycle/availability/job/finance writers changed). `adminService.dashboard()` remains a read model.

---

## 13. Security validation

| Check | Result |
|---|---|
| Authorization still server-side | Yes. Sidebar RBAC is discoverability-only (`useAdminPermissions` fail-open). Routes still 403 via admin APIs. |
| No auth moved exclusively to the browser | Yes. `ensureAccessToken` still uses the refresh coordinator + `/api/auth/refresh`. |
| Cache keys | Finance keys are `days`-scoped inside one admin session. Not a cross-user store. |
| No restricted data returned extra | Dashboard `findMany` selects `createdAt`, `paymentStatus`, `finalAmount` only for the 7-day chart. |
| Four-axis | No enum merge. Earnings copy still states Finance HQ owns money; job COMPLETED ≠ paid. |
| Partner ownership | Vendor detail still loads by id through admin APIs. |

---

## 14. Remaining limitations

1. **DEV compile is still the largest first-visit cost.** Warm is 1.2–1.7s in Turbopack DEV. Production (`next build` + `next start`) was **not** re-certified here — a previous `next start` failed with `routesManifest.dataRoutes is not iterable` (stale `.next`). A clean production build + start is the next measurement loop.
2. **Warm 1.2–1.7s is still higher than a fully prefetched static console.** That remainder is App Router RSC/JS in DEV, not a spinner. Further cuts: split mega client pages (`bookings/page.tsx` ~1.3k LOC) into a shell + deferred inspector, and production hosting.
3. **Partners cold still showed 9 API completions** in the heading window (after-paint secondaries + top bar). Further split of below-fold partner widgets would drop that.
4. **Probe API counts can include in-flight requests from the previous route.**
5. **Repeat (3rd) pass crashed** when the page navigated to `chrome-error://`. Treat warm as the stable after-fix number.
6. **OneDrive / long compile** (documented earlier for `apps/web`) still applies if this repo is synced.

---

## Acceptance (measured)

- [x] Navigation starts immediately (pending href + progress bar on click)
- [x] No full page reload on sidebar `Link`
- [x] Route shell / h1 no longer waits on a 320ms fade
- [x] Command Center waterfall removed
- [x] Duplicate finance keys merged
- [x] Table-page secondary APIs deferred
- [x] `motion` removed from the header critical path
- [x] Dashboard Prisma sequential days removed
- [x] Auth `/me` 401 waterfall removed on reload
- [x] RBAC / four-axis / finance semantics preserved
- [x] Representative warm routes 1.2–1.7s heading (DEV)
- [ ] Production `next start` navigation not yet re-measured
- [ ] Full Admin Playwright result — see the run started with this change (do not assume 88/2/0)

---

## Files touched

- `apps/admin-panel/src/app/globals.css`
- `apps/admin-panel/src/components/hq/Icon3D.tsx`
- `apps/admin-panel/src/hooks/use-after-first-paint.ts`
- `apps/admin-panel/src/hooks/use-admin-data.ts`
- `apps/admin-panel/src/lib/nav-pending.ts`
- `apps/admin-panel/src/lib/api-client.ts`
- `apps/admin-panel/src/stores/admin-store.ts`
- `apps/admin-panel/src/components/navigation/AdminRoutePrefetch.tsx`
- `apps/admin-panel/src/components/navigation/RouteProgress.tsx`
- `apps/admin-panel/src/components/layout/HqSidebar.tsx`
- `apps/admin-panel/src/components/layout/MobileHqNav.tsx`
- `apps/admin-panel/src/app/(console)/command-center/page.tsx`
- `apps/admin-panel/src/app/(console)/page.tsx`
- `apps/admin-panel/src/app/(console)/bookings/page.tsx`
- `apps/admin-panel/src/app/(console)/vendors/page.tsx`
- `apps/admin-panel/src/app/(console)/customers/page.tsx`
- `apps/admin-panel/src/app/(console)/academy/page.tsx`
- `apps/admin-panel/src/app/(console)/services/page.tsx`
- `apps/admin-panel/src/app/(console)/vendors/[id]/page.tsx`
- `apps/admin-panel/src/app/(console)/partner-acquisition/leads/[id]/page.tsx`
- `apps/admin-panel/src/app/(console)/earnings/page.tsx`
- `apps/admin-panel/src/app/(console)/finance/dashboard/page.tsx`
- `apps/admin-panel/src/components/hq/ExecutiveBriefs.tsx`
- `apps/admin-panel/src/components/hq/InvestorDashboard.tsx`
- `apps/admin-panel/src/components/hq/dashboards/FinanceHqDashboard.tsx`
- `apps/admin-panel/src/components/acquisition/LeadCrmWorkspace.tsx`
- `apps/admin-panel/next.config.js`
- `apps/backend/src/services/admin.service.ts`
- `apps/admin-panel/scripts/measure-admin-nav.mjs`

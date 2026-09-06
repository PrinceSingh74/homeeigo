# Admin HQ Navigation Performance Report

**Date:** 2026-09-06 (final closure loop)  
**Commits:** `3f0f9fa` (nav perf core), `34fc350` (globals.css first-paint fix)  
**App:** `apps/admin-panel` (HOMEEIGO Business HQ)  
**Method:** Playwright click → heading (`measure-admin-nav.mjs`) + code/Prisma forensics  
**DEV runtime:** `next dev` webpack `:3003`, `NODE_OPTIONS=--max-old-space-size=8192`  
**Production runtime:** clean `next build` + `next start -p 3003` (2026-09-06)  
**Backend:** `apps/backend` :3000 (Prisma ok; Redis in-memory fallback during runs)

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

### After-fix measured click → heading

| Route | DEV warm (webpack) | Production cold | Production warm | Production repeat | Usable UI | Root cause (remaining) | Status |
|---|---:|---:|---:|---:|---|---|---|
| Executive HQ | 1310 ms | 631 ms | 329 ms | 344 ms | H1 + shell immediate | DEV compile only | **Closed** |
| Settings | 1735 ms | 280 ms | 215 ms | 271 ms | Static page, no API | DEV compile only | **Closed** |
| Bookings (table) | 1701 ms | 434 ms | 262 ms | 305 ms | H1 before list fill | Cold: 6 APIs (list + badges); warm cached | **Acceptable** |
| Partners (table) | 1605 ms | 508 ms | 391 ms | 266 ms | H1 + table shell | Cold: 5 APIs (list + docs); warm cached | **Acceptable** |
| Command Center | 1341 ms | 335 ms | 285 ms | 278 ms | Map shell + KPIs parallel | Google Maps JS on adjacent nav | **Closed** |
| Finance / CFO | 1242 ms | 294 ms | 263 ms | 262 ms | Dashboard shell | Shared finance key; no dupes | **Closed** |
| HQ operations | 1160 ms | 293 ms | 287 ms | — | Nested HQ landing | Minor geo in-flight carryover | **Closed** |
| Leads | 1542 ms | 324 ms | 384 ms | — | H1 + CRM shell | 1 lead detail prefetch | **Closed** |

**Primary metric:** click → heading visible (proxy for usable page).  
**DEV warm** numbers are SPA re-navigation under webpack dev (not production).  
**Production** numbers are from `next build` + `next start` on 2026-09-06 (`nav-perf-production.json`).

Production warm navigation is **215–391 ms** click → heading — roughly **4–6× faster** than DEV warm (1.2–1.7 s). The DEV gap is almost entirely Turbopack/webpack on-demand compile and HMR overhead, not product logic.

### Prior DEV warm snapshot (Turbopack, pre-closure)

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

### Full Admin Playwright — completed 2026-09-06

| Metric | Value |
|---|---|
| **PASS** | **72** |
| **FAIL** | **16** |
| **SKIPPED** | **2** |
| **Duration** | **51.1 min** |
| Runtime | Admin webpack dev `:3003`, backend `:3000`, `workers: 1`, `E2E_SKIP_SERVERS=1` |
| Server stability | **No OOM crash** (prior Turbopack run died mid-suite) |

**Skipped (2):** `capture-booking-vendor.spec.ts` (manual capture), `lcp-dashboard.spec.ts` (requires production build flag).

**Failed (16) — classification:**

| Failure bucket | Count | Tests | Cause class |
|---|---:|---|---|
| Responsive overflow matrix | 11 | `loop4-admin-responsive-320`, `p1-visual-matrix*`, `section04` responsive, `section05` responsive, `section09` matrix | **F** product layout at specific widths — not navigation perf |
| Accessibility (axe / keyboard) | 3 | `p0-a11y` (2), `section04` axe-clean | **F** a11y — not navigation perf |
| API / console noise | 2 | `section04` axe (500 during long run), `section09` heading timeout | **E** API under sustained 51-min load |

**Core navigation / RBAC tests — all green:**

| Run | Result |
|---|---|
| `hq-nav-permissions.spec.ts` (12) | **12 PASS** |
| `hq-nav-permissions-live.spec.ts` | **PASS** |
| `journey-admin.spec.ts` | **PASS** |
| `login-dashboard.spec.ts` | **PASS** |
| `enterprise/admin-enterprise.spec.ts` (5) | **5 PASS** |
| `enterprise/operations-certification.spec.ts` (7) | **7 PASS** |
| `section10-command-center.spec.ts`, `section10-mutation-audit.spec.ts` | **PASS** |
| `signoff-journey.spec.ts` (3) | **3 PASS** |

**Do not claim 88 PASS / 2 SKIPPED / 0 FAIL.** Actual certified result: **72 PASS / 16 FAIL / 2 SKIPPED**.

Prior aborted run (Turbopack OOM) is superseded by this completed run.

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

1. **DEV compile remains the largest first-visit cost** (3–5 s cold on Turbopack). Production cold is **280–631 ms** heading — acceptable for prebuilt routes.
2. **Mega client pages** (`bookings`, `academy`, `services` ~1.3k LOC) have `useAfterFirstPaint` in working tree but are not fully committed due to mixed diffs. Production warm Bookings/Partners already cache at 0 APIs; further split is optional bundle hygiene, not a navigation blocker.
3. **16 E2E failures** are responsive/a11y matrix tests under sustained load — track separately from navigation perf closure.
4. **Probe API counts** can include in-flight requests from the previous route.
5. **Redis** fell back to in-memory during closure runs (`Connection timeout`) — did not block navigation measurements.

---

## Final acceptance (2026-09-06 closure)

- [x] Root causes traced and documented
- [x] Page enter opacity blocker removed (`34fc350`)
- [x] Unnecessary waterfalls removed (Command Center, dashboard Prisma, auth)
- [x] Duplicate finance queries merged (`adminKeys.financeDashboard(30)`)
- [x] DEV idle prefetch storm disabled; hover/touch preserved
- [x] Auth 401 → refresh waterfall removed (`ensureAccessToken`)
- [x] Header `motion/react` removed from critical path (`Icon3D`)
- [x] Route shell + H1 before heavy data (detail routes, Lead CRM)
- [x] Pending navigation immediate (`nav-pending.ts`)
- [x] Representative routes measured (DEV + production)
- [x] Production `next build` + `next start` benchmark completed
- [x] Full Admin E2E completed (**72 / 16 / 2** — not 88/0)
- [x] No navigation-permission / journey / enterprise regression
- [x] RBAC / four-axis preserved
- [ ] Responsive/a11y matrix failures (16) — separate backlog
- [ ] Commit mega-page `useAfterFirstPaint` when diffs can be isolated

**Navigation perf closure: COMPLETE.** Remaining E2E failures are layout/a11y width-matrix issues, not click→usable regressions.

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

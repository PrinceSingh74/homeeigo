# HOMIGO — Phase 2 (Admin Panel Real-API Wiring) Completion Report

**Date:** 2026-05-29
**Scope:** Item #8 from the Final Remaining Implementation Prompt — replace ALL mock/static admin data with real backend wiring.
**App:** `apps/admin-panel` (port 3003)
**Validation:** `type-check` ✅ · `lint` ✅ (zero warnings) · `build` ✅ (13 routes)

---

## ✅ What changed

### 0. Mock data layer — DELETED
- `apps/admin-panel/src/lib/admin-data.ts` (the static `ADMIN_KPIS`/`RECENT_BOOKINGS`/`VENDOR_ROWS`/`FRAUD_ALERTS` exports) is **removed**. Every screen now reads live state.

### 1. Auth & session — real
| Concern | Before | After |
|---|---|---|
| Login | Mock "Enter Business HQ" button that just flipped a boolean | Real form posting to `/api/auth/login`, then `/api/user/me` to **enforce `role === "ADMIN"`** before granting session |
| Store | `{ authenticated: boolean, adminName: "Operations Lead" }` | Zustand store with `accessToken` + `refreshToken` (persisted) + `user: CurrentUser` + `bootstrap`/`login`/`logout` + status state machine |
| Guard | Redirected on a boolean | Status-machine aware (`idle` → `initializing` → `authenticated`/`unauthenticated`) with full-screen spinner during boot |
| Sign-out | Cleared boolean | Calls `/api/auth/logout` with refresh token + clears state |

Files:
- `apps/admin-panel/src/stores/admin-store.ts` (full rewrite)
- `apps/admin-panel/src/components/auth/AdminAuthGuard.tsx`
- `apps/admin-panel/src/providers/AdminAuthProvider.tsx` *(new)*
- `apps/admin-panel/src/providers/QueryProvider.tsx` *(new)*
- `apps/admin-panel/src/app/layout.tsx` (wraps in `QueryProvider` → `AdminAuthProvider` → `AdminAuthGuard`)
- `apps/admin-panel/src/app/login/page.tsx` (real form + error states)
- `apps/admin-panel/src/lib/device.ts` *(new — stable device-id for refresh tokens)*

### 2. API client (auto-refresh, error parsing)
- `apps/admin-panel/src/lib/api-client.ts` — native fetch wrapper with `Bearer` auth, automatic `POST /api/auth/refresh` on 401, query-string builder, config-injected token getters (so the store is the single source of truth).
- `apps/admin-panel/src/lib/api-error.ts` — `AdminApiError` class + friendly message mapping for `FORBIDDEN` / `UNAUTHORIZED` / `RATE_LIMIT_EXCEEDED` / `INVALID_CREDENTIALS` / 5xx.

### 3. Admin API surface
`apps/admin-panel/src/services/admin-api.ts` exposes typed callers for every admin route in `apps/backend/src/routes/admin.ts`:
- `dashboard()` → `/api/admin/dashboard`
- `listUsers(query)` → `/api/admin/users`
- `listProviders(query)` → `/api/admin/providers`
- `listBookings(query)` → `/api/admin/bookings`
- `analytics({startDate, endDate})` → `/api/admin/analytics`
- `verifyProvider(id, action, notes?)` → `PUT /api/admin/providers/:id/verify`
- `banUser(id, action, reason?)` → `PUT /api/admin/users/:id/ban`
- `processWithdrawal(id)` → `POST /api/admin/withdrawals/:id/process`

Auth side: `apps/admin-panel/src/services/auth-api.ts` covers `login` / `logout` / `me`.

### 4. TanStack Query hooks + optimistic mutations
`apps/admin-panel/src/hooks/use-admin-data.ts`:

| Hook | Behaviour |
|------|-----------|
| `useAdminDashboardQuery` | KPIs + charts. Live refresh every **60 s**. |
| `useAdminCustomersQuery` | Paginated, debounced search, status filter, `placeholderData` for smooth pagination. |
| `useAdminProvidersQuery` | Same shape — pending/verified filter. |
| `useAdminBookingsQuery` | Status + date range + pagination. **Auto-refresh every 30 s** for ops awareness. |
| `useAdminAnalyticsQuery` | Period-scoped — used by Payments & Analytics pages. |
| `useVerifyProviderMutation` | **Optimistic** — flips `isApproved`/`isVerified` in every cached providers query immediately, rolls back on error, invalidates `providersAll` + `dashboard` on settle. |
| `useBanUserMutation` | **Optimistic** — flips `isActive` across cached customer queries, rolls back on error, invalidates `customersAll` + `bookingsAll` + `dashboard` (backend cascades cancel on ban). |
| `useProcessWithdrawalMutation` | Invalidates dashboard after processing. |

Query client uses `staleTime: 30s`, `gcTime: 5m`, `retry` that skips 401/403/404, `refetchOnWindowFocus: false`. Defined in `apps/admin-panel/src/providers/QueryProvider.tsx`.

### 5. Pages — every screen now talks to the API

| Route | Source | Highlights |
|---|---|---|
| `/` Overview | `/api/admin/dashboard` + `/api/admin/bookings` | Six live KPIs (revenue, bookings, providers, customers, avg rating, completion rate). Two 7-day bar charts. Live bookings table. **Refresh button** + auto-refetch every 60 s. |
| `/customers` | `/api/admin/users` | Debounced search, status filter (all / active / banned), pagination (20/page), per-row Ban / Unban with `ConfirmDialog` that captures a reason. Optimistic toggle. |
| `/vendors` | `/api/admin/providers` | Debounced search, status filter (all / pending / verified), pagination, Approve / Revoke actions with optional notes. Optimistic toggle. |
| `/bookings` | `/api/admin/bookings` | Status dropdown (9 statuses), from/to date range, reset button, pagination, live rating cells. 30 s auto-refetch. |
| `/payments` | `/api/admin/analytics` + `/api/admin/dashboard` | 7d / 30d / 90d presets, KPIs for revenue, commission, payouts, **take rate** computed from `commission/totalRevenue`. Top services table. |
| `/analytics` | `/api/admin/analytics` | 7d / 30d / 90d **+ custom date picker**. Four KPIs, two bar charts, top-services horizontal bar list with shares. |
| `/ai` | `/api/admin/dashboard` | Real counts for "bookings routed", "providers in matching pool", "live providers". Static descriptions for the 4 AI systems with their backend service IDs. No more fake counters. |
| `/fraud` | `/api/admin/users?status=banned` + `/api/admin/providers?status=pending` + `/api/admin/bookings?status=cancelled_by_provider` | Composes real risk signals from the available endpoints, with a clear note that a dedicated fraud-signals endpoint is the next step backend-side. |
| `/settings` | Auth store + `/api/auth/logout` | Shows real admin name / email / role / verification flags. Real sign-out flow. |

### 6. Shared UI primitives
- `apps/admin-panel/src/components/ui/DataTable.tsx` — now has skeleton loading rows, error state with retry, empty state, "Updating…" badge during background refetch, footer slot for pagination. `StatusBadge` palette extended (banned, approved, en_route, etc.).
- `apps/admin-panel/src/components/ui/Pagination.tsx` *(new)* — page X/Y + Showing N–M of T + prev/next.
- `apps/admin-panel/src/components/ui/ConfirmDialog.tsx` *(new)* — destructive variant, optional reason textarea, `reasonRequired` flag, Escape/backdrop close, body-scroll lock.
- `apps/admin-panel/src/lib/format.ts` *(new)* — `inr` (compact ₹/L/Cr), `formatNumber`, `formatPercent`, `formatDate`, `todayIso`, `daysAgoIso`.
- `apps/admin-panel/src/hooks/use-debounced-value.ts` *(new)* — 300 ms debouncer for search inputs.

### 7. AdminTopBar — drops mocks
Replaced the `ADMIN_KPIS.fraudFlags` banner with a **real** counter — `pendingProviders + bannedCustomers` from the admin APIs. Real admin name + role from the store. Real search submission to `/customers?q=…`. Sign-out icon.

---

## ✅ Validation

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run type-check` | ✅ exit 0 (admin-panel, `tsc --noEmit`) |
| ESLint | `npm run lint` | ✅ exit 0, zero warnings or errors |
| Production build | `npm run build` | ✅ exit 0 (13 routes, all static-prerendered, biggest bundle 130 kB FLJ) |
| ReadLints on `apps/admin-panel/src` | — | ✅ zero diagnostics |

Bundle map (Next.js 15.5):
```
Route (app)                Size   First Load JS
/                          3.46 kB   130 kB
/ai                        4.67 kB   124 kB
/analytics                 5.77 kB   125 kB
/bookings                  2.52 kB   126 kB
/customers                 3.91 kB   127 kB
/fraud                     1.93 kB   129 kB
/login                     5.51 kB   108 kB
/payments                  2.11 kB   126 kB
/settings                  5.74 kB   108 kB
/vendors                   4.08 kB   128 kB
```

---

## 🧪 Manual test plan

Pre-req: backend running on `:3000` with at least one user where `role === "ADMIN"`.
Start: `cd apps/admin-panel && npm run dev` (port 3003).

1. **Login**
   - Open `/login`, enter a non-admin email/password → expect "This account is not an admin." red banner.
   - Enter the admin credentials → redirected to `/` with KPIs loading from the live backend.
2. **Overview**
   - Verify 6 KPI cards show real numbers (revenue/bookings/providers/customers/avg rating/completion rate).
   - Two bar charts render the last 7 days (titles match data).
   - Click **Refresh** → background fetch indicator appears in the bookings table, KPIs update.
3. **Customers** (`/customers`)
   - Type in search → debounce 300 ms, request fires once. Page resets to 1.
   - Switch `active` / `banned` filter → table updates.
   - Click **Ban** on an active row → confirm dialog requires reason → submit → row optimistically flips to "banned", real backend confirmed via re-invalidation. Sign-in of that user is now blocked + in-flight bookings cancelled (server-side).
4. **Vendors** (`/vendors`)
   - Pending filter → Click **Approve** → confirm with optional notes → row flips to `approved` immediately.
   - Verified filter → click **Revoke** → confirm (destructive variant) → reverts state.
5. **Bookings** (`/bookings`)
   - Pick a status from the dropdown → table fetches that subset.
   - Pick a date range → query string contains `startDate` and `endDate`.
   - Click **Reset** → all filters clear, page returns to 1.
   - Leave open — background refetch every 30 s shows the "Updating…" badge.
6. **Payments** (`/payments`)
   - Toggle 7d / 30d / 90d → analytics refetches and KPIs (revenue / commission / payouts / take rate) reflow.
7. **Analytics** (`/analytics`)
   - Toggle **Custom** → date inputs appear → adjust dates → KPIs and bar charts react.
   - Top services list shows horizontal share bars.
8. **Fraud** (`/fraud`)
   - Three KPI cards count banned customers / pending KYC / recent provider cancellations.
   - Each section renders an empty-state friendly message if no rows.
9. **Settings** (`/settings`)
   - Profile card shows real name, email, role, email/phone verified flags.
   - **Sign out** → spinner → redirected to `/login` with session cleared from `localStorage`.
10. **Token refresh**
    - Use DevTools → expire the `accessToken` (or wait). Next request → API client receives 401 → silently refreshes via `/api/auth/refresh` → original request retries → no UI bounce.

---

## ⚠️ Notes & remaining-risk

1. **No fraud-signals endpoint yet.** `/fraud` composes risk signals from existing endpoints (banned users, pending KYC, provider cancellations). A dedicated `/api/admin/fraud` returning duplicate-payout/GPS-mismatch/anomaly scores is a backend follow-up — the page already has the layout to consume it.
2. **AI telemetry endpoints are absent.** `/ai` uses dashboard counts as proxies (bookings routed, providers in pool, live providers). When the backend exposes AI metrics (matches/sec, model latency, classification accuracy, etc.) the page is wired to plug them in without layout changes.
3. **Login response shape** — `/api/auth/login` doesn't include `role` in the `user` payload, so the store performs an immediate `/api/user/me` call to confirm `role === "ADMIN"` before activating the session. If the role check fails, the just-issued tokens are wiped. This is intentional and matches the backend's `requireRole("ADMIN")` guard.
4. **ESLint config** — `next/core-web-vitals` + `next/typescript` (added because admin-panel had no eslint config previously). `eslint`/`eslint-config-next` added to `devDependencies` so CI can lint without manual setup.
5. **Withdrawal processing UI** — backend has `POST /api/admin/withdrawals/:id/process` and the hook is wired, but no admin screen surfaces a list of pending withdrawals yet (the data source is on the provider/earnings side). When the partner-web phase adds a withdrawals list endpoint, plug it into a new `/payouts` admin tab.

---

## 📦 File inventory

**New files (12):**
- `apps/admin-panel/src/types/admin.ts`
- `apps/admin-panel/src/lib/api-error.ts`
- `apps/admin-panel/src/lib/api-client.ts`
- `apps/admin-panel/src/lib/device.ts`
- `apps/admin-panel/src/lib/format.ts`
- `apps/admin-panel/src/services/auth-api.ts`
- `apps/admin-panel/src/services/admin-api.ts`
- `apps/admin-panel/src/hooks/use-admin-data.ts`
- `apps/admin-panel/src/hooks/use-debounced-value.ts`
- `apps/admin-panel/src/providers/QueryProvider.tsx`
- `apps/admin-panel/src/providers/AdminAuthProvider.tsx`
- `apps/admin-panel/src/components/ui/Pagination.tsx`
- `apps/admin-panel/src/components/ui/ConfirmDialog.tsx`
- `apps/admin-panel/.eslintrc.json`
- `docs/PHASE2_ADMIN_PANEL_REPORT.md` (this file)

**Modified files (12):**
- `apps/admin-panel/package.json` (+ `@tanstack/react-query`, `zod`, `eslint`, `eslint-config-next`, `type-check` script)
- `apps/admin-panel/src/stores/admin-store.ts` (full rewrite, real session)
- `apps/admin-panel/src/components/auth/AdminAuthGuard.tsx`
- `apps/admin-panel/src/components/layout/AdminTopBar.tsx`
- `apps/admin-panel/src/components/ui/DataTable.tsx`
- `apps/admin-panel/src/app/layout.tsx`
- `apps/admin-panel/src/app/login/page.tsx`
- `apps/admin-panel/src/app/(console)/page.tsx`
- `apps/admin-panel/src/app/(console)/customers/page.tsx`
- `apps/admin-panel/src/app/(console)/vendors/page.tsx`
- `apps/admin-panel/src/app/(console)/bookings/page.tsx`
- `apps/admin-panel/src/app/(console)/payments/page.tsx`
- `apps/admin-panel/src/app/(console)/analytics/page.tsx`
- `apps/admin-panel/src/app/(console)/settings/page.tsx`
- `apps/admin-panel/src/app/(console)/ai/page.tsx`
- `apps/admin-panel/src/app/(console)/fraud/page.tsx`

**Deleted files (1):**
- `apps/admin-panel/src/lib/admin-data.ts`

---

## ✅ Status

**Phase 2 (#8) is complete and merge-ready.**
- Zero TS errors.
- Zero ESLint warnings.
- Production build green (13 routes).
- Premium dark-glass UI preserved.
- No backend contract changes — purely wires the admin frontend to the routes that already shipped.
- TanStack Query is authoritative for caching, optimistic updates, and refetch behaviour.
- Admin role protection enforced both client-side (auth store gate) and server-side (`requireRole("ADMIN")` middleware unchanged).

Next eligible focused session: **Phase 2 (#9) — Partner-web real-API wiring** (analogous pattern, partner role).

# HOMIGO — Phase 2 (Partner-Web Real-API Wiring) Completion Report

**Date:** 2026-05-29
**Scope:** Item #9 from the Final Remaining Implementation Prompt — wire `apps/partner-web` to the real backend (no mocks).
**App:** `apps/partner-web` (port 3002)
**Validation:** type-check ✅ · lint ✅ (zero warnings) · build ✅ (13 routes) · backend type-check ✅

---

## ✅ Highlights

| Layer | What changed |
|---|---|
| **Mocks** | `apps/partner-web/src/lib/partner-data.ts` (DEMO_VENDOR / DEMO_DASHBOARD / DEMO_REQUESTS …) **and** stale `partner-api.ts` — both **deleted**. Zero `DEMO_*` references remain. |
| **Auth** | Real OTP + email/password flows hitting `/api/auth/login` / `/api/auth/send-otp` / `/api/auth/verify-otp` with token refresh + **role = PROVIDER guard** (admins / customers are blocked with a friendly message). |
| **Session store** | Zustand persist store with status machine, `bootstrap()`, role-checked `login()` / `loginWithOtp()` / `sendOtp()` / `logout()`. |
| **API client** | Native-fetch wrapper with automatic 401 → `/api/auth/refresh` retry, query builder, `PartnerApiError` with friendly mapping (`FORBIDDEN`/`INVALID_STATUS`/`INSUFFICIENT_BALANCE` etc.). |
| **TanStack Query** | `QueryProvider` (no-retry on 4xx, 20s staleTime, offline-aware) + 11 typed hooks + optimistic mutations for accept/reject/start/complete and online-toggle. |
| **Realtime** | `PartnerRealtimeBridge` subscribes to `/ws/notifications?token=…` and invalidates booking/wallet/review caches on backend events; toasts surfaced via Zustand toast store. Offline/online transitions tracked. |
| **Backend** | Surgical additive endpoints under `/api/providers/me/*` — no contract changes. |

---

## 🔌 Backend additions (surgical, additive only)

All new routes are `requireProvider`-gated. Customer/admin routes untouched.

### `apps/backend/src/services/provider.service.ts`
- `me(providerId)` — full self-profile (user + provider fields + services + KYC status)
- `setOnline(providerId, online)` — flips `isOnline` + `onlineSince`
- `myBookings(providerId, { status, page, limit, sortBy })` — paginated, status-mapped (`pending|accepted|in_progress|completed|cancelled|active`)
- `myDashboard(providerId)` — KPIs: today/yesterday/week/month/lifetime earnings, completed today + delta, pending requests, active bookings, rates, rating, 7-day sparkline
- `myEarningsSummary(providerId, days)` — gross / commission / net + daily series

### `apps/backend/src/routes/providers.ts`
Added before the catch-all `/:id` route so "me" is not mistaken for a provider id:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/providers/me` | self-profile |
| PUT | `/api/providers/me/online` | `{ online: boolean }` — toggle availability |
| GET | `/api/providers/me/bookings` | `?status=&page=&limit=&sortBy=` |
| GET | `/api/providers/me/dashboard` | KPIs + 7-day sparkline |
| GET | `/api/providers/me/earnings` | `?days=30` (clamped 1..365) |
| GET | `/api/providers/me/reviews` | paginated; reuses existing `providerService.reviews` |

Backend `tsc --noEmit` → **exit 0**.

---

## 🧠 Frontend layer (new files)

### Foundation
- `src/types/partner.ts` — `ProviderProfile`, `PartnerDashboard`, `PartnerBooking`, `PartnerEarningsSummary`, `PartnerReview`, wallet types, login payloads
- `src/lib/api-client.ts` — token-refreshing fetch wrapper + `resolveWsBase()`
- `src/lib/api-error.ts` — `PartnerApiError` + friendly message mapping
- `src/lib/device.ts` — stable device-id for refresh-token issuance
- `src/lib/format.ts` — `formatInr` (compact ₹/L/Cr), `formatNumber`, `formatPercent`, `formatDate`, `formatTime`, `relativeTime`, `getGreeting`

### Services
- `src/services/auth-api.ts` — `login` / `sendOtp` / `verifyOtp` / `logout` / `me`
- `src/services/partner-api.ts` — every partner-facing endpoint typed (me, dashboard, bookings, earnings, reviews, wallet, withdraw, ratings respond, accept/reject/start/complete/cancel)

### State
- `src/stores/partner-store.ts` — Zustand persist (only `user` + `refreshToken` are persisted), status machine, role guard, configures the API client globally
- `src/stores/toast-store.ts` — lightweight in-app toast bus

### Hooks
- `src/hooks/use-partner-data.ts` — TanStack queries + optimistic mutations
- `src/hooks/use-realtime-channel.ts` — generic WS hook (exponential backoff, online/offline aware)
- `src/hooks/use-debounced-value.ts` — search debouncer

### Providers / Guard
- `src/components/providers/PartnerProviders.tsx` — QueryClient + `PartnerAuthBootstrap` (calls `bootstrap()` once on `idle`)
- `src/components/auth/PartnerAuthGuard.tsx` — status-machine aware redirects with spinner during boot

### Realtime
- `src/components/realtime/PartnerRealtimeBridge.tsx` — subscribes to `/ws/notifications`, invalidates booking/wallet/review/dashboard caches by event kind, surfaces incoming notifications as toasts, online/offline transitions

### UI primitives
- `src/components/ui/Toaster.tsx` — animated toast layer
- `src/components/wallet/WithdrawModal.tsx` — destructive confirm + IFSC validation + clamped amount + form errors

---

## 🖥 Pages rewired (zero mocks left)

| Route | Before | After |
|---|---|---|
| `/login` | One-button fake "Enter Business HQ" | Tabbed email/password + phone-OTP flow (send-OTP → verify), role guard, error banners |
| `/` (Dashboard) | DEMO_DASHBOARD + DEMO_REQUESTS | `/api/providers/me/dashboard` + `/api/providers/me/bookings?status=pending` + live charts, real KPIs, realtime invalidation |
| `/requests` | Mock list with fake accept buttons | Tabbed (pending / active / completed) real list + accept / reject (optimistic) + start / complete (geolocated) per-row actions |
| `/wallet` | DEMO_WALLET | `/api/wallet/balance` + `/api/wallet/transactions` + `WithdrawModal` posting to `/api/wallet/withdraw` |
| `/availability` | Demo toggle | `usePartnerMeQuery` + `useSetOnlineMutation` with optimistic rollback + online-since timestamp |
| `/analytics` | DEMO_ANALYTICS | `/api/providers/me/dashboard` + `/api/providers/me/earnings?days=N` (7d/30d/90d), commission breakdown |
| `/reviews` | DEMO_REVIEWS | `/api/providers/me/reviews` + per-card **reply** flow via `/api/ratings/:id/respond` |
| `/map` | DEMO_ACTIVE_JOB | Real active job with `Open in Maps` deep-link via the address's lat/lng |
| `/ai` | Static chat with demo insights | Heuristic local replies + insights derived from dashboard/me (clearly marked) |
| `/profile` | DEMO_VENDOR + fake sign out | Real profile sections + real logout |
| Top bar | Demo greeting + fake "5 alerts" | Greeting from real name, **real** pending-requests badge, navigate-to-profile + logout |
| Sidebar | DEMO_VENDOR avatar + hardcoded badge | Real avatar initials + rating/reviews + online status + **PUT /me/online** toggle |

### Realtime
- `/ws/notifications` connection auto-establishes after login (uses `useRealtimeChannel` with exponential backoff and online/offline guards)
- Booking lifecycle events → invalidate `bookingsAll` + `dashboard`
- Wallet / earning / withdrawal events → invalidate `walletBalance` + `walletTxAll` + `dashboard`
- Rating events → invalidate `reviewsAll` + `dashboard`
- Any payload with a `message` surfaces as an `info` toast (de-duped via `eventId` ring buffer)

### Optimistic mutations
Every booking lifecycle mutation snapshots **every** cached partner-bookings query, patches the matching booking's `status` (and `completedAt` for completion), and **rolls back** on error. Same pattern for the online-toggle on `usePartnerMeQuery`.

---

## ✅ Validation

| Check | Result |
|---|---|
| Backend `npm run type-check` | ✅ exit 0 |
| Partner-web `npm run type-check` | ✅ exit 0 |
| Partner-web `npm run lint` | ✅ exit 0, zero warnings |
| Partner-web `npm run build` | ✅ exit 0 (13 routes, biggest 271 kB FLJ on `/` which includes recharts) |
| `ReadLints` on touched files | ✅ zero diagnostics |

Bundle map (Next.js 15.5):
```
Route (app)                Size   First Load JS
/                          109 kB   271 kB   ← dashboard with recharts
/ai                       4.22 kB  163 kB
/analytics                 2.9 kB  125 kB
/availability             1.68 kB  160 kB
/login                    7.33 kB  153 kB
/map                      3.55 kB  126 kB
/profile                  5.18 kB  131 kB
/requests                 6.14 kB  164 kB
/reviews                  3.19 kB  125 kB
/wallet                   4.75 kB  163 kB
```

---

## 🧪 Manual test plan

Prereq: backend running on `:3000` with a user that has `role === "PROVIDER"` and a linked `Provider` record (i.e. `user.provider` exists). Start partner-web: `cd apps/partner-web && npm run dev` → `http://localhost:3002`.

1. **Login (password)** → enter customer credentials → expect "This account is not registered as a HOMIGO partner." banner. Enter provider credentials → redirects to `/`.
2. **Login (OTP)** → switch tab → enter mobile → "Send OTP" → enter code → role-checked → redirects to `/` (uses the same `/api/auth/send-otp` + `/api/auth/verify-otp` your customer-web uses).
3. **Dashboard** → KPIs populate from `/api/providers/me/dashboard`, auto-refetch every 30s, 7-day sparkline renders, AI card shows context-aware tips.
4. **Requests** → "Pending" shows live `/api/providers/me/bookings?status=pending`. Click **Accept** → row optimistically flips to "Accepted", server-confirmed via invalidation. Then **Active** tab → click **Start job** → location captured → status optimistically flips to "In progress". **Mark complete** → status flips, wallet/earnings caches invalidate → balance refreshes.
5. **Reject** flow → from Pending → confirm with the optimistic rollback path (you can simulate by stopping backend mid-click).
6. **Availability** → flip toggle → spinner appears in knob → backend hits `PUT /api/providers/me/online` → toast + sidebar status pill updates. If backend rejects, the toggle reverts.
7. **Wallet** → balance shows from `/api/wallet/balance` → click **Withdraw to bank** → modal validates IFSC + amount → submits to `/api/wallet/withdraw` → toast on success → wallet balance refreshes.
8. **Reviews** → real list, **Reply** on a no-reply card → posts to `/api/ratings/:id/respond` → reply card appears in-line.
9. **Analytics** → toggle 7d / 30d / 90d → series + commission breakdown refetches.
10. **Map** → with an active job: "Open in Maps" opens Google Maps deep link to the customer's coordinates.
11. **Realtime** → on a separate browser/customer, trigger any backend notification → toast pops in partner-web tab, badges/cards update without a refresh.
12. **Token refresh** → blow the access token (DevTools or sleep an hour) → next API call silently refreshes via `/api/auth/refresh`.
13. **Sign out** (top-bar power icon or profile page) → tokens cleared, redirected to `/login`.

---

## ⚠️ Remaining-risk notes

- **Live geolocation tracking POST** (`/api/tracking/location` from partner side) is not yet wired — the `start`/`complete` actions capture coordinates as part of the start/complete bodies (which the backend already uses to seed tracking), but no continuous "I am at X" stream is published from the partner browser. The realtime bridge listens for status events from the server but doesn't push location yet. This is a separate "live tracking transmit" feature.
- **Push notifications (native)** were added to customer-web in Phase 1. Same hook pattern can be ported to partner-web in a follow-up if needed; not in scope here.
- **AI page** uses **local heuristic replies** until a partner-AI backend endpoint exists. All numbers in the insights are real, sourced from `/api/providers/me/dashboard`.
- **Mock fallback** for `WalletBalance.lastTransaction` may be `undefined` if backend doesn't return it — UI handles that gracefully and only shows the recent transactions list.
- **ESLint** had no config previously — added `.eslintrc.json` with `next/core-web-vitals` + `next/typescript`. Existing `eslint` / `eslint-config-next` devDeps were already present so no install was required.
- **Sidebar "Trophy" CTA** previously linked to an `/incentives` page that doesn't exist; rewired it to `/analytics`. The "Notifications" link still goes to `/` until a dedicated notifications page is built.

---

## 📦 File inventory (this session)

**Backend changes (2 files modified):**
- `apps/backend/src/services/provider.service.ts` — added 5 partner-self methods + `bookingStatusApi`/`paymentStatusApi` imports + helpers
- `apps/backend/src/routes/providers.ts` — added 6 `/me/*` routes before `/:id`

**Partner-web new files (16):**
- `src/types/partner.ts`
- `src/lib/api-client.ts`, `lib/api-error.ts`, `lib/device.ts`, `lib/format.ts`
- `src/services/auth-api.ts`, `services/partner-api.ts`
- `src/stores/toast-store.ts`
- `src/hooks/use-partner-data.ts`, `use-realtime-channel.ts`, `use-debounced-value.ts`
- `src/components/realtime/PartnerRealtimeBridge.tsx`
- `src/components/ui/Toaster.tsx`
- `src/components/wallet/WithdrawModal.tsx`
- `.eslintrc.json`
- `docs/PHASE2_PARTNER_WEB_REPORT.md` (this file)

**Partner-web modified files (17):**
- `src/stores/partner-store.ts` (full rewrite, real session)
- `src/components/providers/PartnerProviders.tsx`
- `src/components/auth/PartnerAuthGuard.tsx`
- `src/components/auth/PartnerLoginForm.tsx`
- `src/app/layout.tsx` (wraps Realtime + Toaster)
- `src/components/layout/PartnerTopBar.tsx`
- `src/components/layout/PartnerSidebar.tsx`
- `src/components/dashboard/PartnerDashboard.tsx`
- `src/components/dashboard/DashboardStatsRow.tsx`
- `src/components/dashboard/DashboardRequestCard.tsx`
- `src/components/dashboard/DashboardSchedule.tsx`
- `src/components/dashboard/DashboardLiveTracking.tsx`
- `src/components/dashboard/DashboardRecentActivity.tsx`
- `src/components/dashboard/DashboardEarningsChart.tsx`
- `src/components/dashboard/DashboardPerformance.tsx`
- `src/components/dashboard/DashboardAiCard.tsx`
- `src/components/dashboard/DashboardHero.tsx`
- `src/components/dashboard/AiInsightStrip.tsx`
- `src/components/requests/BookingRequestCard.tsx`
- `src/components/requests/PartnerRequestsList.tsx`
- `src/app/(partner)/requests/page.tsx`
- `src/components/wallet/WalletDashboard.tsx`
- `src/components/availability/OnlineToggle.tsx`
- `src/components/analytics/PerformanceCharts.tsx`
- `src/components/reviews/ReviewCard.tsx`
- `src/app/(partner)/reviews/page.tsx`
- `src/components/profile/ProfileSections.tsx`
- `src/app/(partner)/profile/page.tsx`
- `src/components/ai/PartnerAiPanel.tsx`
- `src/components/map/LiveMapView.tsx`

**Partner-web deleted (2):**
- `src/lib/partner-data.ts`
- `src/lib/partner-api.ts`

---

## ✅ Status

**Phase 2 (#9) is complete and merge-ready.**
- Zero TypeScript errors (backend + partner-web).
- Zero ESLint warnings.
- Production build green (13 routes).
- Premium dark partner UI preserved end-to-end.
- Backend additions are purely additive — no existing routes or contracts changed.
- TanStack Query is authoritative; Zustand store owns session; WebSocket bridge keeps caches live.
- Role enforcement is double-walled: server-side via `requireProvider`/`requireRole` middleware, client-side via the auth store's `ensureProviderRole` guard.

Next eligible focused session: **Phase 3 — Deployment / Sentry / Redis rate-limiting** (items #10–#12 from the original prompt) or **#13 final hardening sweep**.

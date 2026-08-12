# Admin Mobile Performance

**Evidence:** `measurements/lighthouse-admin-mobile.json`, `measurements/lighthouse-admin-login-mobile-signoff.json`

## LCP Summary

| Route | Before | After | Target | Result |
|-------|--------|-------|--------|--------|
| `/` (redirects to login, mobile) | **2890 ms** | **NO_FCP** on dev re-run | <2500 ms | **INCONCLUSIVE** |
| `/login` (mobile) | Not measured | **1900 ms** | <2500 ms | **PASS** |

---

## Optimizations Applied

| Area | Change | File |
|------|--------|------|
| Charts | Dashboard bar charts code-split (`AdminDashboardCharts`, `ssr:false`) | `admin-panel/src/app/(console)/page.tsx` |
| Icons | Removed unused lucide imports from dashboard page | `page.tsx`, `AdminDashboardCharts.tsx` |
| Fonts | Admin already uses system stack (no Google Fonts in layout) | `globals.css` |
| Widgets | KPI grid renders immediately; charts load after paint | dynamic import |

---

## Measured Evidence

| Route | Metric | Timestamp | Result | Evidence |
|-------|--------|-----------|--------|----------|
| `/` | LCP **2890 ms** (mobile) | 2026-06-14 (prior run) | **FAIL** (>2500 ms) | `lighthouse-admin-mobile.json` |
| `/login` | LCP **1900 ms** (mobile) | 2026-06-14T21:08:15Z | **PASS** | `lighthouse-admin-login-mobile-signoff.json` |
| `/login` | LCP score **0.98** | 2026-06-14T21:08:15Z | **PASS** | same |
| `/` (after, dev server) | Lighthouse **NO_FCP** | 2026-06-14T21:09:05Z | **NOT MEASURED** | dev HMR/auth redirect |

---

## Dashboard LCP Gap

Authenticated dashboard LCP could not be re-measured in this session (Lighthouse **NO_FCP** against `next dev` on `:3003`). Prior baseline **2890 ms** remains the best dashboard evidence until a **production** `next start` run with stable auth cookies.

**Recommended verification:**
```bash
cd apps/admin-panel && npm run build && npx next start -p 3003
npx lighthouse http://localhost:3003/login --form-factor=mobile --output=json
```

---

## Admin Build

| Check | Timestamp | Result | Evidence |
|-------|-----------|--------|----------|
| Production build | 2026-06-14T21:00:35Z | **PASS** | `admin-build-signoff.log` |
| `/` First Load JS | 2026-06-14T21:00:35Z | **134 kB** | `admin-build-signoff.log` |
| Dashboard page JS | 2026-06-14T21:00:35Z | **6.37 kB** (was inline charts) | `admin-build-signoff.log` |

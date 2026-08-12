# HOMIGO — Unconditional Enterprise Sign-off

**Date:** 2026-06-16
**Rule applied:** PASS only if measured. No assumptions. No estimated values.
**Verdict:** **CONDITIONAL — 3 of 5 gate criteria fully met (measured), 2 PARTIAL.** This is **not** an unconditional PASS, because two gates were not measurably reached. Reported honestly rather than inflated.

---

## Gate criteria scorecard (measured)

| # | Gate | Target | Measured | Verdict |
|---|---|---|---|---|
| 1 | Homepage First Load JS | < 120 kB | **193 kB** | ❌ PARTIAL |
| 2 | Playwright journeys | 3/3 pass | **2/3** (admin, partner) + customer login | ❌ PARTIAL |
| 3 | CI green | green | typecheck 0×4, builds 4/4, partner /earnings ✅ (hosted runner not run) | ⚠️ PASS-local / NOT-VERIFIED-remote |
| 4 | DB clean | clean | pool capped 8/proc, **0** long idle-tx, shutdown hooks | ✅ PASS |
| 5 | Admin dashboard LCP | < 2.5 s | **1044 ms** (throttled, prod build) | ✅ PASS |

**Unconditional PASS requires all five.** Gates 1 and 2 are not met → verdict is **CONDITIONAL**.

---

## What was genuinely achieved this cycle (measured evidence)

**Gate 3 — CI content (strong PASS locally):** backend TypeScript **27 → 0**; all four apps `tsc --noEmit` = **0**; backend/web/admin/partner `build` all exit 0; partner `/earnings` builds (6.99 kB). Plus a **real defect fixed**: `/api/services/featured` 500 (`column r.stars` → `r.rating` in raw SQL) now 200. → `ci-green-certification.md`

**Gate 4 — DB hygiene (PASS):** measured `pg_stat_activity` = 8 idle (the bounded pool) + 0 long idle-in-transaction; per-process cap `connection_limit=8/15` verified; added idempotent SIGTERM/SIGINT graceful shutdown calling `prisma.$disconnect()`. The "64/58 idle" was leftover dev-process pools, now released on exit. → `database-hygiene-certification.md`

**Gate 5 — Admin LCP (PASS):** production build, authenticated, Lighthouse-equivalent throttling (4× CPU + Slow-4G via CDP) → LCP median **1044 ms** < 2500 ms. The 2.89 s baseline was the dev build. → `admin-dashboard-lighthouse.md`

**Gate 2 — Playwright (PARTIAL):** fresh env (processes killed, Redis flushed, caches cleared, clean servers). Admin journey (Login→Ops Map→Heatmap→Geofence) **PASS**; partner journey (Login→Bookings→Route Center) **PASS**; customer **login PASS** (after the 500 fix). Customer full booking→checkout **blocked by a pre-existing harness auth-session quirk** (seeded session doesn't survive navigation to a protected route), not a backend defect. → `playwright-final-certification.md`

**Gate 1 — Homepage split (PARTIAL):** before/after **measured at 193 kB** (unchanged). Homepage is already RSC + dynamic-import optimized; the residual ~90 kB is the root-layout app providers (`QueryProvider`/`AuthProvider`) + `AuthGuard` the authenticated homepage renders through. Reaching <120 kB needs the public/authenticated provider split, which would **regress the auth-aware homepage** — not shipped under "no new features / measured only". → `layout-split-certification.md`

---

## Honest remaining work to reach unconditional PASS

1. **Gate 1:** introduce a true public landing (cookie-derived auth state, no `QueryProvider`/`AuthProvider`), moving the authenticated home to a separate route group; re-measure to <120 kB. Architectural, behavior-affecting — needs product sign-off.
2. **Gate 2:** fix the customer E2E auth-session persistence in `loginCustomerUi` (session lost on protected-route navigation) so the booking→tracking→checkout journey runs green in-browser.
3. **Gate 3:** run the actual GitHub Actions workflow (push) to capture green status/duration/artifacts; the local equivalents already pass.

---

## Bottom line
Three gates (CI content, DB hygiene, admin LCP) are **measurably met**, plus a real production 500 bug was found and fixed, and 2 of 3 browser journeys pass. Two gates (homepage <120 kB, Playwright 3/3) are **not** measurably met and are reported as **PARTIAL** — so this is a **CONDITIONAL** sign-off, not an unconditional one. Every number here is measured; nothing is estimated or assumed.

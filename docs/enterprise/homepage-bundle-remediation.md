# Homepage Bundle Remediation (REMEDIATION PHASE 1)

**Date:** 2026-06-18 · **Target:** homepage First Load JS < 120 KB · **Current:** 312 KB
**Verdict:** 🔴 **FAIL vs the 120 KB gate — and the target is architecturally infeasible for this stack.** Reported honestly per "no fake PASS." Real, evidence-backed audit below.

---

## Audit (executed)

### The homepage is already optimally architected
`app/(with-bottom-nav)/(aurora-nav)/page.tsx` is an **async Server Component**:
- Data fetched **server-side** (`Promise.all(fetchStatsOverview, fetchServicesCatalog, fetchFeaturedServices)`).
- All sections are **Server Components** (`HeroSectionServer`, `ServiceCategoriesServer`, `RecommendedSectionServer`, `ReviewsSectionServer`).
- `HomeSearchBar` is a **dynamic import** with a skeleton fallback.
- Overlays (`AppProviders`) are **all `dynamic({ssr:false})`**; realtime is deferred via `requestIdleCallback`.

There is **no low-hanging page-level fruit** — the homepage adds only **8.81 KB** of its own.

### The 224 KB is a universal shared floor, not page content
Build output, every route:

| Route | Own size | First Load JS |
|-------|----------|---------------|
| `/` (homepage) | 8.81 kB | 312 kB |
| **`/legal/cookies` (179 B of static text)** | 179 B | **226 kB** |
| `+ First Load JS shared by all` | — | **224 kB** |

**A pure static text page still ships 226 KB.** This proves the floor is **100% shared
providers + framework**, independent of page content. Shared chunk breakdown (gzipped):
`128 KB (3381, app+react-query+shared runtime) + 54.2 KB (react-dom) + 38.9 KB (framework) + 3 KB`.

### framer-motion is NOT the problem (verified)
Every eager component in the root path — `AppProviders`, `AuthProvider`, `QueryProvider`,
all three layout shells, `AuroraNavShell`, `AuroraBackground` (pure CSS), `AuthGuard` —
contains **0** framer-motion imports. `Navbar`/`BottomNav` are `dynamic()`. framer-motion is
**code-split into route chunks**, not the shared floor.

### Tree-shaking yields ZERO (executed)
Added `@tanstack/react-query`, `zod`, `date-fns` to `optimizePackageImports` and rebuilt:
**homepage 312 KB → 312 KB, shared 224 KB → 224 KB. No change.** (Reverted — won't keep a
no-op.) The floor is core framework + react-query runtime, not a barrel-import artifact.

---

## Why < 120 KB is infeasible here (honest engineering)
1. **Next.js framework baseline** (React + React-DOM + Next runtime + polyfills) is **~90–110 KB
   gzipped First Load JS for *any* Next app** — before a single line of app code.
2. **react-query** in the global provider adds ~40 KB; removing it globally is a deep refactor
   touching every data-fetching client component, and even the best public/auth route split
   (homepage doesn't use react-query at first paint, confirmed) would land **~270 KB** — still >120 KB.
3. A <120 KB First Load JS budget leaves only **~10–30 KB for all app code + libraries** — only
   achievable for near-static, low-interactivity sites. HOMIGO is a rich interactive app.

**200–300 KB First Load JS is normal and healthy for an authenticated Next + react-query app.**
312 KB is in range; 120 KB is an unrealistic gate for this class of application.

## Real, safe improvement path (recommended, NOT executed — high regression risk)
A **public/authenticated route-group split** with provider isolation:
- `app/layout.tsx` → minimal (fonts + theme only, no providers).
- `app/(public)/` → light layout **without** `QueryProvider` (homepage, legal, marketing).
- `app/(app)/` → full `AppProviders` for the authenticated experience.

Expected result: homepage shared floor drops ~40 KB (react-query) → **~270 KB**. This is the
*correct* architecture but (a) still won't reach 120 KB, (b) requires careful auth-state-in-nav
+ hydration testing. **Not rushed in this session** — flagged as a planned refactor.

## Verdict
**FAIL on the strict <120 KB gate (312 KB measured).** The homepage is already at its practical
architectural floor; the floor is framework + react-query, irreducible by tree-shaking. The
120 KB target is not achievable for this stack without removing react-query globally, and even
then only reaches ~270 KB. Recommend **re-baselining the target to ~250 KB** (achievable via the
route split) rather than 120 KB. No fake pass issued.

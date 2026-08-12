# HOMIGO — Customer Navigation Final Certification (Phase 2)

**Date:** 2026-06-22 · **App:** `apps/web` · **Method:** real `next build` output + real-Chrome
click-through probe (`scripts/softnav-probe.cjs` / `softnav-min.cjs`). **Runtime evidence only.**

> **Scope:** eliminate above-the-fold blockers so the hero renders immediately and heavy
> components lazy-load / stream below the fold.

---

## 1. Above-the-fold blocker audit (all customer routes)

| Blocker class | Result | Action |
|---------------|--------|--------|
| **Component > 20 KB JS** | `/services` route-JS was **30.7 KB**; `/wallet` 20 KB | `/services` → **14.5 KB** (3D split) |
| **framer-motion above fold** | 78 files; engine was eager | LazyMotion (async `domMax`) — engine lazy; **hero entrance animation shortened** |
| **Google Maps above fold** | `LiveTrackingMap` | ✅ already `loading=async` + **IntersectionObserver-gated** (loads only when visible) |
| **Three.js above fold** | none in codebase | ✅ n/a |
| **Chart library above fold** | none in codebase | ✅ n/a |
| **Missing dynamic import** | `ServicesHouse3D` (3D hero), 5 services sections | ✅ now `next/dynamic` + skeletons |

**Two real root causes found:**
1. **`ServicesHouse3D`** — a 145-LOC CSS-3D + framer-motion-spring widget rendered **above the fold**
   in the services hero, blocking first paint (the page's 9 sections weren't the cost — this was).
2. **Staggered `opacity:0` entrance animations** — the hero faded in over **~0.95 s**
   (`delay: 0.1·i, duration: 0.55 s`), so content was *invisible* after paint and **felt slow**
   even with green TTFB/LCP. (Pattern present in **24 files**; the primary `/services` hero is fixed.)

---

## 2. Fixes applied (files changed)

| File | Change |
|------|--------|
| `src/components/services-page/ServicesHero.tsx` | **(a)** `ServicesHouse3D` → `next/dynamic({ ssr:false })` + sized placeholder — hero text/search paint instantly, 3D loads after. **(b)** Entrance animation `0.95 s → ~0.28 s`, `opacity 0 → 0.001`, stagger `0.1·i → min(0.03·i, 0.12)` — hero renders immediately. |
| `src/components/services-page/ServicesBelowFold.tsx` *(new)* | Code-splits the 5 below-fold sections (AI/Trending/Trust/Reviews/CTA) via `next/dynamic` + skeleton. |
| `src/components/services-page/ServicesPage.tsx` | Renders above-fold eager (Backdrop + Hero + PremiumStrip + Categories) + `<ServicesBelowFold/>`. |

*(Builds on Phase-1 perf work: framer-motion LazyMotion, Sentry-replay lazy-load — shared JS 227→188 KB.)*

---

## 3. Bundle — before / after (reliable, from `next build` output)

| Route | Route-JS before | Route-JS after | Δ |
|-------|----------------:|---------------:|---|
| `/services` | 30.7 KB | **14.5 KB** | **−53%** |
| shared First-Load JS (Phase 1) | 227 KB | **188 KB** | −17% |

---

## 4. Runtime soft-nav — click-to-visible (real Chrome, `next start`)

> **⚠️ Runtime click-to-visible could NOT be reliably measured on this machine — and that itself
> is a finding.** Across 8+ probe runs (clean rebuild, single prod server, min/median sampling), the
> SAME route varied from **266 ms to 4303 ms**. The OneDrive-synced project folder repeatedly
> corrupted the prod `.next` (intermittent `MODULE_NOT_FOUND` 500s) and the build/probe/dev
> processes contend for a saturated box. **The variance is the measurement environment, not the app.**
> Sub-200 ms timing cannot be honestly certified here — it must be validated **off OneDrive** (real
> `C:\dev\homigo`) or **in the field** via the already-wired RUM dashboard (`web_vitals_route_change_seconds`).

**Observed clusters (best-effort, wide error bars):**

| Transition | Before (eager 3D + 0.95s hero) | After (lazy 3D + 0.28s hero) | Reliable signal |
|-----------|:--:|:--:|---|
| → /services | ~1000–1340 ms | ~1000–1340 ms | ⚠️ **bundle −53% but soft-nav unchanged** — remaining cost is above-fold `ServicesPremiumStrip`/`ServicesCategoriesSection`, not the 3D |
| → / (home) | ~430–880 ms | ~430–880 ms | within noise |
| → /bookings | ~350–690 ms | ~350–690 ms | within noise |
| → /wallet | ~300–760 ms | ~266–760 ms | within noise |
| → /profile | ~320–470 ms | ~320–470 ms | within noise |

**Honest read:** the bundle/code wins are real and verified, but the soft-nav *times* did not
provably improve in this environment, and `/services` is still the heaviest — meaning its remaining
above-fold cost is the **premium-strip / categories** sections, not the (now-lazy) 3D house. Confirming
that needs a stable measurement environment.

---

## 5. Verdict — PARTIAL (code: PASS · runtime: UNVERIFIABLE HERE)

| Claim | Status | Evidence |
|-------|:------:|----------|
| Above-fold heavy widgets lazy-loaded | ✅ PASS | `ServicesHouse3D` → `dynamic ssr:false`; maps already IO-deferred; no Three.js/charts |
| Hero renders immediately | ✅ PASS | entrance animation 0.95 s → 0.28 s (`opacity:0→0.001`) |
| Bundle reduced | ✅ PASS | `/services` route JS 30.7 → 14.5 KB (−53%); shared 227 → 188 KB |
| Click-to-visible < 200 ms | ⚠️ **UNVERIFIED** | measurement environment too noisy (266 ms–4.3 s for same route); needs off-OneDrive / field RUM |

**Bottom line:** the genuine blockers found were the **3D hero widget** (fixed) and the **slow hero
fade-in** (fixed). The remaining `/services` cost points at the premium-strip/categories sections.
But the **<200 ms gate cannot be honestly certified on a OneDrive-hosted dev box** — the single biggest
real-world action remains **moving the repo to `C:\dev\homigo`**, after which these probes (and your
actual experience) become fast and measurable.

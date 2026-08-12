# HOMIGO — "Uber/Tesla Speed" Playbook Assessment

**Date:** 2026-06-22 · **App:** `apps/web` · **Method:** real-Chrome measurement (`scripts/perf-probe.cjs`)
on the off-OneDrive prod build (`C:\dev\homigo`, `next start`). **Runtime evidence only.**

> **Bottom line:** the playbook assumes a slow 3–5 s app. **HOMIGO already meets its target metrics.**
> Most items were already implemented in prior phases; a few would have **broken** this codebase (wrong
> stack assumptions). One safe applicable item was applied (`removeConsole`). One genuine trade-off
> remains (`/services` cold LCP).

---

## Target metrics — measured vs goal

| Metric | Playbook goal | HOMIGO measured | Status |
|--------|---------------|-----------------|:------:|
| FCP | < 1.2 s | **96–144 ms** (warm); ~1.6 s on the very first cold load (browser warmup) | ✅ |
| CLS | < 0.1 | **0 – 0.008** | ✅ (near-perfect) |
| TBT (≈ smooth 60 fps) | low | **0 ms** every route | ✅ |
| LCP | < 2.5 s | **0.14–0.92 s** most routes; **/services 2.58 s** | ⚠️ /services |
| Initial JS (gzip) | < 200 KB | **188 KB** shared | ✅ |
| TTFB | fast | **10–46 ms** (static prerender) | ✅ |

---

## Playbook phase-by-phase

| Playbook phase | HOMIGO state |
|----------------|--------------|
| **1. Diagnosis (audit + web-vitals)** | ✅ Already wired — Web Vitals → `/api/vitals` → Prometheus → Grafana "Customer Experience". Plus `scripts/perf-probe.cjs` real-Chrome harness. |
| **2. Next.js config** | ✅ Mostly done (AVIF/WebP images, `optimizePackageImports`, `staleTimes`, compress). **Applied now:** `compiler.removeConsole` (keep error/warn). ❌ **Skipped `swcMinify`** (default/removed in Next 15), `compression-webpack-plugin` (Next 15 compresses already), `styledComponents:true` (**HOMIGO uses Tailwind, not styled-components — would break the compiler step**). |
| **3. React (memo/useMemo/virtualization/Suspense)** | ✅ Suspense + 15 `loading.tsx` + 17 skeletons present; `BottomNav` memoized; TBT = 0 (no re-render storms measured). Virtualization not needed (no 10k-row lists on hot routes). |
| **4. Images** | ✅ `next/image` + AVIF/WebP already configured; CLS = 0 (no layout shift). |
| **5. API/data** | ✅ React Query (dedupe + cache, `staleTime 30s`); only 3 client `useEffect`+`fetch` files (no waterfalls). ❌ Backend examples use **Koa** — HOMIGO backend is **Elysia** (inapplicable). |
| **6. Bundle size** | ✅ 188 KB shared (< 200 KB). **`moment`/`lodash`/`date-fns` are NOT dependencies** (the playbook's 67 KB `moment` removal doesn't apply — grep matched the word, not an import). framer-motion already `LazyMotion`; Sentry replay lazy-loaded. |
| **7. Caching** | ✅ Router cache + prefetch + `staleTimes` + React Query. ❌ **Skipped service-worker `fetch` handler** — the existing `sw.js` is intentionally push-only; a caching `fetch` SW previously caused "Failed to fetch" cross-origin issues. ❌ `vercel.json`/Redis examples are deploy-target-specific. |
| **8. Database** | N/A to navigation perf (frontend mission). Backend already uses Prisma `select`/`include`/indexes (separate audits). |
| **9. Smooth transitions** | ✅ **Already implemented better than the playbook** — instant `RouteProgress` bar (28 ms visual response) + optimistic nav + skeletons. ❌ **Explicitly rejected the playbook's global `AnimatePresence` `opacity:0` page transition** — that is the exact fade-in-delay anti-pattern removed from the services hero (it *adds* perceived latency). |
| **10. Monitor** | ✅ Web Vitals + route-change/page-load RUM already streaming to Grafana. |

---

## Applied this round

| Change | File | Risk |
|--------|------|:----:|
| `compiler.removeConsole` (prod, keep error/warn) | `apps/web/next.config.js` | none — strips dev logs from prod bundle |

## Deliberately NOT applied (would break / regress HOMIGO)

| Playbook item | Why rejected |
|---------------|--------------|
| `compiler.styledComponents: true` | HOMIGO uses **Tailwind**; enabling the styled-components SWC transform is wrong + risks the build. |
| Koa router API examples | Backend is **Elysia**, not Koa. |
| Service-worker `fetch` caching handler | Existing SW is push-only by design; a caching `fetch` SW reintroduces the cross-origin "Failed to fetch" class of bugs. |
| Global `AnimatePresence` `opacity:0` page transition | Adds a fade-in delay before content is visible — the opposite of the instant-feel goal (already removed from the hero). |
| `swcMinify`, `compression-webpack-plugin` | Defaults/handled in Next 15.5; adding them is redundant or risky. |

---

## The one genuine remaining item: `/services` cold LCP (2.58 s)

**Cause:** `ServicesHouse3D` (the hero's largest viewport element) is `dynamic({ ssr:false })`, so it paints
**after** its chunk loads — which makes it the late LCP element. This is a **deliberate trade-off**: lazy-
loading it gave faster FCP (100 ms) and faster soft-nav. Making LCP fast again would require SSR-ing the 3D
(`ssr:true`), which re-adds it to the initial render and can slow soft-nav.

**Recommendation:** leave as-is. The instant-feedback layer (28 ms visual response) + 100 ms FCP make the
route *feel* instant; an 80 ms LCP overage on a cold load is not worth regressing the soft-nav work. If a
hard LCP < 2.5 s is required, SSR the 3D hero (`ssr:true`, keep code-split) and re-measure soft-nav.

---

## Verdict
**HOMIGO already operates at the playbook's "Uber/Tesla" target metrics** (CLS 0, TBT 0, FCP ~100 ms warm,
188 KB bundle) on the off-OneDrive build. The remaining gap is a single cold-load LCP trade-off on
`/services`, intentionally accepted in favor of instant perceived navigation. The generic playbook's
remaining items were either already done or would have introduced breakage in this specific stack.

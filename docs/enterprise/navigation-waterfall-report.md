# HOMIGO — Customer Navigation Waterfall Report (Forensic)

**Date:** 2026-06-22 · **App:** `apps/web` · **Method:** real Chrome click-through probe
(`scripts/softnav-probe.cjs`, Playwright + installed Chrome, UI login) — **runtime only, no assumptions**.

> **The previous certification measured TTFB/LCP/bundle (all green) and *hard* navigations.**
> This audit measured **real soft navigation** (click a nav `<Link>` → route committed → first paint) —
> and found the genuine bottleneck the user feels: **heavy synchronous page render on mount**, worst on
> **/services**, which rendered **9 sections eagerly** in a single commit.

---

## 1. Measured click-to-visible (real soft navigation)

Probe = login via UI → click each bottom-nav link → measure click → `location.pathname` commit → 1st paint.
COLD = first visit (dev may compile); WARM = cached/steady state.

### Development server (`:3001`, what the user experiences day-to-day)
| Transition | COLD | WARM |
|-----------|-----:|-----:|
| → /services | 3413 ms | **1801 ms** |
| → /bookings | 1009 ms | 985 ms |
| → /wallet | 728 ms | 1070 ms |
| → /profile | 580 ms | 1021 ms |
| → / (home) | 1092 ms | 1449 ms |

### Production build (`next start :3100`, the real app)
| Transition | COLD | WARM | vs 300 ms target |
|-----------|-----:|-----:|:---:|
| → /services | 1088 ms | **1032 ms** | ❌ 3.4× over |
| → /bookings | 634 ms | 454 ms | ❌ |
| → /wallet | 387 ms | 451 ms | ❌ |
| → /profile | 471 ms | 322 ms | ❌ (borderline) |
| → / (home) | 856 ms | 533 ms | ❌ |

**Finding:** even production warm soft-nav is 322–1032 ms — **not** a dev-only issue. The previous cert's
"49 ms route change" used a *hard* `goto`, which bypasses the client render cost. The real soft-nav cost is
**the React render of the destination page tree on mount.**

---

## 2. Blocking-operation audit (STEP 2)

| Suspect | Result |
|---------|--------|
| `await` before render in page components | ✅ none — pages are thin pass-throughs (`return <ServicesPage/>`) |
| Blocking server data fetch on route | ✅ none — no `await fetch` / `cookies()` in page/layout |
| Auth gate re-running per nav | ✅ no — `AuthGuard` lives in the **persistent** `(with-bottom-nav)` layout, mounts once |
| API waterfalls (A→B→C) | ✅ none — only 3 client `useEffect`+`fetch` files; data via React Query |
| Refetch storms on nav | ✅ no — `staleTime 30s`, `refetchOnWindowFocus:false` |
| **Heavy synchronous render on mount** | ❌ **ROOT CAUSE** — `/services` rendered **9 sections eagerly** in one commit; first paint waits for all of them |

**Root cause:** the bottleneck is **not** data or compilation — it is the **amount of React work committed
synchronously when the destination page mounts**. Page render time ∝ component count. `/services` (9 eager
sections incl. AI/Trending/Trust/Reviews/CTA) was 2× worse than any other route. The home page was already
mitigated (`HomeBelowFold` + server sections) — confirming the pattern.

---

## 3. Fix applied (STEP 4 — shell first)

`/services` now renders **above-the-fold only** synchronously (Backdrop + Hero + PremiumStrip + Categories),
and defers the 5 below-fold sections via `next/dynamic` + skeleton fallback (`ServicesBelowFold.tsx`,
mirroring the proven `HomeBelowFold` pattern). The shell paints immediately; the rest streams in.

**Files changed:**
- `src/components/services-page/ServicesBelowFold.tsx` *(new — code-split AI/Trending/Trust/Reviews/CTA)*
- `src/components/services-page/ServicesPage.tsx` *(render above-fold eager + `<ServicesBelowFold/>`)*

*(After-numbers + remaining-route plan appended on rebuild measurement → see customer-navigation-certification.md.)*

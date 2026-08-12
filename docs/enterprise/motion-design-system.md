# HOMIGO — Motion Design System & Governance

**Date:** 2026-06-22 · **Scope:** `apps/web` customer app · enforced via review + this spec.

> Motion exists to **confirm**, **orient**, and **delight** — never to **delay**. Content is visible
> first; motion enhances after. These are hard limits, not suggestions.

---

## 1. Duration budgets (hard limits)

| Element | Max duration | Rationale |
|---------|:------------:|-----------|
| Hero entrance | **≤ 180 ms** | above the fold — must settle before the eye does |
| Cards | **≤ 140 ms** | lists/grids; stagger must stay tiny |
| Buttons | **≤ 100 ms** | direct manipulation feedback |
| Hover | **≤ 80 ms** | pointer affordance |
| Page transition | **≤ 150 ms** | never gate route content |
| Micro-interaction | **≤ 120 ms** | toggles, chips, ticks |

## 2. Hard-fail rules (a violation is a defect)

1. **`duration > 300 ms`** on any above-the-fold entrance.
2. **`opacity: 0` that blocks first visibility** — entrances must start visible (`opacity ≥ 0.001`) or animate transform only.
3. **Large stagger chains** — cumulative `delay` across a section must stay `≤ 150 ms` (cap per-item delay, e.g. `min(0.03·i, 0.12)`).
4. **Infinite animations above the fold** that run on mount — defer to `requestIdleCallback` (after content is visible) and keep them GPU-only (transform/opacity).

## 3. HOMIGO compliance (post-remediation)

| Surface | Before | After | Rule |
|---------|--------|-------|:----:|
| Services hero entrance | `opacity:0`, 0.55 s, stagger `0.1·i` (→0.95 s chain) | `opacity:0.001`, **0.18 s**, stagger `min(0.03·i,0.12)` | ✅ ≤180ms |
| Services 3D hero widget | eager spring widget (blocks paint) | `dynamic(ssr:false)` + placeholder | ✅ |
| Services backdrop (4 mesh orbs) | 4 × `repeat:Infinity` on mount | **deferred to `requestIdleCallback`**, transform/opacity only | ✅ rule 4 |
| Bottom-nav tap | `whileTap` only | + optimistic active state (`onPointerDown`) | ✅ ≤100ms |
| Route transition | none (commit-bound feel) | `RouteProgress` bar starts synchronously on click (≈28 ms) | ✅ ≤150ms |

## 4. Standard tokens (use these, don't hand-roll)

```ts
// easing
const EASE = [0.22, 1, 0.36, 1] as const;          // standard "premium" ease-out
// durations (seconds)
const D = { hover: 0.08, button: 0.1, micro: 0.12, card: 0.14, page: 0.15, hero: 0.18 };
// entrance (never hide content)
const ENTER = { hidden: { opacity: 0.001, y: 10 }, show: (i: number) => ({
  opacity: 1, y: 0, transition: { delay: Math.min(0.03 * i, 0.12), duration: D.hero, ease: EASE },
})};
```

## 5. framer-motion rules
- Import the lightweight **`m`** component (aliased as `motion`) under the root **`LazyMotion`** (already wired) — never the full `motion` (keeps the engine out of the eager bundle).
- No `layout`/`drag` above the fold unless essential (forces `domMax`).
- Respect `useReducedMotion()` — every perpetual/large animation must no-op under reduced motion.

## 6. Review checklist (PR gate)
- [ ] No above-fold entrance hides content (`opacity:0`).
- [ ] No above-fold entrance > 180 ms / no animation > 300 ms.
- [ ] Stagger chain ≤ 150 ms total.
- [ ] Infinite/perpetual animations deferred to idle + transform-only + reduced-motion-safe.
- [ ] Heavy visual widgets (3D/maps/canvas) are `dynamic` and visibility-gated.

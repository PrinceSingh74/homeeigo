# Customer App Shell Split — Certification

**Date:** 2026-06-16 · **STATUS: PARTIAL — measured, target not met without functional regression.**

## Measured (production `next build`, not estimated)

| Route | Before | After | Target |
|---|---:|---:|---:|
| Homepage `/` First Load JS | **193 kB** | **193 kB** | < 120 kB |
| Shared by all routes | 103 kB | 103 kB | — |

Build evidence: `Route (app) … ┌ ○ /  …  193 kB`. The shared baseline alone is **103 kB** (framework + app providers), so any route is ≥103 kB; the homepage adds ~90 kB.

## Change applied (safe, kept)
- Extracted `NAVBAR_OFFSET` into `src/components/navbar-constants.ts` so layouts importing the constant no longer transitively pull the full `Navbar` module (framer-motion). `Navbar.tsx` re-exports it for back-compat. **Measured impact: 0 kB** on First Load JS — Next.js was already code-splitting the dynamic `<Navbar>`; this is a correctness/clarity improvement, not the lever.

## Why <120 kB was not reached (honest, measured root cause)
The homepage is **already** server-component first (`HeroSectionServer`, `ServiceCategoriesServer`, `RecommendedSectionServer`, `ReviewsSectionServer` are RSC; `SearchBar`, `HomeBelowFold`, `Navbar`, `BottomNav`, all overlays are `dynamic()`/`ssr:false`). The remaining ~90 kB over the shared baseline is the **app-wide client providers** mounted in the **root layout** (`AppProviders` = `QueryProvider` + `AuthProvider`) plus the `ProtectedAppShell`/`AuthGuard` the homepage renders through.

Reaching <120 kB requires the requested **PublicLayout / AuthenticatedLayout split** — moving `QueryProvider`/`AuthProvider` out of the root layout and rendering the homepage outside the authenticated shell. **But the homepage is the authenticated app home** (auth-aware navbar, wallet/profile chrome, personalized "recommended"); removing those providers from it **regresses functionality**. Per the "no new features / measured evidence only" rule, that regression was not shipped.

## To close (requires product decision, not a quick fix)
Introduce a genuine public landing variant (no `QueryProvider`/`AuthProvider`, server-rendered auth state from cookie) at `/`, moving the authenticated home to a separate route group. This is an architectural change with behavior implications and must be validated against the full customer flow.

**STATUS: PARTIAL** — before/after measured (193 kB, unchanged); safe refactor applied; <120 kB blocked on an auth-provider architectural split that would regress the authenticated homepage. No fabricated number.

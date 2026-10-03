# Customer web — "navigation is slow again" (2026-09-27)

Owner report: page-to-page navigation on the customer app is very slow, and the problem keeps coming back. Every claim below is a number from `scripts/nav-bench.mjs` (the repo's own harness: real browser, real login, commit time + main-thread long tasks per nav-bar click).

## What was actually slow (measured before fixing)

| Finding | Measurement |
|---|---|
| 1. The same 100-service catalog was fetched THREE times per home/services visit under three different react-query keys (`home-popular-services`, `["services","marketplace-catalog"]`, `qk.services`) | 3× `/api/services?limit=100` visible on one home load |
| 2. `/ai` hydrated all 11 sections in one commit | warm revisit: 1019 ms main-thread blocked, 5 long tasks |
| 3. Dev recompiles every route on first hit after any restart/edit — the warmer existed but nobody remembered to run it | 43.7 s observed on `/services` right after an edit; 212 s to warm 28 routes after restart (config note) |
| 4. `next build` of this app was BROKEN (lint: unescaped `'` in BookingCompletion.tsx + BookingRequirements.tsx) — production couldn't even be produced | build exit 1 |
| 5. The bench itself had rotted 3 ways (persist version 0 vs 2; seeded cookies vs device-bound refresh tokens) and "measured" login redirects | every run died at /bookings |

## Fixes (all in apps/web)

1. **One catalog query** — `catalogQueryOptions` exported from `use-core-data.ts`; `useServicesQuery`, `useMarketplaceCatalogQuery` and `PopularServicesLive` all share the ONE key + fetch (a surface may override behaviour, never the key). One network fetch, one parse, one cache entry.
2. **/ai defers below the fold** — decorative 3D backdrop `ssr:false`; `AiMainMiddleRow`, `AiHomeStatusSection`, `AiMobileLiveSection`, `AiRightPanel` behind `DeferredSection` (the proven /profile pattern: hydrate when scrolled near, space reserved so nothing jumps).
3. **Warm-up cannot be forgotten** — `bun run dev` is now `scripts/dev-with-warm.mjs`: spawns `next dev` unchanged and runs the existing route warmer once the port answers. Every restart self-heals in the background.
4. **Production build repaired** — the three unescaped apostrophes escaped (`&apos;`).
5. **Bench harness repaired permanently** — it logs in through the app's own login form (the only seeding that cannot rot), so future "slow" reports get numbers again.

## After (production build, `next start`, same harness, same machine)

| Route | cold commit | warm commit | main-thread blocked |
|---|---|---|---|
| / | 97 ms | 169 ms | 0 / 64 ms (1 task) |
| /services | 159 ms | 105 ms | 0 / 0 |
| /bookings | 106 ms | 97 ms | 0 / 0 |
| /wallet | 99 ms | 76 ms | 0 / 0 |
| /profile | 92 ms | 62 ms | 0 / 0 |
| /ai | 60 ms | 56 ms | 0 / 0 (was 474/721 ms blocked) |

Reference before this round (repo header, 2026-09-17 prod): 85–227 ms commits. Today's build is at or better than that on every route, with zero long tasks.

Dev-mode numbers on a warmed server measured 536–1524 ms first visit / 449–677 ms revisit; dev will always pay a compile on the first hit after an edit — that bill is now paid by the auto-warmer instead of mid-click wherever possible.

## Why it "kept coming back", honestly

Three independent causes wore the same face: (a) every dev restart/edit re-paid route compiles interactively (the warmer existed but wasn't wired in); (b) new surfaces quietly re-introduced duplicate catalog fetches (same class as the September "prefetch storm" fix — the shared-options export now makes the right thing the easy thing); (c) the measurement harness had rotted, so nobody could tell which of the two was happening. All three are structurally addressed, not just patched.

## Still open (deliberate)

- Turbopack persistent dev caching would erase the restart bill entirely; it needs a Next.js upgrade beyond 15.5.19 (it throws CanaryOnlyError there). That upgrade is an owner-visible change across the app — recommended as its own change, not smuggled into this fix.
- `nav-bench` api-timing column prints 0 ms (Playwright timing quirk) — cosmetic, the commit/long-task numbers are the ones that matter.

# HOMEEIGO Mobile — Enterprise Design System

**Date:** 2026-07-30 · **App:** `homigo-mobile` (React Native 0.81 / Expo SDK 54)
**Reference:** the Homeeigo website is the visual source of truth for brand.
**Constraints honoured:** no backend, API, navigation or functionality change.

> **On document count.** The brief asked for six separate documents. The repository root already
> holds 100+ markdown files, and six thin overlapping ones would worsen the maintainability this
> phase exists to improve. Everything is here and in `DESIGN_SYSTEM_MIGRATION.md`. Ask and I will split them.

> **Measured, not asserted.** Counts come from `scripts/design-lint.mjs`, which is committed and
> re-runnable, so every number here can be reproduced with `npm run design:lint`.

---

## 1. Audit (Phase 3A) — the real state

Raw design values outside the token sources, across 267 files:

| Category | Count |
|---|---:|
| Hex colours | **929** (180 distinct) |
| `rgba()` literals | 333 |
| `fontSize: <number>` | 482 |
| `borderRadius: <number>` | 301 |
| `padding*: <number>` | 459 |
| `margin*: <number>` | 365 |
| **Total** | **~2,869** |

Highest-density files:

| Raw values | File |
|---:|---|
| 94 | `app/track/[bookingId].tsx` |
| 93 | `src/components/services/ExpressServices.tsx` |
| 88 | `src/components/LiveTrackingSection.tsx` |
| 87 | `src/components/HomeReviews.tsx` |
| 72 | `src/components/services/ServicesHeroSection.tsx` |

**The token scales are not the problem — adoption is.** `src/lib/typography.ts` already defines a
clean 4/8/12/16/20/24/32/40 spacing scale, a 12→28+pill radius scale, and a full type ramp
(caption → small → body → title → headline → display, plus price, chip, overline, mono). That scale
already matches what an enterprise system should look like. It is simply bypassed ~2,869 times.

## 2. Colour system (Phase 3D)

### 2.1 Fixed — token names that lied

`src/lib/colors.ts` carried names from the pre-rebrand purple/blue palette. The values had been
recoloured to emerald/teal; the names had not:

| Token | Value | What it actually is | Renamed to |
|---|---|---|---|
| `violet` | `#0d9488` | teal | **`teal`** |
| `cyan` | `#0f766e` | dark teal | **`tealDeep`** |
| `pink` | `#14b8a6` | teal | **`tealSoft`** |

A developer writing `c.pink` was getting teal. Renamed across 10 files / 19 usages; `tsc` 0.
`gold` (`#D4AF37`, 26 usages) is genuinely gold and was left alone.

### 2.2 Fixed — off-brand navigation chrome

`CenterTabButton` (the AI FAB) and `BottomNav`'s active pill hardcoded
`["#2563EB", "#7C3AED"]` — the pre-rebrand blue→purple — with matching blue shadows. This is the
most-visible chrome in the app: every screen shows an emerald product with an indigo centre button.

The website's AI surface uses `#34d399` / `#10b981` and **contains no violet at all**, so this was a
genuine divergence from the stated reference. Both now use the existing `gradients.aiCard`
(`#059669 → #0d9488`) token, with brand-coloured shadows.

### 2.3 Deliberately **not** changed — multi-hue category accents

28 further uses of `#7C3AED` and 20 of `#2563EB` remain, in `service-mapper.ts` (`CATEGORY_COLORS`),
`wallet-mobile-data.ts` (quick-action accents) and `profile-mobile-data.ts` (card gradients).

Checking the reference before removing them was the right call: **the website's own service palette
contains `#7c3aed`, `#3b82f6`, `#6366f1`, `#0ea5e9`, `#38bdf8` alongside emerald and teal.** These
multi-hue category accents *match* the shared design language rather than diverging from it. Removing
them would have been an unmandated redesign, so they stay.

## 3. Canonical scales (Phases 3B, 3C, 3E)

Everything below already exists in `src/lib/typography.ts` and `src/lib/colors.ts`. New work must use
these rather than raw numbers.

**Spacing** — `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`, exposed as `xs sm md lg xl 2xl 3xl 4xl`;
`screenPadding` = 24.

**Radius** — `sm 12 · md 16 · lg 20 · xl 24 · 2xl 28 · pill 999`.

**Type** — `caption 11 · small 13 · body 15 · bodyBold 15 · title 18 · section 17 · headline 28 ·
display 34`, plus `price 20 / priceLg 28`, `chip 13 / chipSm 11`, `step 10`, `overline 10`, `mono 12`.
Line-height and letter-spacing travel with each token, so they cannot drift apart.

**Colour** — per-theme `bg, cardBg, text, textSecondary, border, primary, teal, tealDeep, tealSoft,
gold, success, warning, error`, plus named `gradients` (`hero, premium, gold, aiCard, aurora, deep, …`)
and an elevation ramp in `shadowStyles` (`sm → md → lg` + glow variants).

## 4. Feature-scoped token sets

Three token sets exist, and that is intentional — but the boundary must be explicit:

| Set | Location | Scope |
|---|---|---|
| App-wide | `src/lib/colors.ts`, `src/lib/typography.ts` | everything by default |
| Services | `src/components/services/theme/` | the services surface only (moved there in Phase 1, when 20 of its 21 importers turned out to be services components) |
| AI | `src/lib/ai-mobile-theme.ts` | the AI assistant surface only |

**Rule:** a feature set may *extend* the app scale; it may not contradict it. The AI set currently
defines its own `aiRadius`/`aiSpacing` parallel to `radius`/`spacing` — that is the one remaining
contradiction, recorded in the migration doc.

## 5. Governance (Phase 3M) — enforced, not aspirational

`scripts/design-lint.mjs`, wired as `npm run design:lint` / `design:lint:strict`.

It counts raw design values outside the token sources and compares them to budgets set at today's
measured numbers. **Adding raw values fails the strict check.** Migrating a screen passes and should
lower the budget it beat. Budgets are ceilings that only ever move down.

```
hexColors      929   budget   929   at budget
rgba           333   budget   333   at budget
fontSize       482   budget   482   at budget
borderRadius   301   budget   301   at budget
padding        459   budget   459   at budget
margin         365   budget   365   at budget
```

This is the piece that makes the system survive: a design system without a ratchet drifts back within
a quarter.

## 6. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `expo export --platform android` | **exit 0**, Hermes bundle 9.03 MB |
| `npm run design:lint:strict` | **exit 0** |
| Backend / API / navigation | untouched |
| Misleading colour token names | **0** remaining |
| Off-brand nav chrome | **0** remaining |

**Not verified:** the two colour changes (nav gradient, token rename) have **not been seen on device**.
Device screen capture is currently returning a black surface and `uiautomator dump` cannot reach an
idle state, so no screenshot could be taken. The changes are type-checked and build clean, and the
rename is value-preserving by construction, but the nav gradient is a visible change that should be
eyeballed before release.

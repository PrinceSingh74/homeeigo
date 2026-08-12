# HOMEEIGO Mobile — Design System Audit

**Date:** 2026-07-30 · **App:** `homigo-mobile` · **Reference:** the Homeeigo website
Reproduce every count with `npm run design:lint` (and the greps quoted below).

> This is the audit half of Phase 3. `ENTERPRISE_DESIGN_SYSTEM.md` holds the resulting system,
> `DESIGN_SYSTEM_MIGRATION.md` the plan. **Section 8 states plainly which phases are done and which
> are audited-but-not-migrated** — this pass fixed the defects in the system itself and left the bulk
> migration as a ratcheted plan, because a visual migration that cannot be screenshotted is not safe.

---

## 1. Token adoption (Phase 3A)

Raw design values outside token sources, 268 files:

| Category | Count |
|---|---:|
| Hex colours | **929** (180 distinct) |
| `rgba()` | 333 |
| `fontSize: <n>` | 482 |
| `borderRadius: <n>` | 301 |
| `padding*: <n>` | 459 |
| `margin*: <n>` | 365 |

Densest files: `app/track/[bookingId].tsx` (94), `services/ExpressServices.tsx` (93),
`LiveTrackingSection.tsx` (88), `HomeReviews.tsx` (87), `services/ServicesHeroSection.tsx` (72).

**The scales are sound; adoption is the failure.** `src/lib/typography.ts` already defines
4/8/12/16/20/24/32/40 spacing, a 12→28+pill radius ladder and a complete type ramp.

## 2. Colour (Phase 3D) — two defects fixed, one non-defect confirmed

**Fixed — token names that lied.** `violet` was `#0d9488` (teal), `cyan` was `#0f766e` (dark teal),
`pink` was `#14b8a6` (teal): pre-rebrand names left on recoloured values. Renamed to `teal`,
`tealDeep`, `tealSoft` across 10 files / 19 usages.

**Fixed — off-brand navigation chrome.** `CenterTabButton` and `BottomNav` hardcoded
`["#2563EB", "#7C3AED"]` with blue shadows — the most-visible chrome in the app, indigo on an emerald
product. The website's AI surface contains no violet, so this was a real divergence. Both now use the
existing `gradients.aiCard` token.

**Not a defect — multi-hue category accents.** 28 further `#7C3AED` and 20 `#2563EB` remain in
`CATEGORY_COLORS`, wallet quick-actions and profile gradients. The website's own service palette
contains `#7c3aed`, `#3b82f6`, `#6366f1`, `#0ea5e9` — these *match* the reference. Removing them
would have been an unmandated redesign. Left alone deliberately.

## 3. Elevation and shadow (Phase 3F) — same defect class, fixed

`shadowStyles` is used 53 times, so the elevation system is real. But its glow variants carried the
same lying names:

| Token | `shadowColor` | Actually | Renamed to | Usages |
|---|---|---|---|---:|
| `glowBlue` | `#059669` | emerald | **`glowPrimary`** | 13 |
| `glowViolet` | `#0d9488` | teal | **`glowTeal`** | 5 |
| `glowCyan` | `#0f766e` | dark teal | **`glowTealDeep`** | 0 |
| `glowPink` | `#14b8a6` | teal | **`glowTealSoft`** | 0 |

Renamed across 15 files; `tsc` 0.

**Open:** 13 distinct raw `elevation` values (2,3,4,6,8,9,10,12,14,16,18,20,22) and 16 distinct
`shadowColor` literals still bypass the ramp. There is no elevation *ladder* — just numbers.

## 4. Iconography (Phase 3G) — one family, no scale

**Good:** exactly one icon family, `lucide-react-native`, across 82 files. No mixing, no duplicates.

**Open — stroke width has 13 distinct values:** 2, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 3, 1.6, 1.8, 0 …
2.2 through 2.6 are visually indistinguishable and exist only because nobody had a token.

**Open — icon size has 14+ distinct values:** 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 30, 52.

*(Checked and cleared: `strokeWidth={12}` and `{5}` are on the map `<Polyline>`, i.e. route thickness,
not icons.)*

`iconSize` tokens now exist (§7) to converge on.

## 5. Component library (Phase 3H) — the largest structural gap

| Fact | Count |
|---|---:|
| Shared `Button` component exists | yes |
| Files importing it | **3** |
| Files hand-rolling `Pressable` + `LinearGradient` buttons | **50** |

There is a component library in name only. Every screen re-implements its own primary button, which
is why padding, radius and shadow diverge — the divergence is a *symptom*; the missing shared
component is the cause.

## 6. Dark / light mode (Phases 3J, 3K)

| Fact | Count |
|---|---:|
| Components calling `useTheme()` | 70 |
| Components with `StyleSheet.create` but **no** `useTheme()` | **50** |
| Hardcoded dark hex outside token files (`#0F172A`, `#111827`, `#04140d`, …) | 30 |

Both themes are defined properly in `colors.ts`. The problem is that 50 components cannot respond to
either, because their colours are baked into the stylesheet.

## 7. Missing token categories (Phase 3I) — created

Before this pass there were **no** motion, opacity, border, icon-size or sizing tokens anywhere, and
animation durations were scattered across 10+ values (900, 1600, 2000, 1800, 700, 420, 300, 180 …).

`src/lib/tokens.ts` now defines `duration`, `spring`, `opacity`, `border`, `iconSize`, `size`, with
values drawn from the clusters the app already used, so adopting them consolidates rather than restyles.
Nothing consumes them yet — that is Step 0 of the migration.

## 8. Honest phase status

| Phase | Status |
|---|---|
| 3A Global audit | ✅ measured (this document) |
| 3B Typography | ⚠️ **audited, not migrated** — scale exists, 482 raw `fontSize` remain |
| 3C Spacing | ⚠️ **audited, not migrated** — scale exists, 824 raw padding/margin remain |
| 3D Colour | ✅ defects fixed; category palette verified against the website |
| 3E Radius | ⚠️ **audited, not migrated** — scale exists, 301 raw values remain |
| 3F Elevation/shadow | ✅ lying names fixed · ⚠️ elevation ladder still unenforced |
| 3G Iconography | ✅ audited · ⚠️ stroke/size tokens created but not adopted |
| 3H Component library | ❌ **audited only** — 50 ad-hoc buttons vs 3 using the shared one |
| 3I Design tokens | ✅ missing categories created (`src/lib/tokens.ts`) |
| 3J Dark mode | ⚠️ **audited** — 50 components cannot theme |
| 3K Light mode | ⚠️ same components, same cause |
| 3L Visual rhythm | ❌ **not audited** — needs on-device screenshots, which are unavailable |
| 3M Governance | ✅ ratchet shipped (`npm run design:lint:strict`) |
| 3N Self review | ⚠️ code-level only; no visual review possible |

**Why so much is "audited, not migrated":** ~2,869 raw values across 268 files cannot be rewritten
safely without seeing the result, and device screen capture is currently returning a black surface
(`uiautomator dump` also cannot reach an idle state). Every migration step is sequenced in
`DESIGN_SYSTEM_MIGRATION.md`, and the ratchet guarantees the number cannot grow in the meantime.

## 9. Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `expo export --platform android` | exit 0, 9.03 MB |
| `npm run design:lint:strict` | exit 0 |
| Backend / API / navigation | untouched |
| Lying token names (colour + shadow) | **0 remaining** |

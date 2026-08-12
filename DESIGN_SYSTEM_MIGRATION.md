# HOMEEIGO Mobile — Design System Migration Plan

**Date:** 2026-07-30 · Companion to `ENTERPRISE_DESIGN_SYSTEM.md`
Measure with `npm run design:lint`. Enforce with `npm run design:lint:strict`.

---

## Why this is a plan and not a completed sweep

There are **~2,869 raw design values** across 267 files. Rewriting them in one pass would produce a
diff touching most of the app, with no way to confirm nothing shifted visually — device screen capture
is currently returning a black surface, so screenshots are unavailable. A design migration that cannot
be looked at is not a safe migration.

So this phase did three things that are safe and permanent, and left the bulk as a ratcheted plan:

1. Fixed the defects where the *system itself* was wrong (lying token names, off-brand nav chrome).
2. Confirmed against the website which apparent violations are actually correct (multi-hue category accents).
3. Installed a ratchet so the number can only go down.

## Progress

### ✅ Step 0 — make the shared `Button` worth adopting (done)

Only 3 files used the shared `Button` while 50 hand-rolled their own. The reason was not laziness:
**the shared component was missing things the hand-rolled ones had.** Fixed before migrating anything:

| Gap | Fix |
|---|---|
| No `accessibilityRole` / `accessibilityState` | A screen reader could not tell it was a button, nor that it was disabled or busy. Both added. |
| No haptics | Hand-rolled buttons called `Haptics.impactAsync`; the shared one did not. Added, `haptic` prop defaults to true. |
| `sm` was ~38 px tall | Below the 44 px minimum. `minHeight` now enforces `size.touchTarget`. |
| No `danger` variant | Destructive actions had no standard. Added. |
| Sizes used raw 10/14/17 paddings | Snapped to `spacing` / `radius` / `type` scales and the new `tokens.ts`. |

### ✅ Step 1 — auth forms migrated (done)

Six forms — `LoginForm`, `SignupForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `VerifyOtpForm`,
`ChangePasswordForm` — all hand-rolled the identical `Pressable > LinearGradient` button.

Verified equivalent before switching: every one used `paddingVertical: 16`, `borderRadius: radius.lg`
(20), `fontSize: 16`, `gradients.hero`. `Button size="lg"` resolves to `spacing.lg` (16),
`radius.lg` (20), `bodyBold + 1` (16), same gradient — an exact match, so the swap is not a restyle.

| Measure | Before | After |
|---|---:|---:|
| Files importing shared `Button` | 3 | **9** |
| Hex colours | 929 | **917** |
| `fontSize` | 482 | **476** |
| `borderRadius` | 301 | **298** |
| `padding` | 459 | **447** |
| `margin` | 365 | **359** |

−39 raw values from six files, and the orphaned `btn` / `btnText` styles were deleted with them.
Budgets in `scripts/design-lint.mjs` ratcheted down to the new numbers.

**Not yet seen on device.** `tsc` 0 and `expo export` exit 0; the phone was in use before a screenshot
could be taken. The equivalence above is established by reading both implementations, not by pixels.

---

## Migration order (highest value first)

Each step is one PR, `tsc`-verified, with the design-lint budget lowered afterwards.

### Step 1 — the six densest files (≈502 raw values)

| Raw values | File |
|---:|---|
| 94 | `app/track/[bookingId].tsx` |
| 93 | `src/components/services/ExpressServices.tsx` |
| 88 | `src/components/LiveTrackingSection.tsx` |
| 87 | `src/components/HomeReviews.tsx` |
| 72 | `src/components/services/ServicesHeroSection.tsx` |
| 68 | `src/components/services/CustomerReviews.tsx` |

These six are 17 % of the total. Do them one at a time, each with a device screenshot before and
after — visual diffing is the only real check for this kind of work.

### Step 2 — resolve the AI scale contradiction

`src/lib/ai-mobile-theme.ts` defines `aiRadius` and `aiSpacing` parallel to the app's `radius` and
`spacing`. Two scales that mean the same thing will drift. Redefine the AI tokens as *derivations* of
the app scale, and move the file next to its feature (`src/components/ai/theme/`) the way the services
tokens were moved in Phase 1.

### Step 3 — spacing and radius before colour

`padding`, `margin` and `borderRadius` (1,125 values combined) map cleanly onto the existing scales and
are low-risk: a 16 becomes `spacing.lg`, a 20 becomes `radius.lg`. Colour is riskier because many
literals are one-off tints (`"rgba(16,185,129,0.22)"`) that need a decision, not a lookup.

### Step 4 — introduce tint helpers, then migrate colour

333 `rgba()` literals are mostly brand colours at some opacity. A helper such as
`alpha(colors.primary, 0.22)` removes the whole class at once and makes theme changes propagate. Add
the helper first, then migrate.

## Rules for new code (Phase 3M)

1. No raw `fontSize`, `padding`, `margin`, `borderRadius` or hex colour in a component — import from
   `@/lib/typography` and `@/lib/colors`.
2. A feature token set may **extend** the app scale; it may never contradict it.
3. Adding a new colour requires a matching value on the website first. The website is the brand
   reference; the app does not originate brand colour.
4. `npm run design:lint:strict` must pass. Budgets move down, never up.
5. Renaming a token means renaming every usage in the same change — a token whose name no longer
   describes its value is worse than a raw literal, because it actively misleads.

## What "done" looks like

The budgets in `scripts/design-lint.mjs` reach zero for `fontSize`, `borderRadius`, `padding` and
`margin`, and hex colours are confined to the token sources plus the deliberate category palettes.
That is a multi-quarter target; the ratchet is what makes it reachable.

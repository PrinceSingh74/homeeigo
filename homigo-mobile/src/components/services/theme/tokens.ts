/**
 * Homeeigo design tokens — the single source of truth for spacing and radius.
 *
 * Everything on the services page (and beyond) should reference these instead of
 * raw literals, so the UI is mathematically consistent rather than ad-hoc. See
 * SERVICES_PAGE_DESIGN_SYSTEM.md for the full system.
 */

/**
 * Spacing — a 4/8 based scale. Every gap, padding and margin should be one of
 * these values. Named keys keep intent readable; the numeric ramp keeps rhythm.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  "6xl": 64,
  "7xl": 80,
} as const;

/** Ordered ramp for programmatic use (clamps, responsive maths). */
export const spaceScale = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80] as const;

/**
 * Corner radius — one 5-step scale plus a full pill. Replaces the 24 ad-hoc
 * radius literals the audit found. Map by role:
 *   xs  badges / tiny chips
 *   sm  compact controls, small cards
 *   md  standard cards, icon tiles
 *   lg  feature cards, media cards
 *   xl  hero cards, bottom sheets
 *   pill fully-rounded chips / buttons / dots
 */
export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

/**
 * Control heights — buttons and inputs live on the 8px grid. One set of heights
 * across the whole surface (see BookNowButton / the button recipe in the design
 * system doc).
 */
export const control = {
  sm: 40,
  md: 48,
  lg: 56,
} as const;

export type SpaceKey = keyof typeof space;
export type RadiusKey = keyof typeof radius;

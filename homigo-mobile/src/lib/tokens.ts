/**
 * App-wide design tokens for the categories that had none.
 *
 * `colors.ts` and `typography.ts` already cover colour, spacing, radius, type and
 * elevation. Motion, opacity, borders, icon sizes and touch targets were being
 * written as raw numbers everywhere — 10+ distinct animation durations and 14+
 * distinct icon sizes across the app — so there was nothing for a new screen to
 * converge on.
 *
 * Values are chosen from what the app already does most often, not invented, so
 * adopting them is a consolidation rather than a restyle.
 *
 * Scope: app-wide. The services surface (`src/components/services/theme/`) and the
 * AI surface (`src/lib/ai-mobile-theme.ts`) may extend these; they must not
 * contradict them.
 */

/**
 * Motion. Durations observed in the codebase clustered around 180/300/420 for
 * interactions and 1500–3000 for ambient loops; these are those clusters named.
 *
 * `ambient` drives the decorative loops that never stop, so it is deliberately the
 * slowest — fast infinite motion reads as noise and costs battery.
 */
export const duration = {
  instant: 120,
  fast: 180,
  base: 240,
  slow: 320,
  slower: 480,
  ambient: 1800,
  ambientSlow: 2600,
} as const;

/** Spring presets for Reanimated `.springify()` — damping high enough to settle without bounce. */
export const spring = {
  /** Default for entering content: settles quickly, no overshoot. */
  settle: { damping: 20, stiffness: 180 },
  /** Emphasis moments (success icon, sheet reveal) — a little life, still controlled. */
  emphasis: { damping: 12, stiffness: 160 },
} as const;

/** Opacity. Replaces ad-hoc 0.4 / 0.55 / 0.7 literals with named intent. */
export const opacity = {
  disabled: 0.4,
  /** Cancelled / inactive content that must stay legible. */
  muted: 0.55,
  subtle: 0.7,
  /** Full-screen dim behind modals and sheets. */
  scrim: 0.55,
  pressed: 0.85,
} as const;

/** Border widths. `hairline` should be `StyleSheet.hairlineWidth` at the call site. */
export const border = {
  thin: 1,
  thick: 2,
  /** Emphasis ring, e.g. the centre tab button. */
  ring: 4,
} as const;

/**
 * Icon sizes. The app currently uses 10–22 with no scale (13, 14, 15, 16, 17 and 18
 * all appear). These six steps cover every existing case once rounded.
 */
export const iconSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
} as const;

/** Sizing. `touchTarget` is the WCAG / platform minimum for an interactive element. */
export const size = {
  touchTarget: 44,
  avatarSm: 32,
  avatarMd: 42,
  avatarLg: 56,
  /** Standard control height for buttons and inputs. */
  control: 48,
} as const;

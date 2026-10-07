import { color } from "@/theme/tokens";

/**
 * The names screens used before the design tokens existed, now aliases of them — so every older
 * screen takes the same palette. New code reads `@/theme/tokens` directly.
 */
export const partnerColors = {
  cream: color.paper,
  sage: color.paper,
  primary: color.leaf,
  primaryDark: color.leafPressed,
  text: color.ink,
  textMuted: color.slate,
  textSecondary: color.slate,
  danger: color.danger,
  warning: color.marigold,
  success: color.success,
  surface: color.surface,
  surfaceDark: color.ink,
  line: color.line,
} as const;

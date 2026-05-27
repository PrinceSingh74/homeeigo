/** Design tokens — Luxury Aurora spacing & type scale */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 28,
  pill: 999,
} as const;

export const type = {
  caption: { fontSize: 11, lineHeight: 14, letterSpacing: 0.2 },
  small: { fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 22, letterSpacing: -0.2 },
  bodyBold: { fontSize: 15, lineHeight: 22, fontWeight: "700" as const },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "800" as const, letterSpacing: -0.4 },
  headline: { fontSize: 28, lineHeight: 34, fontWeight: "800" as const, letterSpacing: -0.8 },
  display: { fontSize: 34, lineHeight: 40, fontWeight: "800" as const, letterSpacing: -1 },
  mono: { fontSize: 12, lineHeight: 16, fontFamily: "monospace" as const, fontWeight: "600" as const },
  /** Section headers in booking flow */
  section: { fontSize: 17, lineHeight: 22, fontWeight: "800" as const, letterSpacing: -0.3 },
  /** Step label under progress dots */
  step: { fontSize: 10, lineHeight: 12, fontWeight: "700" as const, letterSpacing: 0.2 },
  /** Filter / date chips */
  chip: { fontSize: 13, lineHeight: 16, fontWeight: "700" as const },
  chipSm: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const },
  /** Prices */
  price: { fontSize: 20, lineHeight: 24, fontWeight: "800" as const, letterSpacing: -0.5 },
  priceLg: { fontSize: 28, lineHeight: 32, fontWeight: "800" as const, letterSpacing: -0.8 },
  overline: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
  },
};

/** Horizontal screen padding for booking & list screens */
export const screenPadding = spacing["2xl"];

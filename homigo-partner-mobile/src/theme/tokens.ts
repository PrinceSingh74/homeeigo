import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * The partner app's design tokens.
 *
 * Who this is for: a professional on a job — outdoors, one hand free, in a hurry, often on a
 * mid-range Android phone in sunlight. So: high-contrast ink on a cool, slightly green paper;
 * one deep leaf green that means "your next step"; marigold only for money and for things that
 * need attention; large touch targets; numbers that line up.
 *
 * Every screen takes its colour, spacing, radius and type from here. `partnerColors`
 * (theme/colors.ts) is kept as an alias of these values for the screens that predate the tokens.
 */
export const color = {
  /** Page background: a cool paper with a breath of green, not a cream. */
  paper: "#F3F6F2",
  /** A raised surface on paper. */
  surface: "#FFFFFF",
  /** A sunken surface: inputs, wells, the inside of a card. */
  well: "#EAF0EA",
  /** Body ink. */
  ink: "#10201A",
  /** Secondary text: still AA on paper and on surface. */
  slate: "#4F6157",
  /** Hints and disabled text. */
  mist: "#7B8C83",
  /** Hairlines and card borders. */
  line: "#D5DED6",

  /** The one action colour: the next step of the job. */
  leaf: "#1F5A3F",
  leafPressed: "#17452F",
  /** A tint of leaf for selected / informational backgrounds. */
  leafWash: "#E3EEE6",
  onLeaf: "#FFFFFF",

  /** Money, and anything that wants attention without being an error. */
  marigold: "#B77400",
  marigoldWash: "#FFF4D9",

  success: "#1B7A46",
  successWash: "#E2F3E8",
  danger: "#B4281E",
  dangerWash: "#FCE9E6",
  info: "#1D5C8A",
  infoWash: "#E4EFF7",

  /** Scrim behind sheets and dialogs. */
  scrim: "rgba(16, 32, 26, 0.52)",
} as const;

/** A 4-pt grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Radius follows hierarchy: controls are tighter than the cards that hold them, sheets are the softest. */
export const radius = { control: 12, card: 18, sheet: 28, pill: 999 } as const;

/** The smallest thing a thumb is asked to hit. */
export const touch = { min: 48 } as const;

const family = Platform.select({ ios: "System", android: "sans-serif", default: "System" });
const familyMedium = Platform.select({ ios: "System", android: "sans-serif-medium", default: "System" });

/**
 * Type scale (1.2 minor third from a 15-pt body, rounded to whole points). Numbers that are
 * compared — money, times, counts — use `tabular` so their digits line up.
 */
export const type = {
  display: { fontFamily: familyMedium, fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.4, color: color.ink },
  title: { fontFamily: familyMedium, fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.2, color: color.ink },
  heading: { fontFamily: familyMedium, fontSize: 17, lineHeight: 24, fontWeight: "600", color: color.ink },
  body: { fontFamily: family, fontSize: 15, lineHeight: 22, fontWeight: "400", color: color.ink },
  bodyStrong: { fontFamily: familyMedium, fontSize: 15, lineHeight: 22, fontWeight: "600", color: color.ink },
  small: { fontFamily: family, fontSize: 13, lineHeight: 19, fontWeight: "400", color: color.slate },
  smallStrong: { fontFamily: familyMedium, fontSize: 13, lineHeight: 19, fontWeight: "600", color: color.ink },
  caption: { fontFamily: family, fontSize: 12, lineHeight: 16, fontWeight: "500", color: color.mist },
} as const satisfies Record<string, TextStyle>;

export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };

/** Two elevations only: a card resting on paper, and something floating above the page. */
export const elevation = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: "#10201A", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
    default: { elevation: 1 },
  })!,
  float: Platform.select<ViewStyle>({
    ios: { shadowColor: "#10201A", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: -6 } },
    default: { elevation: 12 },
  })!,
} as const;

export type Tone = "neutral" | "leaf" | "success" | "warning" | "danger" | "info";

/** Foreground / background / border for each semantic tone. */
export const tone: Record<Tone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: color.slate, bg: color.well, border: color.line },
  leaf: { fg: color.leaf, bg: color.leafWash, border: "#C4DACB" },
  success: { fg: color.success, bg: color.successWash, border: "#BFE2CC" },
  warning: { fg: color.marigold, bg: color.marigoldWash, border: "#F1D99A" },
  danger: { fg: color.danger, bg: color.dangerWash, border: "#F2C4BE" },
  info: { fg: color.info, bg: color.infoWash, border: "#BFD6E8" },
};

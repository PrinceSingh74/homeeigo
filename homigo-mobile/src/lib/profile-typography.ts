import { Platform, type TextStyle } from "react-native";

/** Android: avoid extra font padding that clips glyphs */
export const profileTextBase: TextStyle = Platform.select({
  android: { includeFontPadding: false, textAlignVertical: "center" },
  default: {},
}) as TextStyle;

export const profileType = {
  pageTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  pageSub: {
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: -0.15,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.35,
    lineHeight: 22,
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  heroName: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  heroBadge: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  heroMeta: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  heroEdit: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  statOverline: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.35,
    lineHeight: 13,
    textTransform: "uppercase",
    textAlign: "center",
  } as TextStyle,
  statValue: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.35,
    lineHeight: 22,
    textAlign: "center",
  },
  statCaption: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
    textAlign: "center",
  },
  premiumBrand: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.6,
    lineHeight: 20,
    color: "#fff",
  },
  premiumTagline: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    color: "rgba(255,255,255,0.9)",
  },
  premiumFeature: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 13,
    textAlign: "center",
    color: "rgba(255,255,255,0.92)",
  },
  premiumActive: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    lineHeight: 12,
    color: "#fff",
  },
  premiumBtn: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    color: "#7C3AED",
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  tileValue: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.45,
    lineHeight: 26,
  },
  tileLink: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  bookingTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.25,
    lineHeight: 19,
  },
  bookingMeta: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  bookingBadge: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 13,
  },
  bookingAction: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.25,
    lineHeight: 19,
  },
  insightSub: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  addressTag: {
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 13,
  },
  addressLine: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  addressAdd: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
} as const satisfies Record<string, TextStyle>;

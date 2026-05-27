import { StyleSheet } from "react-native";
import { radius, spacing, type } from "./typography";

/** Sheet grab handle — subtle pill */
export const sheetHandle = {
  width: 44,
  height: 5,
  borderRadius: 100,
  backgroundColor: "rgba(148, 163, 184, 0.45)",
  alignSelf: "center" as const,
  marginTop: spacing.sm,
  marginBottom: spacing.md,
};

/** Shared booking surfaces — premium curves + depth-friendly radii */
export const bookingUi = StyleSheet.create({
  screenPad: {
    paddingHorizontal: spacing["2xl"],
  },
  card: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    minHeight: 40,
  },
  chipText: { ...type.chip, letterSpacing: 0.2 },
  chipCount: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    minWidth: 22,
    alignItems: "center",
  },
  block: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  detailLabel: {
    ...type.overline,
  },
  detailValue: {
    ...type.body,
    marginTop: 2,
  },
  toast: {
    position: "absolute",
    bottom: 108,
    alignSelf: "center",
    maxWidth: "88%",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    zIndex: 100,
  },
  toastText: {
    ...type.small,
    color: "#FFFFFF",
    fontWeight: "600",
    textAlign: "center",
  },
});

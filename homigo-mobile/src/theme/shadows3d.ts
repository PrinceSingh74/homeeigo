import { ViewStyle } from "react-native";

/** Layered depth shadows — simulates 3D lift on mobile */
export const shadow3d = {
  soft: {
    shadowColor: "#6C3AE8",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
  } satisfies ViewStyle,
  medium: {
    shadowColor: "#4C1D95",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 14,
  } satisfies ViewStyle,
  deep: {
    shadowColor: "#1A0B3B",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.28,
    shadowRadius: 36,
    elevation: 18,
  } satisfies ViewStyle,
  float: {
    shadowColor: "#6C3AE8",
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    elevation: 20,
  } satisfies ViewStyle,
  glass: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  } satisfies ViewStyle,
} as const;

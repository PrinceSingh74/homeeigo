import React from "react";
import { Text, StyleSheet, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { PressableScale } from "@/components/ai/PressableScale";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  label?: string;
  onPress?: () => void;
  variant?: "filled" | "outline";
  style?: ViewStyle;
  compact?: boolean;
};

export function BookNowButton({
  label = "Book Now",
  onPress,
  variant = "filled",
  style,
  compact = false,
}: Props) {
  const { c, shadows, layout: L } = useServicesTheme();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  return (
    <PressableScale
      onPress={handlePress}
      scaleTo={0.96}
      style={[
        styles.base,
        compact && styles.compact,
        {
          height: compact
            ? Math.round(34 * L.scale)
            : Math.round(38 * L.scale),
        },
        variant === "filled"
          ? { backgroundColor: c.primary }
          : { backgroundColor: "transparent", borderWidth: 1.5, borderColor: c.primary },
        variant === "filled" && !compact && shadows.soft,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          compact && styles.textCompact,
          { color: variant === "outline" ? c.primary : "#FFFFFF" },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 38,
    borderRadius: layout.cardRadiusSm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  compact: {
    height: 34,
    borderRadius: 12,
  },
  text: {
    ...serviceType.buttonSm,
    fontSize: 13,
  },
  textCompact: {
    ...serviceType.buttonSm,
  },
});

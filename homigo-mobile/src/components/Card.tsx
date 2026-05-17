import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

interface CardProps {
  children: React.ReactNode;
  variant?: "standard" | "premium" | "elite";
  style?: ViewStyle;
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = "standard",
  style,
}) => {
  const { colors: themeColors } = useTheme();

  const variantStyles = {
    standard: {
      backgroundColor: themeColors.cardBg,
      borderColor: themeColors.border,
      borderWidth: 1,
    },
    premium: {
      backgroundColor: themeColors.cardBg,
      borderColor: themeColors.gold,
      borderWidth: 2,
    },
    elite: {
      backgroundColor: themeColors.cardBg,
      borderColor: themeColors.primary,
      borderWidth: 2,
    },
  };

  return (
    <View
      style={[
        styles.card,
        variantStyles[variant],
        shadowStyles.md,
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    overflow: "hidden",
  },
});

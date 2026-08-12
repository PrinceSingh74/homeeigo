import React, { useRef } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";
import { radius, spacing, type as typeScale } from "@/lib/typography";
import { opacity, size as sizing } from "@/lib/tokens";

type Variant = "primary" | "secondary" | "premium" | "danger";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
  /** Defaults to true — matches what hand-rolled buttons across the app already do. */
  haptic?: boolean;
  /** Overrides the label for screen readers when the visible text is not descriptive enough. */
  accessibilityLabel?: string;
}

/**
 * Sizes snap to the shared spacing and radius scales rather than the arbitrary
 * 10/14/17 paddings this used to carry. `minHeight` enforces the 44 px touch
 * target — the old `sm` measured about 38 px, below the platform minimum.
 */
const SIZE = {
  sm: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    font: typeScale.small.fontSize,
    minHeight: sizing.touchTarget,
  },
  md: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    font: typeScale.body.fontSize,
    minHeight: sizing.control,
  },
  lg: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing["2xl"],
    borderRadius: radius.lg,
    font: typeScale.bodyBold.fontSize + 1,
    minHeight: sizing.control + 4,
  },
} as const;

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  style,
  icon,
  haptic = true,
  accessibilityLabel,
}) => {
  const { colors: themeColors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const s = SIZE[size];
  const isGradient = variant === "primary" || variant === "premium";
  const busy = loading;
  const inactive = disabled || loading;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();

  const handlePress = () => {
    if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const textColor = variant === "secondary" ? themeColors.text : "#FFFFFF";

  const inner = (
    <>
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? themeColors.primary : "#fff"} />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, { fontSize: s.font, color: textColor }]}>{title}</Text>
        </>
      )}
    </>
  );

  const padding = {
    paddingVertical: s.paddingVertical,
    paddingHorizontal: s.paddingHorizontal,
    borderRadius: s.borderRadius,
    minHeight: s.minHeight,
  };

  return (
    <Animated.View
      style={[
        { transform: [{ scale }], borderRadius: s.borderRadius },
        variant === "primary" && shadowStyles.glowPrimary,
        variant === "premium" && shadowStyles.glowTeal,
        variant === "secondary" && shadowStyles.sm,
        variant === "danger" && shadowStyles.sm,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={inactive}
        // A screen reader could not previously tell this was a button, nor that it
        // was disabled or mid-request.
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: inactive, busy }}
      >
        {isGradient ? (
          <LinearGradient
            colors={variant === "premium" ? gradients.gold : gradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, padding]}
          >
            {inner}
          </LinearGradient>
        ) : (
          <Animated.View
            style={[
              styles.base,
              padding,
              variant === "danger"
                ? { backgroundColor: themeColors.error }
                : {
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.85)",
                    borderWidth: 1,
                    borderColor: themeColors.border,
                  },
            ]}
          >
            {inner}
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  text: {
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});

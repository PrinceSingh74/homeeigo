import React, { useRef } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "premium";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

const SIZE = {
  sm: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14, font: 14 },
  md: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, font: 15 },
  lg: { paddingVertical: 17, paddingHorizontal: 24, borderRadius: 20, font: 16 },
};

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  style,
  icon,
}) => {
  const { colors: themeColors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const s = SIZE[size];
  const isGradient = variant === "primary" || variant === "premium";

  const pressIn = () =>
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  const pressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();

  const textColor =
    variant === "secondary" ? themeColors.text : "#FFFFFF";

  const inner = (
    <>
      {loading ? (
        <ActivityIndicator
          color={variant === "secondary" ? themeColors.primary : "#fff"}
        />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.text,
              { fontSize: s.font, color: textColor },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </>
  );

  return (
    <Animated.View
      style={[
        { transform: [{ scale }], borderRadius: s.borderRadius },
        variant === "primary" && shadowStyles.glowBlue,
        variant === "premium" && shadowStyles.glowViolet,
        variant === "secondary" && shadowStyles.sm,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled || loading}
      >
        {isGradient ? (
          <LinearGradient
            colors={variant === "premium" ? gradients.gold : gradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.base,
              {
                paddingVertical: s.paddingVertical,
                paddingHorizontal: s.paddingHorizontal,
                borderRadius: s.borderRadius,
              },
            ]}
          >
            {inner}
          </LinearGradient>
        ) : (
          <Animated.View
            style={[
              styles.base,
              {
                paddingVertical: s.paddingVertical,
                paddingHorizontal: s.paddingHorizontal,
                borderRadius: s.borderRadius,
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(255,255,255,0.85)",
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
    gap: 8,
  },
  text: {
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.5,
  },
});

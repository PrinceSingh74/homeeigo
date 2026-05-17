import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

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

  const sizeStyles = {
    sm: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12 },
    md: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 16 },
    lg: { paddingVertical: 16, paddingHorizontal: 24, borderRadius: 20 },
  };

  const variantStyles = {
    primary: {
      backgroundColor: themeColors.primary,
      borderWidth: 0,
    },
    secondary: {
      backgroundColor: isDark ? "#1F2937" : "#F9FAFB",
      borderWidth: 1,
      borderColor: themeColors.border,
    },
    premium: {
      backgroundColor: themeColors.gold,
      borderWidth: 0,
    },
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        sizeStyles[size],
        variantStyles[variant],
        disabled && styles.disabled,
        shadowStyles.md,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "secondary" ? themeColors.primary : "white"}
        />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.buttonText,
              {
                color:
                  variant === "secondary"
                    ? themeColors.text
                    : variant === "premium"
                      ? "#000"
                      : "white",
              },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
});

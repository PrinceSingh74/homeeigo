import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  emoji: string;
  bgColor: string;
  active?: boolean;
  size?: number;
};

export function Premium3DIcon({
  emoji,
  bgColor,
  active = false,
  size = 76,
}: Props) {
  const { c, shadows, isDark } = useServicesTheme();
  const r = size / 2;

  return (
    <View style={[styles.stack, active && shadows.medium]}>
      <View
        style={[
          styles.ground,
          {
            width: size * 0.78,
            height: size * 0.18,
            borderRadius: size * 0.4,
            bottom: -size * 0.06,
            backgroundColor: isDark
              ? "rgba(52, 211, 153, 0.35)"
              : "rgba(5, 150, 105, 0.18)",
          },
        ]}
      />
      <View
        style={[
          styles.disk,
          {
            width: size,
            height: size,
            borderRadius: r,
            borderColor: active
              ? c.primary
              : isDark
                ? "rgba(52, 211, 153, 0.2)"
                : "rgba(255,255,255,0.9)",
          },
          shadows.soft,
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? [lightenDark(bgColor), bgColor, darken(bgColor)]
              : ["#FFFFFF", bgColor, darken(bgColor)]
          }
          locations={[0, 0.4, 1]}
          style={[styles.fill, { borderRadius: r }]}
        >
          <LinearGradient
            colors={
              isDark
                ? ["rgba(52, 211, 153, 0.2)", "rgba(52, 211, 153, 0)"]
                : ["rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]
            }
            style={[styles.shine, { borderTopLeftRadius: r, borderTopRightRadius: r }]}
          />
          <Text style={[styles.emoji, { fontSize: size * 0.38 }]}>{emoji}</Text>
        </LinearGradient>
      </View>
    </View>
  );
}

function lightenDark(hex: string) {
  if (hex === "#EEF2FF") return "#2A2A40";
  if (hex === "#E0F2FE") return "#1E3A5F";
  if (hex === "#E0F7FA") return "#164E63";
  if (hex === "#FFF9C4") return "#3D3A20";
  if (hex === "#F0FFF4") return "#1A3328";
  if (hex === "#FDF4FF") return "#3B2A45";
  if (hex === "#FFF7ED") return "#3D2E1F";
  if (hex === "#FEF3C7") return "#3D3520";
  if (hex === "#F0F4FF") return "#252A45";
  return "#2A2640";
}

function darken(hex: string) {
  if (hex === "#EEF2FF") return "#DDE4FF";
  if (hex === "#E0F2FE") return "#BAE6FD";
  if (hex === "#E0F7FA") return "#A5F3FC";
  if (hex === "#FFF9C4") return "#FEF08A";
  if (hex === "#F0FFF4") return "#DCFCE7";
  if (hex === "#FDF4FF") return "#F5D0FE";
  if (hex === "#FFF7ED") return "#FFEDD5";
  if (hex === "#FEF3C7") return "#FDE68A";
  if (hex === "#F0F4FF") return "#DBEAFE";
  return "#E5E7EB";
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "center",
    justifyContent: "center",
  },
  ground: {
    position: "absolute",
    opacity: 0.55,
    transform: [{ scaleX: 1.1 }],
  },
  disk: {
    borderWidth: 2.5,
  },
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  shine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "42%",
  },
  emoji: {
    marginTop: 4,
  },
});

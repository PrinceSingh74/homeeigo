import React from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Home,
  CalendarDays,
  Wallet,
  User,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useTheme } from "@/hooks/useTheme";
import { CenterTabButton } from "./CenterTabButton";

const { width: W } = Dimensions.get("window");
const BAR_H = 64;
const TOP_R = 26;
const NOTCH_R = 40;

function barPath(totalH: number) {
  const cx = W / 2;
  const nr = NOTCH_R; // half-width where notch meets top edge
  const depth = 46; // how deep the scoop dips
  return [
    `M 0 ${TOP_R}`,
    `Q 0 0 ${TOP_R} 0`,
    `L ${cx - nr} 0`,
    `C ${cx - nr + 20} 0 ${cx - 28} ${depth} ${cx} ${depth}`,
    `C ${cx + 28} ${depth} ${cx + nr - 20} 0 ${cx + nr} 0`,
    `L ${W - TOP_R} 0`,
    `Q ${W} 0 ${W} ${TOP_R}`,
    `V ${totalH}`,
    `H 0`,
    `Z`,
  ].join(" ");
}

const ICONS: Record<string, LucideIcon> = {
  index: Home,
  bookings: CalendarDays,
  ai: Sparkles,
  wallet: Wallet,
  profile: User,
};
const LABELS: Record<string, string> = {
  index: "Home",
  bookings: "Bookings",
  ai: "AI Assistant",
  wallet: "Wallet",
  profile: "Profile",
};

export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const { colors: themeColors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const padBottom = insets.bottom > 0 ? insets.bottom : 12;
  const totalH = BAR_H + padBottom;

  return (
    <View style={[styles.root, { height: totalH }]}>
      <Svg
        width={W}
        height={totalH}
        style={StyleSheet.absoluteFill}
      >
        <Path
          d={barPath(totalH)}
          fill={isDark ? "#111827" : "#FFFFFF"}
        />
      </Svg>

      <View style={[styles.itemsRow, { paddingBottom: padBottom }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const Icon = ICONS[route.name] ?? Home;
          const label = LABELS[route.name] ?? route.name;
          const isCenter = route.name === "ai";

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          if (isCenter) {
            return (
              <CenterTabButton
                key={route.key}
                focused={focused}
                onPress={onPress}
              />
            );
          }

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item}>
              {focused ? (
                <LinearGradient
                  colors={["#2563EB", "#7C3AED"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.activeBadge}
                >
                  <Icon size={20} color="#fff" strokeWidth={2.6} />
                </LinearGradient>
              ) : (
                <View style={styles.iconSlot}>
                  <Icon
                    size={22}
                    color={themeColors.textSecondary}
                    strokeWidth={2}
                  />
                </View>
              )}
              <Text
                style={[
                  styles.label,
                  {
                    color: focused
                      ? themeColors.primary
                      : themeColors.textSecondary,
                    fontWeight: focused ? "800" : "500",
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 20,
  },
  itemsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingHorizontal: 10,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    paddingBottom: 6,
  },
  iconSlot: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  activeBadge: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  label: {
    fontSize: 10,
    letterSpacing: -0.1,
  },
});

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Home,
  CalendarDays,
  Wallet,
  User,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useTheme } from "@/hooks/useTheme";
import { CenterTabButton } from "./CenterTabButton";

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

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom > 0 ? insets.bottom : 14,
          backgroundColor: isDark ? "#111827" : "#FFFFFF",
          borderTopColor: isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(15,23,42,0.05)",
        },
      ]}
    >
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
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingTop: 14,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 20,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: 5,
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

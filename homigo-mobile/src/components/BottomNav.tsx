import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Home,
  CalendarDays,
  Wallet,
  User,
  type LucideIcon,
} from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { CenterTabButton } from "./CenterTabButton";

const ICONS: Record<string, LucideIcon> = {
  index: Home,
  bookings: CalendarDays,
  ai: Bot,
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
    <View style={styles.container}>
      <BlurView intensity={80} tint="light" style={styles.blurLayer}>
        <View
          style={[
            styles.bar,
            {
              paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
              backgroundColor: isDark
                ? "rgba(17,24,39,0.5)"
                : "rgba(255,255,255,0.6)",
              borderTopColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(255,255,255,0.5)",
            },
            shadowStyles.xl,
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
            <Icon
              size={22}
              color={focused ? themeColors.primary : themeColors.textSecondary}
              strokeWidth={focused ? 2.6 : 2}
            />
            <Text
              style={[
                styles.label,
                {
                  color: focused
                    ? themeColors.primary
                    : themeColors.textSecondary,
                  fontWeight: focused ? "700" : "500",
                  fontSize: 9,
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  blurLayer: {
    overflow: "hidden",
  },
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
  },
  label: {
    fontSize: 9,
    fontWeight: "500",
  },
});

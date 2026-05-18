import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Home,
  CalendarDays,
  Bot,
  Wallet,
  User,
  type LucideIcon,
} from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

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
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
          backgroundColor: isDark
            ? "rgba(17,24,39,0.98)"
            : "rgba(255,255,255,0.98)",
          borderTopColor: themeColors.border,
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
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.centerWrap}
            >
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    opacity: pulse.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.5, 0, 0.5],
                    }),
                    transform: [
                      {
                        scale: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.45],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <LinearGradient
                colors={["#2563EB", "#7C3AED"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.centerBtn, shadowStyles.glowBlue]}
              >
                <Bot size={26} color="#fff" />
              </LinearGradient>
              <Text
                style={[
                  styles.centerLabel,
                  { color: focused ? themeColors.primary : themeColors.textSecondary },
                ]}
              >
                AI Assistant
              </Text>
            </Pressable>
          );
        }

        return (
          <Pressable key={route.key} onPress={onPress} style={styles.item}>
            <Icon
              size={23}
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
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
  },
  label: {
    fontSize: 10,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  centerBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28,
    borderWidth: 3,
    borderColor: "#fff",
  },
  pulseRing: {
    position: "absolute",
    top: -28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#7C3AED",
  },
  centerLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
});

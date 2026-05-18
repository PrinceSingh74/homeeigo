import React, { useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
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

  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse]);

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
          const pulseAnimStyle = useAnimatedStyle(() => ({
            opacity: 0.5 + Math.abs(Math.cos((pulse.value * Math.PI * 2))) * 0.3,
            transform: [{ scale: 1 + pulse.value * 0.45 }],
          }));

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.centerWrap}
            >
              <Animated.View
                style={[
                  styles.pulseRing,
                  pulseAnimStyle,
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
    gap: 4,
    paddingVertical: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: "500",
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  centerBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -28,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 10,
  },
  pulseRing: {
    position: "absolute",
    top: -28,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#7C3AED",
  },
  centerLabel: {
    fontSize: 9,
    fontWeight: "700",
  },
});

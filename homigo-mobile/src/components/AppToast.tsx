import React, { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/lib/store";
import { bookingUi } from "@/lib/booking-ui";
import { shadowStyles } from "@/lib/colors";

/** Global toast — reads from zustand `toast` message */
export function AppToast() {
  const message = useAppStore((s) => s.toast);
  const { colors: c, isDark } = useTheme();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    if (message) {
      opacity.value = withTiming(1, { duration: 220 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(16, { duration: 180 });
    }
  }, [message, opacity, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        bookingUi.toast,
        animStyle,
        {
          backgroundColor: isDark ? c.cardBg : "#0F172A",
          borderWidth: isDark ? 1 : 0,
          borderColor: c.border,
        },
        shadowStyles.lg,
      ]}
    >
      <Text style={bookingUi.toastText}>{message}</Text>
    </Animated.View>
  );
}

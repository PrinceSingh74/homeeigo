import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Bell } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { WALLET_USER } from "@/lib/wallet-mobile-data";
import { WALLET_PAD } from "@/lib/wallet-layout";
import { spacing } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";

type Props = {
  scrollY?: SharedValue<number>;
  onNotifications: () => void;
  onProfile: () => void;
};

function PulseBadge() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 1000 }),
        withTiming(1, { duration: 1000 }),
      ),
      -1,
      true,
    );
  }, [opacity]);

  const badgeAnim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.badge, badgeAnim]}>
      <Text style={styles.badgeText}>3</Text>
    </Animated.View>
  );
}

export function WalletHeader({ scrollY, onNotifications, onProfile }: Props) {
  const { colors: c, isDark } = useTheme();

  const titleAnim = useAnimatedStyle(() => {
    if (!scrollY) return {};
    const o = interpolate(scrollY.value, [0, 60], [1, 0.92], Extrapolation.CLAMP);
    return { opacity: o };
  });

  const subAnim = useAnimatedStyle(() => {
    if (!scrollY) return { opacity: 1 };
    return {
      opacity: interpolate(scrollY.value, [0, 40], [1, 0.4], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      entering={walletEnter.header}
      style={[
        styles.wrap,
        {
          backgroundColor: c.bg,
          borderBottomColor: c.border,
        },
        isDark && styles.wrapDark,
      ]}
    >
      <Animated.View style={[styles.row, titleAnim]}>
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: c.text }]}>Wallet</Text>
          <Animated.Text style={[styles.sub, { color: c.textSecondary }, subAnim]}>
            Manage your balance, payments & rewards
          </Animated.Text>
        </View>
        <View style={styles.actions}>
          <PressableScale
            onPress={onNotifications}
            style={[
              styles.bell,
              {
                backgroundColor: isDark ? c.cardBg : "#F9FAFB",
                borderColor: c.border,
              },
            ]}
            haptic
            accessibilityLabel="Notifications"
          >
            <Bell size={20} color={c.text} strokeWidth={2} />
            <PulseBadge />
          </PressableScale>
          <PressableScale onPress={onProfile} haptic accessibilityLabel="Profile">
            <Image
              source={{ uri: WALLET_USER.avatar }}
              style={[
                styles.avatar,
                {
                  borderColor: c.border,
                  shadowColor: "#000",
                },
              ]}
            />
          </PressableScale>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: -WALLET_PAD,
    paddingHorizontal: WALLET_PAD,
    paddingVertical: 12,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  wrapDark: {
    shadowOpacity: 0.15,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 56,
  },
  textCol: { flex: 1, paddingRight: 4 },
  title: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  sub: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#EC4899",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
});

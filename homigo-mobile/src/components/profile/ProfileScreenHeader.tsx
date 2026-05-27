import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Bell, Settings } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";
import { shadowStyles } from "@/lib/colors";

type Props = {
  onNotifications: () => void;
  onSettings: () => void;
};

function PulseBadge() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900 }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
      true,
    );
  }, [opacity]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[styles.badge, anim]}>
      <Text style={[styles.badgeText, profileTextBase]}>3</Text>
    </Animated.View>
  );
}

export function ProfileScreenHeader({ onNotifications, onSettings }: Props) {
  const { colors: c, isDark } = useTheme();

  return (
    <Animated.View entering={profileEnter.header} style={styles.wrap}>
      <View style={styles.textCol}>
        <Text style={[profileType.pageTitle, profileTextBase, { color: c.text }]}>Profile</Text>
        <Text
          style={[profileType.pageSub, profileTextBase, { color: c.textSecondary }]}
          numberOfLines={2}
        >
          Manage your account & preferences
        </Text>
      </View>
      <View style={styles.actions}>
        <PressableScale
          onPress={onNotifications}
          haptic
          accessibilityLabel="Notifications"
          style={[
            styles.iconBtn,
            {
              backgroundColor: isDark ? c.cardBg : "#F9FAFB",
              borderColor: c.border,
            },
            shadowStyles.sm,
          ]}
        >
          <Bell size={20} color={c.text} strokeWidth={2} />
          <PulseBadge />
        </PressableScale>
        <PressableScale
          onPress={onSettings}
          haptic
          accessibilityLabel="Settings"
          style={[styles.settingsBtn, shadowStyles.glowViolet]}
        >
          <Settings size={20} color="#fff" strokeWidth={2} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    gap: 12,
  },
  textCol: { flex: 1, minWidth: 0, paddingRight: 4 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 2,
    flexShrink: 0,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#fff",
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800", lineHeight: 11 },
});

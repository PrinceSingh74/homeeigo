import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
} from "react-native";
import { BlurView } from "expo-blur";
import { MapPin, ChevronDown, Bell } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { PressableScale } from "@/components/ai/PressableScale";

export const Navbar: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();
  const {
    openLocation,
    openNotifications,
    goProfile,
    locationFull,
    unreadNotifications,
  } = useAppNavigation();

  return (
    <View style={styles.container}>
      <BlurView intensity={70} tint={isDark ? "dark" : "light"} style={styles.blurLayer}>
        <View
          style={[
            styles.content,
            {
              backgroundColor: isDark
                ? "rgba(15,23,42,0.5)"
                : "rgba(248,250,252,0.6)",
            },
          ]}
        >
          <View style={styles.logoRow}>
            <Image
              source={
                isDark
                  ? require("../../assets/brand/logo-full-dark.png")
                  : require("../../assets/brand/logo-full.png")
              }
              style={styles.logo}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              accessibilityLabel="Homeeigo"
            />
          </View>

          <Pressable
            style={[
              styles.locationPill,
              {
                borderColor: isDark
                  ? "rgba(255,255,255,0.1)"
                  : "rgba(0,0,0,0.06)",
              },
            ]}
            onPress={openLocation}
          >
            <MapPin size={13} color="#059669" />
            <Text
              numberOfLines={1}
              style={[styles.locationText, { color: themeColors.text }]}
            >
              {locationFull}
            </Text>
            <ChevronDown size={12} color={themeColors.textSecondary} />
          </Pressable>

          <View style={styles.actions}>
            <Pressable style={styles.bellWrap} onPress={openNotifications}>
              <Bell size={20} color={themeColors.text} />
              {unreadNotifications > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeCount}>
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <PressableScale onPress={goProfile} haptic scaleTo={0.94}>
              <View
                style={[
                  styles.avatarRing,
                  { borderColor: "#059669" },
                ]}
              >
                <Image
                  source={{
                    uri: "https://api.dicebear.com/7.x/avataaars/png?seed=homigo&size=80",
                  }}
                  style={styles.avatar}
                />
              </View>
            </PressableScale>
          </View>
        </View>
      </BlurView>

      <View
        style={[
          styles.borderLine,
          {
            borderBottomColor: isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.05)",
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  blurLayer: {
    overflow: "hidden",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.4)",
    gap: 8,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  /** Full brand lockup — 560×386 artwork, kept at its native 1.45:1 ratio. */
  logo: {
    height: 42,
    width: 61,
  },
  logoText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "rgba(15,23,42,0.05)",
    flexShrink: 1,
    maxWidth: 160,
  },
  locationText: {
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bellWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeCount: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fff",
  },
  avatarRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E5E7EB",
  },
  borderLine: {
    borderBottomWidth: 1,
  },
});

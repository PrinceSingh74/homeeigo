import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, ChevronDown, Bell } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

export const Navbar: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();

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
          {/* Logo */}
          <View style={styles.logoRow}>
            <LinearGradient
              colors={["#2563EB", "#7C3AED"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoMark}
            >
              <Text style={styles.logoMarkText}>H</Text>
            </LinearGradient>
            <Text style={[styles.logoText, { color: themeColors.text }]}>
              HOMIGO
            </Text>
          </View>

          {/* Location pill */}
          <Pressable
            style={[
              styles.locationPill,
              {
                borderColor: isDark
                  ? "rgba(255,255,255,0.1)"
                  : "rgba(0,0,0,0.06)",
              },
            ]}
          >
            <MapPin size={13} color={themeColors.primary} />
            <Text
              numberOfLines={1}
              style={[styles.locationText, { color: themeColors.text }]}
            >
              Gurugram, Sector 49
            </Text>
            <ChevronDown size={12} color={themeColors.textSecondary} />
          </Pressable>

          {/* Right actions */}
          <View style={styles.actions}>
            <Pressable style={styles.bellWrap}>
              <Bell size={20} color={themeColors.text} />
              <View style={styles.badge} />
            </Pressable>
            <View
              style={[
                styles.avatarRing,
                { borderColor: themeColors.primary },
              ]}
            >
              <Image
                source={{
                  uri: "https://api.dicebear.com/7.x/avataaars/png?seed=homigo&size=80",
                }}
                style={styles.avatar}
              />
            </View>
          </View>
        </View>
      </BlurView>

      {/* Soft bottom border */}
      <View
        style={[
          styles.borderLine,
          { borderBottomColor: isDark
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
  },
  logoMark: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
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
    top: 6,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EC4899",
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

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, ChevronDown, Bell } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

export const Navbar: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? "rgba(15,23,42,0.92)"
            : "rgba(248,250,252,0.92)",
          borderBottomColor: themeColors.border,
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
            backgroundColor: isDark ? "#1F2937" : "#FFFFFF",
            borderColor: themeColors.border,
          },
          shadowStyles.sm,
        ]}
      >
        <MapPin size={14} color={themeColors.primary} />
        <Text
          numberOfLines={1}
          style={[styles.locationText, { color: themeColors.text }]}
        >
          Gurugram, Sector 49
        </Text>
        <ChevronDown size={14} color={themeColors.textSecondary} />
      </Pressable>

      {/* Right actions */}
      <View style={styles.actions}>
        <Pressable style={styles.bellWrap}>
          <Bell size={22} color={themeColors.text} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </Pressable>
        <View style={styles.avatarRing}>
          <Image
            source={{
              uri: "https://i.pravatar.cc/100?img=12",
            }}
            style={styles.avatar}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
  },
  logoText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  locationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: 170,
  },
  locationText: {
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bellWrap: {
    padding: 2,
  },
  badge: {
    position: "absolute",
    top: -3,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EC4899",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
  avatarRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#E5E7EB",
  },
});

import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { MapPin, Clock, User, Zap } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const { width } = Dimensions.get("window");

function AnimatedDot() {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.5, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 1 - (pulse.value - 1) * 0.5,
    transform: [{ scale: pulse.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: "#06B6D4",
        },
        pulseStyle,
      ]}
    />
  );
}

export const LiveTrackingSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Real-Time Tracking
        </Text>
        <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
          Know exactly when your pro arrives
        </Text>
      </View>

      <LinearGradient
        colors={["#1E1B4B", "#2D1B69", "#1E1B4B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.trackingCard, shadowStyles.xl]}
      >
        {/* Animated map placeholder with glowing route */}
        <View style={styles.mapContainer}>
          <LinearGradient
            colors={["#06B6D4", "#2563EB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.routeLine}
          />

          {/* Provider location dot */}
          <View style={styles.providerDot}>
            <View style={styles.providerInner} />
            <AnimatedDot />
          </View>

          {/* Destination dot */}
          <View style={styles.destDot}>
            <View style={styles.destInner} />
          </View>
        </View>

        {/* Status Info */}
        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <View style={[styles.statusIcon, { backgroundColor: "rgba(6,182,212,0.2)" }]}>
              <Clock size={18} color="#06B6D4" />
            </View>
            <View>
              <Text style={styles.statusLabel}>ETA</Text>
              <Text style={styles.statusValue}>8 mins</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.statusItem}>
            <View style={[styles.statusIcon, { backgroundColor: "rgba(37,99,235,0.2)" }]}>
              <User size={18} color="#2563EB" />
            </View>
            <View>
              <Text style={styles.statusLabel}>Professional</Text>
              <Text style={styles.statusValue}>Rajesh K.</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.statusItem}>
            <View style={[styles.statusIcon, { backgroundColor: "rgba(245,158,11,0.2)" }]}>
              <Zap size={18} color="#F59E0B" />
            </View>
            <View>
              <Text style={styles.statusLabel}>Status</Text>
              <Text style={styles.statusValue}>On the way</Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 48,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "500",
  },
  trackingCard: {
    borderRadius: 24,
    padding: 20,
    overflow: "hidden",
  },
  mapContainer: {
    height: 180,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    marginBottom: 20,
    position: "relative",
    overflow: "hidden",
  },
  routeLine: {
    position: "absolute",
    width: 3,
    height: 140,
    top: 20,
    left: width / 2 - 24 - 20 - 20,
    opacity: 0.6,
  },
  providerDot: {
    position: "absolute",
    width: 44,
    height: 44,
    top: 24,
    right: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  providerInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#06B6D4",
  },
  destDot: {
    position: "absolute",
    width: 44,
    height: 44,
    bottom: 24,
    left: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  destInner: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: "#2563EB",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 14,
  },
  statusItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.6)",
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginHorizontal: 8,
  },
});

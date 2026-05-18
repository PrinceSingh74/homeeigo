import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Check, MapPin, Navigation } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

function PulseRing() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.value,
    transform: [{ scale: 0.6 + pulse.value * 1.1 }],
  }));

  return <Animated.View style={[styles.pulseRing, pulseStyle]} />;
}

const STEPS = [
  { label: "Confirmed", done: true },
  { label: "On the Way", done: true },
  { label: "Arrived", done: false },
];

export const LiveTrackingSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: themeColors.text }]}>
        Live Tracking
      </Text>

      <View style={styles.row}>
        {/* LEFT — map card */}
        <LinearGradient
          colors={["#111827", "#1E1B4B", "#312E81"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.mapCard, shadowStyles.lg]}
        >
          {/* glowing curved route */}
          <View style={[styles.routeSeg, styles.rseg1]} />
          <View style={[styles.routeSeg, styles.rseg2]} />
          <View style={[styles.routeSeg, styles.rseg3]} />

          {/* mid pin */}
          <View style={[styles.pin, styles.pinMid]}>
            <MapPin size={12} color="#fff" fill="#7C3AED" />
          </View>
          {/* destination pin */}
          <View style={[styles.pin, styles.pinDest]}>
            <MapPin size={12} color="#fff" fill="#06B6D4" />
          </View>

          {/* rider avatar on the route */}
          <View style={styles.riderWrap}>
            <PulseRing />
            <LinearGradient
              colors={["#06B6D4", "#7C3AED"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.riderRing}
            >
              <Image
                source={{
                  uri: "https://api.dicebear.com/7.x/avataaars/png?seed=rajesh&size=64",
                }}
                style={styles.riderAvatar}
              />
            </LinearGradient>
          </View>

          <View style={styles.navChip}>
            <Navigation size={11} color="#fff" fill="#fff" />
          </View>
        </LinearGradient>

        {/* RIGHT — status card */}
        <LinearGradient
          colors={["#1E1B4B", "#312E81"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.statusCard, shadowStyles.lg]}
        >
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Service in Progress</Text>
          </View>

          <View style={styles.etaRow}>
            <Text style={styles.etaLabel}>Arriving in</Text>
            <Text style={styles.etaValue}>12 mins</Text>
          </View>
          <Text style={styles.etaSub}>Your expert is on the way</Text>

          {/* stepper */}
          <View style={styles.stepper}>
            {STEPS.map((s, i) => (
              <React.Fragment key={s.label}>
                <View style={styles.step}>
                  <View
                    style={[
                      styles.stepDot,
                      s.done ? styles.stepDotDone : styles.stepDotPending,
                    ]}
                  >
                    {s.done && <Check size={9} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      { opacity: s.done ? 1 : 0.5 },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {s.label}
                  </Text>
                </View>
                {i < STEPS.length - 1 && (
                  <View
                    style={[
                      styles.stepLine,
                      {
                        backgroundColor: STEPS[i + 1].done
                          ? "#06B6D4"
                          : "rgba(255,255,255,0.15)",
                      },
                    ]}
                  />
                )}
              </React.Fragment>
            ))}
          </View>
        </LinearGradient>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  mapCard: {
    flex: 1,
    height: 168,
    borderRadius: 20,
    overflow: "hidden",
  },
  routeSeg: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
  },
  rseg1: {
    width: 58,
    backgroundColor: "#06B6D4",
    top: 108,
    left: 24,
    transform: [{ rotate: "-38deg" }],
  },
  rseg2: {
    width: 56,
    backgroundColor: "#3B82F6",
    top: 78,
    left: 62,
    transform: [{ rotate: "22deg" }],
  },
  rseg3: {
    width: 58,
    backgroundColor: "#7C3AED",
    top: 92,
    right: 18,
    transform: [{ rotate: "-26deg" }],
  },
  pin: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pinMid: {
    top: 60,
    left: 96,
    backgroundColor: "rgba(124,58,237,0.25)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.6)",
  },
  pinDest: {
    top: 70,
    right: 16,
    backgroundColor: "rgba(6,182,212,0.22)",
    borderWidth: 1,
    borderColor: "rgba(6,182,212,0.55)",
  },
  riderWrap: {
    position: "absolute",
    top: "38%",
    left: "38%",
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(6,182,212,0.4)",
  },
  riderRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  riderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#1E1B4B",
    backgroundColor: "#1E1B4B",
  },
  navChip: {
    position: "absolute",
    bottom: 14,
    right: 14,
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: "rgba(124,58,237,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusCard: {
    flex: 1.08,
    height: 168,
    borderRadius: 20,
    padding: 16,
    justifyContent: "space-between",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#10B981",
  },
  liveText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "rgba(255,255,255,0.7)",
  },
  etaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  etaLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  etaValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#06B6D4",
    letterSpacing: -0.4,
  },
  etaSub: {
    fontSize: 10.5,
    fontWeight: "500",
    color: "rgba(255,255,255,0.6)",
    marginTop: -8,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
  },
  step: {
    alignItems: "center",
    gap: 5,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotDone: {
    backgroundColor: "#06B6D4",
  },
  stepDotPending: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  stepLabel: {
    fontSize: 8.5,
    fontWeight: "700",
    color: "#fff",
    maxWidth: 52,
    textAlign: "center",
  },
  stepLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 3,
    marginBottom: 16,
    borderRadius: 1,
  },
});

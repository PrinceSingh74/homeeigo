import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image, Dimensions, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Path,
  Defs,
  Stop,
  Circle,
  LinearGradient as SvgGradient,
} from "react-native-svg";
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
import { useAppNavigation } from "@/hooks/useAppNavigation";

const { width } = Dimensions.get("window");
const MAP_W = Math.round((width - 60) / 2.08);
const MAP_H = 172;

// route waypoints (px in MAP_W x MAP_H box)
const P = {
  start: { x: MAP_W * 0.22, y: MAP_H * 0.72 },
  mid: { x: MAP_W * 0.54, y: MAP_H * 0.54 },
  dest: { x: MAP_W * 0.82, y: MAP_H * 0.3 },
};
const ROUTE = `M ${P.start.x} ${P.start.y} C ${P.start.x + 26} ${
  P.start.y - 46
}, ${P.mid.x - 30} ${P.mid.y + 40}, ${P.mid.x} ${P.mid.y} S ${
  P.dest.x - 24
} ${P.dest.y + 34}, ${P.dest.x} ${P.dest.y}`;

function PulseRing() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1900, easing: Easing.out(Easing.ease) }),
      -1,
      false
    );
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.value,
    transform: [{ scale: 0.55 + pulse.value * 1.1 }],
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
  const { goBookings } = useAppNavigation();

  return (
    <Pressable style={styles.container} onPress={goBookings}>
      <Text style={[styles.title, { color: themeColors.text }]}>
        Live Tracking
      </Text>

      <View style={styles.row}>
        {/* LEFT — map card with smooth SVG route */}
        <LinearGradient
          colors={["#0B1020", "#1E1B4B", "#312E81"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.mapCard, shadowStyles.lg]}
        >
          <Svg
            width={MAP_W}
            height={MAP_H}
            style={StyleSheet.absoluteFill}
          >
            <Defs>
              <SvgGradient id="route" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#06B6D4" />
                <Stop offset="0.5" stopColor="#3B82F6" />
                <Stop offset="1" stopColor="#A855F7" />
              </SvgGradient>
            </Defs>
            {/* glow underlay */}
            <Path
              d={ROUTE}
              stroke="#3B82F6"
              strokeWidth={9}
              strokeLinecap="round"
              fill="none"
              opacity={0.18}
            />
            {/* bright route */}
            <Path
              d={ROUTE}
              stroke="url(#route)"
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
            />
            {/* waypoint dots */}
            <Circle cx={P.mid.x} cy={P.mid.y} r={3} fill="#fff" />
          </Svg>

          {/* destination pin */}
          <View
            style={[
              styles.destPin,
              { left: P.dest.x - 14, top: P.dest.y - 26 },
            ]}
          >
            <MapPin size={20} color="#06B6D4" fill="#06B6D4" />
          </View>

          {/* rider avatar at start */}
          <View
            style={[
              styles.riderWrap,
              { left: P.start.x - 26, top: P.start.y - 26 },
            ]}
          >
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

          <View>
            <Text style={styles.etaLabel}>Arriving in</Text>
            <Text style={styles.etaValue}>12 mins</Text>
            <Text style={styles.etaSub}>Your expert is on the way</Text>
          </View>

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
                    {s.done && <Check size={10} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text
                    style={[styles.stepLabel, { opacity: s.done ? 1 : 0.45 }]}
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
    </Pressable>
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
    height: MAP_H,
    borderRadius: 20,
    overflow: "hidden",
  },
  destPin: {
    position: "absolute",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  riderWrap: {
    position: "absolute",
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
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
    bottom: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: "rgba(124,58,237,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusCard: {
    flex: 1.08,
    height: MAP_H,
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
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255,255,255,0.72)",
  },
  etaLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
  },
  etaValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#06B6D4",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  etaSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "rgba(255,255,255,0.6)",
    marginTop: 4,
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
    width: 20,
    height: 20,
    borderRadius: 10,
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
    fontSize: 9,
    fontWeight: "700",
    color: "#fff",
    maxWidth: 54,
    textAlign: "center",
  },
  stepLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 16,
    borderRadius: 1,
  },
});

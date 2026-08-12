import React, { useEffect } from "react";
import { View, Text, StyleSheet, Dimensions, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import {
  ArrowRight,
  Check,
  Wifi,
  WifiOff,
  Route as RouteIcon,
  Navigation2,
  Clock,
  MapPin,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { useRouter } from "expo-router";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useLiveTrackingView } from "@/hooks/use-live-tracking-view";
import { HomeLiveMap } from "@/components/track/HomeLiveMap";
import { STAGE_ORDER, RAIL_STEPS } from "@/lib/journey-stage";

const { width } = Dimensions.get("window");
const MAP_W = width - 48;
const MAP_H = 250; // larger, immersive map

// Demo route (Gurugram) for the always-on PREVIEW state — a realistic ~2.6 km ride.

function PulseRing() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1900, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 1 - pulse.value,
    transform: [{ scale: 0.55 + pulse.value * 1.1 }],
  }));
  return <Animated.View style={[styles.pulseRing, pulseStyle]} />;
}


/**
 * Live Tracking — mirrors the Homeeigo website home section. ALWAYS visible:
 * a premium PREVIEW state (demo map + feature bullets) when nothing is active,
 * and a LIVE state (real ETA + journey rail) the moment a booking is tracking.
 * Emerald/mint world-class card on the home canvas.
 */
export const LiveTrackingSection: React.FC = () => {
  const { colors: c, isDark } = useTheme();
  const { goBookings } = useAppNavigation();
  const router = useRouter();
  const {
    activeBooking,
    connected,
    hasLive,
    provider,
    destination,
    region,
    routePoints,
    bearing,
    speedKmh,
    stage,
    stageIdx,
    enRoute,
    arrived,
    inService,
    completed,
    distanceKm,
    etaMin,
    direction,
  } = useLiveTrackingView();
  // Live booking -> open the full-screen Uber-style map; else the bookings list.
  const openTracking = () => {
    if (activeBooking?.id) router.push(`/track/${activeBooking.id}` as never);
    else goBookings();
  };

  // Stage-aware hero line — honest state text driven by the real status.
  const heroLine = !hasLive
    ? "Preview — book to track your pro live"
    : completed
      ? "Service complete"
      : inService
        ? "Service in progress"
        : arrived
          ? "Your professional has arrived"
          : connected
            ? `${activeBooking?.proName ?? "Your professional"} is on the way`
            : "Reconnecting live updates…";

  const cardBg = isDark ? "rgba(255,255,255,0.045)" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.10)" : "rgba(16,185,129,0.18)";

  return (
    <View style={styles.container}>
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }, shadowStyles.lg]}>
        {/* ---- Header ---- */}
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={styles.headLeft}>
            <View style={styles.dotWrap}>
              {hasLive && connected ? <PulseRing /> : null}
              <View
                style={[styles.statusDot, { backgroundColor: hasLive && connected ? "#10b981" : "#94a3b8" }]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: c.text }]}>
                Live <Text style={styles.titleAccent}>Tracking</Text>
              </Text>
              <Text style={[styles.subtitle, { color: c.textSecondary }]} numberOfLines={1}>
                {hasLive
                  ? `${activeBooking!.serviceTitle ?? "Your service"}`
                  : "Every booking comes with a real-time map"}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.statusPill,
              hasLive && connected
                ? { backgroundColor: "rgba(16,185,129,0.14)" }
                : hasLive
                  ? { backgroundColor: "rgba(245,158,11,0.14)" }
                  : { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(100,116,139,0.12)" },
            ]}
          >
            {hasLive && connected ? (
              <Wifi size={11} color="#047857" />
            ) : hasLive ? (
              <WifiOff size={11} color="#b45309" />
            ) : null}
            <Text
              style={[
                styles.statusPillText,
                { color: hasLive && connected ? "#047857" : hasLive ? "#b45309" : c.textSecondary },
              ]}
            >
              {hasLive ? (connected ? "LIVE" : "RECONNECTING") : "PREVIEW"}
            </Text>
          </View>
        </View>

        {/* ---- REAL interactive map (pinch-zoom / pan) ---- */}
        <View style={styles.map}>
          <HomeLiveMap
            provider={provider}
            destination={destination}
            region={region}
            height={MAP_H}
            routePoints={routePoints}
            interactive
            bearing={bearing}
            follow={hasLive && connected && enRoute}
          />
          {/* premium floating ETA card (does not block map gestures) */}
          <View style={styles.etaCard} pointerEvents="none">
            <View style={styles.etaCardIcon}>
              <Navigation2 size={15} color="#fff" fill="#fff" />
            </View>
            <View>
              <Text style={styles.etaCardTop}>
                {arrived ? "Arrived" : completed ? "Done" : etaMin != null ? `${etaMin} min` : "En route"}
                <Text style={styles.etaCardDim}>  ·  {distanceKm.toFixed(1)} km</Text>
              </Text>
              <Text style={styles.etaCardSub}>
                {enRoute
                  ? `Heading ${direction}${speedKmh != null && speedKmh > 0 ? ` · ${speedKmh} km/h` : ""}`
                  : inService
                    ? "Service in progress"
                    : arrived
                      ? "At your door"
                      : completed
                        ? "All done"
                        : "On the way"}
              </Text>
            </View>
          </View>
          {/* live/preview corner tag */}
          <View
            pointerEvents="none"
            style={[styles.mapTag, { backgroundColor: hasLive && connected ? "rgba(16,185,129,0.94)" : "rgba(4,20,13,0.75)" }]}
          >
            {hasLive && connected ? <PulseRing /> : null}
            <Text style={styles.mapTagText}>{hasLive ? (connected ? "LIVE MAP" : "RECONNECTING") : "REAL-TIME MAP"}</Text>
          </View>
          {/* pinch hint */}
          <View pointerEvents="none" style={styles.pinchHint}>
            <Text style={styles.pinchHintText}>Pinch to zoom</Text>
          </View>
        </View>

        {/* ---- Info panel ---- */}
        <View style={styles.panel}>
          {/* live stats: ETA · Distance · Direction (real map data) */}
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Clock size={14} color="#059669" />
              <Text style={[styles.statValue, { color: c.text }]}>
                {etaMin != null ? etaMin : "—"}
                <Text style={[styles.statUnit, { color: c.textSecondary }]}> min</Text>
              </Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Arriving</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: border }]} />
            <View style={styles.stat}>
              <RouteIcon size={14} color="#0d9488" />
              <Text style={[styles.statValue, { color: c.text }]}>
                {distanceKm.toFixed(1)}
                <Text style={[styles.statUnit, { color: c.textSecondary }]}> km</Text>
              </Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Distance</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: border }]} />
            <View style={styles.stat}>
              <Navigation2 size={14} color="#0d9488" />
              <Text style={[styles.statValue, { color: c.text }]}>{direction}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Heading</Text>
            </View>
          </View>

          {/* status-driven journey rail — done/active reflect the REAL stage */}
          <View style={styles.rail}>
            {RAIL_STEPS.map((step, i) => {
              const sIdx = STAGE_ORDER.indexOf(step.stage);
              // Preview (no active booking) shows the first two steps as a teaser.
              const done = hasLive ? stageIdx > sIdx : i < 2;
              const active = hasLive && stageIdx === sIdx;
              return (
                <React.Fragment key={step.label}>
                  <View style={styles.railStep}>
                    <View
                      style={[
                        styles.railDot,
                        done
                          ? styles.railDotDone
                          : active
                            ? styles.railDotActive
                            : { borderColor: border },
                      ]}
                    >
                      {done ? <Check size={9} color="#fff" strokeWidth={3} /> : null}
                    </View>
                    <Text
                      style={[
                        styles.railLabel,
                        { color: done || active ? "#047857" : c.textSecondary, fontWeight: active ? "800" : "700" },
                      ]}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                  </View>
                  {i < RAIL_STEPS.length - 1 ? (
                    <View
                      style={[
                        styles.railLine,
                        { backgroundColor: (hasLive ? stageIdx > sIdx : i < 1) ? "#10b981" : border },
                      ]}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>

          {/* honest stage line */}
          <Text style={[styles.previewNote, { color: c.textSecondary }]}>{heroLine}</Text>

          {/* CTA — the only tap target that navigates (map keeps its own gestures) */}
          <Pressable onPress={openTracking} style={[styles.cta, { borderTopColor: border }]}>
            <Text style={[styles.ctaText, { color: c.text }]}>
              {hasLive ? "Open full tracking" : "Pinch to zoom · tap to open full tracking"}
            </Text>
            <View style={styles.ctaArrow}>
              <ArrowRight size={15} color="#fff" strokeWidth={2.6} />
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, marginVertical: 20 },
  card: { borderRadius: 26, borderWidth: 1, overflow: "hidden" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  dotWrap: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
  pulseRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(16,185,129,0.4)",
  },
  statusDot: { width: 10, height: 10, borderRadius: 999 },
  title: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  titleAccent: { color: "#059669" },
  subtitle: { fontSize: 11.5, fontWeight: "500", marginTop: 1 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },

  map: { height: MAP_H, width: "100%", backgroundColor: "#062a1f", overflow: "hidden" },
  etaCard: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(4,20,13,0.82)",
    paddingLeft: 8,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  etaCardIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
  },
  etaCardTop: { color: "#fff", fontSize: 15, fontWeight: "900", letterSpacing: -0.3 },
  etaCardDim: { color: "#a7f3d0", fontSize: 12.5, fontWeight: "700" },
  etaCardSub: { color: "rgba(255,255,255,0.6)", fontSize: 10.5, fontWeight: "600", marginTop: 1 },
  pinchHint: {
    position: "absolute",
    bottom: 14,
    right: 12,
    backgroundColor: "rgba(4,20,13,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  pinchHintText: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: "700" },
  mapTag: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  mapTagText: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.6 },

  panel: { padding: 16, gap: 14 },
  stats: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 3 },
  statDivider: { width: 1, height: 34 },
  statValue: { fontSize: 18, fontWeight: "900", letterSpacing: -0.4 },
  statUnit: { fontSize: 11, fontWeight: "700" },
  statLabel: { fontSize: 10, fontWeight: "600" },

  rail: { flexDirection: "row", alignItems: "center" },
  railStep: { alignItems: "center", width: 52 },
  railDot: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },
  railDotDone: { backgroundColor: "#10b981", borderColor: "#10b981" },
  railDotActive: { backgroundColor: "#a7f3d0", borderColor: "#10b981" },
  railLabel: { fontSize: 9.5, fontWeight: "700" },
  railLine: { flex: 1, height: 2, borderRadius: 2, marginBottom: 19 },

  previewNote: { fontSize: 11.5, fontWeight: "500", textAlign: "center", marginTop: -2 },

  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 13,
    marginTop: 2,
  },
  ctaText: { fontSize: 13, fontWeight: "800" },
  ctaArrow: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
  },
});

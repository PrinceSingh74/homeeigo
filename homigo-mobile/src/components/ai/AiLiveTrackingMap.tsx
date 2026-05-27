import React, { useEffect } from "react";
import { View, Text, Image, StyleSheet, type DimensionValue } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Line, G, Rect } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
  type SharedValue,
} from "react-native-reanimated";
import { Bike, Home, MapPin, Radio } from "lucide-react-native";
import { useTrackingLayout } from "@/lib/tracking-layout";

const RIDER_IMG = require("../../../assets/rider.webp");

export const AI_TRACK_ROUTE =
  "M 52 138 C 130 88, 210 148, 295 95 S 400 48, 440 42";

const VB_W = 500;
const VB_H = 220;
const ROUTE_LEN = 520;

const HOME = { left: "82%" as DimensionValue, top: "12%" as DimensionValue };
const PICKUP = { left: "6%" as DimensionValue, top: "56%" as DimensionValue };

const BUILDINGS = [
  { x: 28, y: 24, w: 72, h: 48, d: 14, o: 0.85 },
  { x: 120, y: 8, w: 56, h: 36, d: 10, o: 0.65 },
  { x: 340, y: 120, w: 90, h: 52, d: 16, o: 0.8 },
  { x: 200, y: 160, w: 64, h: 40, d: 12, o: 0.9 },
  { x: 380, y: 36, w: 48, h: 32, d: 8, o: 0.5 },
];

const AnimatedPath = Animated.createAnimatedComponent(Path);

function GlassChip({
  children,
  style,
  compact,
}: {
  children: React.ReactNode;
  style?: object;
  compact?: boolean;
}) {
  return (
    <View style={[styles.glass, compact && styles.glassCompact, style]}>{children}</View>
  );
}

function MapSvg({
  routeProgress,
  dashOffset,
}: {
  routeProgress: SharedValue<number>;
  dashOffset: SharedValue<number>;
}) {
  const routeProps = useAnimatedProps(() => ({
    strokeDasharray: [ROUTE_LEN, ROUTE_LEN],
    strokeDashoffset: ROUTE_LEN * (1 - routeProgress.value),
  }));
  const dashProps = useAnimatedProps(() => ({
    strokeDasharray: [6, 12],
    strokeDashoffset: dashOffset.value,
  }));

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <SvgGrad id="routeGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#00D1FF" />
          <Stop offset="40%" stopColor="#3B82F6" />
          <Stop offset="100%" stopColor="#C084FC" />
        </SvgGrad>
        {BUILDINGS.map((_, i) => (
          <SvgGrad key={i} id={`bld${i}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#2D3A5C" />
            <Stop offset="100%" stopColor="#1A2238" />
          </SvgGrad>
        ))}
        <SvgGrad id="vig" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#000" stopOpacity={0} />
          <Stop offset="75%" stopColor="#000" stopOpacity={0.08} />
          <Stop offset="100%" stopColor="#000" stopOpacity={0.42} />
        </SvgGrad>
      </Defs>

      <G opacity={0.55}>
        {Array.from({ length: 11 }).map((_, i) => (
          <Line key={`v${i}`} x1={i * 50} y1={0} x2={i * 50} y2={VB_H} stroke="#3B4A6B" strokeWidth={i % 4 === 0 ? 1.4 : 0.5} opacity={0.6} />
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * 36} x2={VB_W} y2={i * 36} stroke="#2A3350" strokeWidth={i % 2 === 0 ? 0.9 : 0.4} opacity={0.5} />
        ))}
      </G>

      {BUILDINGS.map((b, i) => (
        <G key={i}>
          <Rect x={b.x + 4} y={b.y + b.d} width={b.w} height={b.h} rx={4} fill="#0A0E1A" opacity={b.o * 0.9} />
          <Rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={`url(#bld${i})`} opacity={b.o} />
          <Rect x={b.x + 6} y={b.y + 6} width={b.w * 0.35} height={b.h * 0.25} rx={2} fill="#00D1FF" opacity={0.12} />
        </G>
      ))}

      <Path d={AI_TRACK_ROUTE} stroke="#1E40AF" strokeWidth={18} strokeLinecap="round" fill="none" opacity={0.28} />
      <Path d={AI_TRACK_ROUTE} stroke="url(#routeGrad)" strokeWidth={14} strokeLinecap="round" fill="none" opacity={0.32} />
      <AnimatedPath d={AI_TRACK_ROUTE} stroke="url(#routeGrad)" strokeWidth={6} strokeLinecap="round" fill="none" animatedProps={routeProps} />
      <AnimatedPath d={AI_TRACK_ROUTE} stroke="#67E8F9" strokeWidth={2.5} strokeLinecap="round" fill="none" animatedProps={dashProps} />
      <Circle cx={210} cy={118} r={3} fill="#FFF" opacity={0.7} />
      <Circle cx={295} cy={95} r={4} fill="#67E8F9" opacity={0.95} />
      <Circle cx={380} cy={58} r={3} fill="#C084FC" opacity={0.8} />
      <Rect width={VB_W} height={VB_H} fill="url(#vig)" />
    </Svg>
  );
}

function Rider3D({
  riderSize,
  riderOffset,
}: {
  riderSize: number;
  riderOffset: number;
}) {
  const riderX = useSharedValue(0);
  const riderY = useSharedValue(0);
  const bob = useSharedValue(0);
  const pulse = useSharedValue(0);
  const trail = useSharedValue(0);

  useEffect(() => {
    riderX.value = withDelay(400, withTiming(1, { duration: 2600, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
    riderY.value = withDelay(400, withTiming(1, { duration: 2600, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
    bob.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }), -1, true);
    pulse.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }), -1, false);
    trail.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [riderX, riderY, bob, pulse, trail]);

  const riderStyle = useAnimatedStyle(() => ({
    left: `${interpolate(riderX.value, [0, 1], [10, 56])}%`,
    top: `${interpolate(riderY.value, [0, 1], [56, 36])}%`,
    marginLeft: -riderOffset,
    transform: [
      { translateY: interpolate(bob.value, [0, 1], [-3, -8]) },
      { scale: interpolate(riderX.value, [0, 1], [0.82, 1]) },
    ],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.8, 1.75]) }],
  }));

  const trailStyle = useAnimatedStyle(() => ({
    opacity: interpolate(trail.value, [0, 0.5, 1], [0, 0.85, 0]),
    transform: [{ translateX: interpolate(trail.value, [0, 1], [8, -16]) }],
  }));

  const badge = Math.round(riderSize * 0.28);

  return (
    <Animated.View style={[styles.riderPos, { width: riderSize + 8, height: riderSize + 8 }, riderStyle]}>
      <Animated.View style={[styles.trailLine, { width: riderSize * 0.36 }, trailStyle]} />
      <Animated.View
        style={[styles.riderPulse, { width: riderSize, height: riderSize, borderRadius: riderSize / 2 }, pulseStyle]}
      />
      <View
        style={[
          styles.riderShadow,
          { width: riderSize * 0.82, height: riderSize * 0.22, borderRadius: riderSize * 0.4 },
        ]}
      />
      <View style={styles.riderBody}>
        <View style={[styles.bikeBadge, { width: badge + 8, height: badge + 8, borderRadius: (badge + 8) / 2 }]}>
          <Bike size={badge * 0.55} color="#00D1FF" strokeWidth={2.5} />
        </View>
        <Image source={RIDER_IMG} style={{ width: riderSize, height: riderSize }} resizeMode="contain" />
      </View>
    </Animated.View>
  );
}

type Props = { height?: number };

export function AiLiveTrackingMap({ height }: Props) {
  const L = useTrackingLayout();
  const mapH = height ?? L.mapH;

  const routeProgress = useSharedValue(0);
  const dashOffset = useSharedValue(0);
  const shine = useSharedValue(0);
  const homeBob = useSharedValue(0);
  const pickupPing = useSharedValue(0);

  useEffect(() => {
    routeProgress.value = withTiming(1, { duration: 2000, easing: Easing.bezier(0.22, 1, 0.36, 1) });
    dashOffset.value = withRepeat(withTiming(-44, { duration: 1200, easing: Easing.linear }), -1, false);
    shine.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }), -1, true);
    homeBob.value = withRepeat(withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.ease) }), -1, true);
    pickupPing.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [routeProgress, dashOffset, shine, homeBob, pickupPing]);

  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.45, 1], [0, 1, 0]),
    transform: [{ translateX: interpolate(shine.value, [0, 1], [-L.contentW * 0.35, L.contentW * 0.35]) }],
  }));

  const homeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(homeBob.value, [0, 1], [0, -4]) }],
  }));

  const pickupRing = useAnimatedStyle(() => ({
    opacity: interpolate(pickupPing.value, [0, 1], [0.5, 0]),
    transform: [{ scale: interpolate(pickupPing.value, [0, 1], [1, 1.45]) }],
  }));

  const chipStyle = {
    paddingHorizontal: L.chipPadW,
    paddingVertical: L.chipPadH,
  };

  return (
    <View style={[styles.root, { height: mapH, width: "100%" }]}>
      <LinearGradient
        colors={["#060912", "#0C1224", "#121A32", "#0A0E1A"]}
        locations={[0, 0.38, 0.72, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(30,41,120,0.5)", "transparent", "rgba(88,28,135,0.28)"]}
        start={{ x: 0.25, y: 0.15 }}
        end={{ x: 0.9, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.svgWrap}>
        <MapSvg routeProgress={routeProgress} dashOffset={dashOffset} />
      </View>

      <Animated.View style={[styles.shine, shineStyle]} pointerEvents="none">
        <LinearGradient
          colors={["transparent", "rgba(255,255,255,0.1)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Pickup */}
      <View style={[styles.pinCol, { left: PICKUP.left, top: PICKUP.top, maxWidth: L.isCompact ? "38%" : "42%" }]}>
        <GlassChip compact={L.isCompact} style={[chipStyle, styles.pinChip]}>
          <Text style={[styles.pinLbl, { fontSize: L.chipFont }]} numberOfLines={1}>
            {L.isCompact ? "Pickup" : "You · Pickup"}
          </Text>
        </GlassChip>
        <View style={[styles.pickupDot, { width: L.pinSize, height: L.pinSize }]}>
          <Animated.View
            style={[
              styles.pickupPing,
              { width: L.pinSize, height: L.pinSize, borderRadius: L.pinSize / 2 },
              pickupRing,
            ]}
          />
          <View style={[styles.pickupCore, { width: L.pinSize * 0.35, height: L.pinSize * 0.35, borderRadius: L.pinSize * 0.2 }]} />
        </View>
      </View>

      {/* Home */}
      <Animated.View
        style={[styles.pinCol, { left: HOME.left, top: HOME.top, maxWidth: "46%" }, homeStyle]}
      >
        <GlassChip compact={L.isCompact} style={[chipStyle, styles.homeChipRow]}>
          <Home size={L.isCompact ? 10 : 11} color="#00D1FF" strokeWidth={2.5} />
          <Text style={[styles.homeLbl, { fontSize: L.chipFontSm }]} numberOfLines={1}>
            Your home
          </Text>
        </GlassChip>
        <View
          style={[
            styles.homePin,
            { width: L.homePinSize, height: L.homePinSize, borderRadius: L.homePinSize / 2 },
          ]}
        >
          <MapPin size={L.homePinSize * 0.5} color="#00D1FF" fill="#00D1FF" />
        </View>
      </Animated.View>

      <Rider3D riderSize={L.riderSize} riderOffset={L.riderOffset} />

      <GlassChip style={[styles.liveChip, chipStyle, { maxWidth: L.isCompact ? "68%" : "78%" }]}>
        <Radio size={L.isCompact ? 10 : 12} color="#4ADE80" />
        <LiveDot />
        <Text style={[styles.liveTxt, { fontSize: L.liveFont }]} numberOfLines={1}>
          {L.isCompact ? "LIVE" : "LIVE · 4K"}
        </Text>
      </GlassChip>

      <GlassChip style={[styles.kmChip, chipStyle]}>
        <Text style={[styles.kmLbl, { fontSize: L.chipFont }]}>REMAINING</Text>
        <Text style={[styles.kmVal, { fontSize: L.kmFont }]}>2.4 km</Text>
      </GlassChip>

      {/* Map ETA pill — website overlay */}
      <GlassChip style={[styles.mapEtaChip, chipStyle]}>
        <Text style={[styles.mapEtaLbl, { fontSize: L.chipFont }]}>ETA</Text>
        <Text style={[styles.mapEtaVal, { fontSize: L.chipFontSm + 4 }]}>12 min</Text>
      </GlassChip>
    </View>
  );
}

function LiveDot() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [p]);
  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [1, 0.35]),
    transform: [{ scale: interpolate(p.value, [0, 1], [1, 1.8]) }],
  }));
  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.livePing, s]} />
      <View style={styles.liveCore} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden", backgroundColor: "#060912", position: "relative" },
  svgWrap: { ...StyleSheet.absoluteFillObject },
  shine: { position: "absolute", top: 0, bottom: 0, left: "15%", width: "45%", zIndex: 2 },
  glass: {
    backgroundColor: "rgba(14, 18, 36, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  glassCompact: { borderRadius: 10 },
  liveChip: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveDotWrap: { width: 8, height: 8, alignItems: "center", justifyContent: "center" },
  livePing: { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" },
  liveCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#4ADE80" },
  liveTxt: { fontWeight: "800", color: "#FFF", letterSpacing: 0.6 },
  kmChip: { position: "absolute", bottom: 8, left: 8, zIndex: 20 },
  kmLbl: { fontWeight: "800", color: "rgba(255,255,255,0.45)", letterSpacing: 1 },
  kmVal: { fontWeight: "800", color: "#00D1FF", letterSpacing: -0.3, marginTop: 1 },
  mapEtaChip: {
    position: "absolute",
    bottom: 8,
    right: 8,
    zIndex: 20,
    alignItems: "flex-end",
  },
  mapEtaLbl: { fontWeight: "800", color: "rgba(255,255,255,0.45)", letterSpacing: 1 },
  mapEtaVal: { fontWeight: "800", color: "#4ADE80", marginTop: 1 },
  pinCol: { position: "absolute", zIndex: 18, alignItems: "center" },
  pinChip: { marginBottom: 5 },
  pinLbl: { fontWeight: "700", color: "rgba(255,255,255,0.92)" },
  pickupDot: { alignItems: "center", justifyContent: "center" },
  pickupPing: { position: "absolute", borderWidth: 1.5, borderColor: "rgba(96,165,250,0.45)" },
  pickupCore: { backgroundColor: "#93C5FD", borderWidth: 2, borderColor: "#60A5FA" },
  homeChipRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 5 },
  homeLbl: { fontWeight: "700", color: "#FFF", flexShrink: 1 },
  homePin: {
    borderWidth: 2,
    borderColor: "rgba(0,209,255,0.65)",
    backgroundColor: "rgba(0,209,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00D1FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  riderPos: { position: "absolute", zIndex: 20, alignItems: "center" },
  trailLine: {
    position: "absolute",
    right: "100%",
    top: "42%",
    height: 3,
    borderRadius: 2,
    backgroundColor: "#00D1FF",
    opacity: 0.55,
  },
  riderPulse: { position: "absolute", backgroundColor: "rgba(0,209,255,0.22)" },
  riderShadow: {
    position: "absolute",
    bottom: 2,
    backgroundColor: "rgba(0,209,255,0.4)",
    opacity: 0.55,
    transform: [{ scaleY: 0.35 }],
  },
  riderBody: { alignItems: "center", justifyContent: "flex-end" },
  bikeBadge: {
    position: "absolute",
    left: 2,
    top: 4,
    zIndex: 3,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(0,209,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
});

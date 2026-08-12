import React, { useEffect } from "react";
import { View, Text, StyleSheet, Image, ScrollView, Dimensions } from "react-native";
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Clock, Home, Zap, User, ArrowRight } from "lucide-react-native";
import { getServicePhoto } from "@/lib/service-photos";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";
import { useServicesTheme } from "./ServicesThemeContext";
import { serviceType, fontFamily } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import { useRouter } from "expo-router";

function ExpressInnerHeader() {
  const { c, layout: L } = useServicesTheme();

  return (
    <View style={styles.innerHeader}>
      <View style={styles.innerHeaderText}>
        <View style={styles.overlineRow}>
          <Text style={[styles.overline, { color: c.accentPurple }]}>URGENT</Text>
          <View style={styles.expressChip}>
            <Zap size={10} color="#FBBF24" fill="#FBBF24" strokeWidth={2} />
            <Text style={styles.expressChipText}>EXPRESS</Text>
          </View>
        </View>
        <Text
          style={[
            styles.innerTitle,
            { fontSize: L.isCompact ? 18 : 20, lineHeight: L.isCompact ? 24 : 26 },
          ]}
        >
          Express in 20 minutes
        </Text>
        <Text style={styles.innerSubtitle}>On-demand pros for emergencies</Text>
      </View>
      <LinearGradient
        colors={["#FBBF24", "#F59E0B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.timerBadge}
      >
        <Text style={styles.timerNum}>20</Text>
        <Text style={styles.timerUnit}>MIN</Text>
      </LinearGradient>
    </View>
  );
}

function ExpressServiceCard({
  icon,
  name,
  price,
  iconBg,
  serviceId,
  index,
  cardMinH,
  iconSize,
}: {
  icon: string;
  name: string;
  price: number;
  iconBg: string;
  serviceId: string;
  index: number;
  cardMinH: number;
  iconSize: number;
}) {
  const { book } = useServicesActions();
  const photo = getServicePhoto(name);

  return (
    <Animated.View entering={FadeIn.delay(index * 90).duration(400)} style={styles.cardCol}>
      <PressableScale
        haptic
        scaleTo={0.95}
        style={[styles.expressCard, { minHeight: cardMinH }]}
        onPress={() => book({ service: serviceId })}
      >
        {/* branded photo or gradient icon — premium visual */}
        <View style={styles.exVisual}>
          {photo ? (
            <Image source={photo.photo} style={styles.exPhoto} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={["#10b981", "#0d9488"]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.exPhoto}
            >
              <Text style={{ fontSize: iconSize * 0.5 }}>{icon}</Text>
            </LinearGradient>
          )}
          {/* express badge on the visual */}
          <View style={styles.exBadge}>
            <Zap size={8.5} color="#04140d" fill="#04140d" />
            <Text style={styles.exBadgeText}>20 MIN</Text>
          </View>
        </View>

        <Text style={styles.svcName} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.exFooter}>
          <Text style={styles.svcPrice}>From ₹{price}</Text>
          <View style={styles.exArrow}>
            <ArrowRight size={12} color="#04140d" strokeWidth={2.8} />
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function TrackingPreview({
  onPress,
  hasLive,
  etaMin,
}: {
  onPress: () => void;
  hasLive: boolean;
  etaMin: number | null;
}) {
  const { c, layout: L } = useServicesTheme();
  const progress = useSharedValue(0);
  const node = L.isCompact ? 28 : 32;
  const trackPad = L.isCompact ? 10 : 12;

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * L.expressTrackTravel }],
  }));

  return (
    <PressableScale haptic scaleTo={0.99} onPress={onPress} style={styles.trackBox}>
      <View style={styles.trackHeader}>
        <View style={styles.trackHeaderLeft}>
          <Text style={styles.trackTitle}>{hasLive ? "Your pro is on the way" : "Live tracking"}</Text>
          <Text style={styles.trackSub}>
            {hasLive ? "Tap to open the live map" : "Real-time map on every booking"}
          </Text>
        </View>
        <View style={[styles.livePill, hasLive ? null : { opacity: 0.7 }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>{hasLive ? "LIVE" : "PREVIEW"}</Text>
        </View>
      </View>

      <View style={[styles.pathRow, { height: node + 16 }]}>
        <View
          style={[
            styles.pathNode,
            {
              width: node,
              height: node,
              borderRadius: node / 2,
              backgroundColor: c.primary,
            },
          ]}
        >
          <Home size={node * 0.44} color="#fff" strokeWidth={2.2} />
        </View>

        <View style={[styles.trackMid, { marginHorizontal: trackPad }]}>
          <View style={styles.trackLine} />
          <Animated.View
            style={[
              styles.movingDot,
              { backgroundColor: c.accentPurple },
              dotStyle,
            ]}
          />
        </View>

        <View style={[styles.pathNode, styles.pathNodeEnd]}>
          <View
            style={[
              styles.pulseRing,
              { width: node + 6, height: node + 6, borderRadius: (node + 6) / 2 },
            ]}
          />
          <View
            style={[
              styles.pathNode,
              {
                width: node,
                height: node,
                borderRadius: node / 2,
                backgroundColor: "#fff",
              },
            ]}
          >
            <User size={node * 0.44} color={c.primary} strokeWidth={2.2} />
          </View>
        </View>
      </View>

      <View style={styles.etaRow}>
        <Text style={styles.etaLabel}>Expert arriving in</Text>
        <Text style={styles.etaValue}>{hasLive && etaMin != null ? `${etaMin} mins` : "~12 mins"}</Text>
      </View>
    </PressableScale>
  );
}

export function ExpressServices() {
  const { book, openBookings } = useServicesActions();
  const { c, shadows, layout: L } = useServicesTheme();
  const { expressServices } = useServicesDiscovery();
  const router = useRouter();
  // Real live tracking — if a booking is active, the preview shows its ETA and
  // opens the full-screen Uber-style map; otherwise it stays a preview.
  const { activeBooking, tracking } = useActiveTracking();
  const hasLive = !!activeBooking;
  const etaMin = (tracking as { eta?: number } | undefined)?.eta != null
    ? Math.round((tracking as { eta: number }).eta)
    : null;
  const openTracking = () => {
    if (activeBooking?.id) router.push(`/track/${activeBooking.id}` as never);
    else openBookings();
  };
  const cardMinH = L.isCompact ? 124 : 136;
  const iconSize = L.isCompact ? 40 : 44;
  const innerPad = L.isCompact ? 16 : 20;

  return (
    <Animated.View entering={FadeInUp.duration(550)} style={{ paddingHorizontal: L.pad }}>
      <LinearGradient
        colors={[c.darkBg, c.expressMid, c.darkBgEnd]}
        locations={[0, 0.45, 1]}
        style={[styles.container, shadows.deep, { padding: innerPad }]}
      >
        <View style={styles.topGlow} pointerEvents="none" />

        <ExpressInnerHeader />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={[styles.cardsRow, { paddingHorizontal: innerPad }]}
          style={{ marginTop: 18, marginHorizontal: -innerPad }}
        >
          {expressServices.map((svc, i) => (
            <ExpressServiceCard
              key={svc.name}
              icon={svc.icon}
              name={svc.name}
              price={svc.price}
              iconBg={svc.iconBg}
              serviceId={svc.serviceId}
              index={i}
              cardMinH={cardMinH}
              iconSize={iconSize}
            />
          ))}
        </ScrollView>

        <View style={styles.divider} />

        <TrackingPreview onPress={openTracking} hasLive={hasLive} etaMin={etaMin} />
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: layout.cardRadiusLg,
    overflow: "hidden",
  },
  topGlow: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(52, 211, 153, 0.32)",
    opacity: 0.5,
  },
  innerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  innerHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  overlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  overline: {
    ...serviceType.overline,
    fontSize: 9,
    letterSpacing: 1.4,
    color: "#2dd4bf",
  },
  expressChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(251, 191, 36, 0.14)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.28)",
  },
  expressChipText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: "#FBBF24",
  },
  innerTitle: {
    fontFamily: fontFamily.semiBold,
    color: "#FFFFFF",
    letterSpacing: -0.35,
  },
  innerSubtitle: {
    ...serviceType.sectionSubtitle,
    color: "rgba(255,255,255,0.58)",
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  timerBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  timerNum: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 22,
    color: "#1A0B3B",
    letterSpacing: -0.5,
  },
  timerUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 8,
    lineHeight: 10,
    color: "#1A0B3B",
    letterSpacing: 1.2,
    marginTop: -2,
  },
  cardsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  cardCol: {
    width: Dimensions.get("window").width * 0.44,
  },
  expressCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 20,
    padding: 8,
    paddingBottom: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "flex-start",
  },
  exVisual: {
    width: "100%",
    aspectRatio: 1.5,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  exPhoto: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  exBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fbbf24",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  exBadgeText: { fontSize: 8, fontWeight: "900", color: "#04140d", letterSpacing: 0.4 },
  iconCircle: { alignItems: "center", justifyContent: "center" },
  iconEmoji: { textAlign: "center" },
  svcName: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
    letterSpacing: -0.2,
    lineHeight: 18,
    marginTop: 10,
    paddingHorizontal: 3,
    width: "100%",
    minHeight: 36,
  },
  exFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 6,
    paddingHorizontal: 3,
  },
  exArrow: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
  },
  svcPrice: {
    ...serviceType.captionSm,
    color: "#6ee7b7",
    fontWeight: "800",
  },
  cardSpacer: {
    flexGrow: 1,
    minHeight: 6,
  },
  arrivalPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.22)",
  },
  arrivalText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9,
    letterSpacing: 0.2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginVertical: 18,
  },
  trackBox: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: layout.cardRadiusSm,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  trackHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  trackHeaderLeft: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    ...serviceType.cardTitleSm,
    color: "#fff",
    fontSize: 14,
  },
  trackSub: {
    ...serviceType.caption,
    color: "rgba(255,255,255,0.48)",
    marginTop: 2,
    fontSize: 11,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.35)",
    flexShrink: 0,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#F87171",
  },
  liveText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: "#FCA5A5",
  },
  pathRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },
  pathNode: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pathNodeEnd: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(52, 211, 153, 0.5)",
    opacity: 0.7,
  },
  trackMid: {
    flex: 1,
    justifyContent: "center",
    position: "relative",
    minWidth: 0,
    alignSelf: "stretch",
  },
  trackLine: {
    height: 2,
    borderRadius: 1,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  movingDot: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fff",
    zIndex: 2,
  },
  etaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  etaLabel: {
    ...serviceType.caption,
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
  },
  etaValue: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 26,
    color: "#fff",
    letterSpacing: -0.5,
  },
});

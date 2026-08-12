import React, { Fragment } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Navigation2 } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useAiTheme, aiSpacing, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { useTrackingLayout } from "@/lib/tracking-layout";
import { useLiveTrackingView } from "@/hooks/use-live-tracking-view";
import { HomeLiveMap } from "@/components/track/HomeLiveMap";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";

/** Progress is derived from the booking's real status — never assumed. */
function stepsFor(status: string): { label: string; done: boolean }[] {
  const onTheWay = status === "in_progress";
  return [
    { label: "Confirmed", done: true },
    { label: "On the way", done: onTheWay },
    { label: "Arriving", done: false },
  ];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function AiBookingBlock() {
  const router = useRouter();
  const { c, isDark } = useAiTheme();
  const L = useTrackingLayout();
  // Same derivation the home Live Tracking card uses, so the two surfaces can
  // never disagree about where the professional is.
  const {
    activeBooking,
    connected,
    provider,
    destination,
    region,
    routePoints,
    bearing,
    enRoute,
    distanceKm,
    etaMin,
    isRealPosition,
  } = useLiveTrackingView();

  // No live booking means there is nothing truthful to show. Previously this card
  // rendered a fabricated pro, ETA and route for every user — the card is now
  // simply absent until real booking data exists.
  if (!activeBooking) return null;

  const proName = activeBooking.proName?.trim() || "Your professional";
  const steps = stepsFor(activeBooking.status);
  const onTheWay = activeBooking.status === "in_progress";
  // Distance/ETA are only shown once the provider's real position has arrived over
  // the tracking socket — before that the numbers would describe a placeholder.
  const eta = isRealPosition ? etaMin : null;
  const km = isRealPosition ? distanceKm : null;

  const onWayBadge = (
    <View style={styles.onWayBadge}>
      <View style={styles.onWayDot} />
      <Text style={styles.onWayTxt}>{onTheWay ? "On the way" : "Confirmed"}</Text>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <SectionTitle
        noInset
        title={onTheWay ? "Your professional is on the way" : "Your booking is confirmed"}
        subtitle={activeBooking.serviceTitle}
        right={onWayBadge}
      />

      <Pressable
        onPress={() => router.push(`/track/${activeBooking.id}` as never)}
        style={{ width: "100%" }}
        accessibilityRole="button"
        accessibilityLabel={`${activeBooking.serviceTitle} with ${proName}. Open live tracking.`}
      >
        <View
          style={[
            styles.shell,
            {
              borderRadius: L.shellRadius,
              borderColor: isDark ? "rgba(16, 185, 129,0.3)" : "rgba(16, 185, 129,0.2)",
              backgroundColor: isDark ? "#06140e" : "#f0fdf4",
            },
            aiCardShadow("#10b981", "hero"),
          ]}
        >
          <LinearGradient
            colors={["#2dd4bf", "#10b981", "#34d399", "#2dd4bf"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topBar}
          />

          {/* Real Google map on the real road route — same component and same
              backend feed as the home card and the full tracking screen. */}
          <View
            style={{ height: L.mapH }}
            accessible
            accessibilityLabel={
              isRealPosition
                ? `Live map: ${proName} is ${distanceKm.toFixed(1)} kilometres away`
                : "Live map, waiting for your professional's position"
            }
          >
            <HomeLiveMap
              provider={provider}
              destination={destination}
              region={region}
              height={L.mapH}
              routePoints={routePoints}
              bearing={bearing}
              follow={connected && enRoute}
            />
            <View
              pointerEvents="none"
              style={[
                styles.mapTag,
                { backgroundColor: connected ? "rgba(16,185,129,0.94)" : "rgba(4,20,13,0.75)" },
              ]}
            >
              <Text style={styles.mapTagTxt}>{connected ? "LIVE MAP" : "RECONNECTING"}</Text>
            </View>
          </View>

          <View
            style={[
              styles.details,
              {
                paddingHorizontal: L.detailsPad,
                borderTopColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)",
              },
            ]}
          >
            {onTheWay ? (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={[styles.liveLbl, { fontSize: L.chipFont }]}>Service in progress</Text>
              </View>
            ) : null}

            <View style={styles.expertRow}>
              {/* Initials, not a stock portrait: we know the pro's name, not their face. */}
              <View
                style={[
                  styles.avatarWrap,
                  styles.avatarInitials,
                  {
                    width: L.avatarSize,
                    height: L.avatarSize,
                    borderRadius: L.avatarSize * 0.28,
                  },
                ]}
              >
                <Text style={[styles.avatarInitialsTxt, { fontSize: L.avatarSize * 0.36 }]}>
                  {initialsOf(proName)}
                </Text>
              </View>
              <View style={styles.expertMeta}>
                <Text style={[styles.expertName, { color: c.text, fontSize: L.expertName }]} numberOfLines={1}>
                  {proName}
                </Text>
                <Text
                  style={[styles.ratingTxt, { color: c.muted, fontSize: L.chipFontSm }]}
                  numberOfLines={1}
                >
                  {activeBooking.serviceTitle}
                </Text>
                <Text
                  style={[styles.bikeTxt, { color: c.subtle, fontSize: L.chipFont }]}
                  numberOfLines={1}
                >
                  {activeBooking.dateLabel} · {activeBooking.timeLabel}
                </Text>
              </View>
            </View>

            {/* ETA comes from the live tracking feed; an em dash when it has not
                arrived yet, never an invented number. */}
            <View style={styles.etaBlock}>
              <Text style={[styles.etaLbl, { color: c.subtle, fontSize: L.chipFont }]}>
                {eta != null ? "Arriving in" : "Live ETA"}
              </Text>
              <View style={styles.etaRow}>
                <Text style={[styles.etaBig, { color: c.text, fontSize: L.etaBig, lineHeight: L.etaBig + 4 }]}>
                  {eta != null ? eta : "—"}
                </Text>
                {eta != null ? (
                  <Text style={[styles.etaUnit, { color: c.muted, fontSize: L.etaUnit }]}>mins</Text>
                ) : null}
              </View>
              <Text
                style={[styles.locTxt, { color: c.subtle, fontSize: L.chipFont }]}
                numberOfLines={1}
              >
                {km != null
                  ? `${km.toFixed(1)} km away · ${connected ? "updating live" : "reconnecting"}`
                  : "Waiting for live updates"}
              </Text>
            </View>

            <View style={styles.stepsRow}>
              {steps.map((s, i) => (
                <Fragment key={s.label}>
                  <View style={[styles.stepCol, { minWidth: L.isCompact ? 52 : 58 }]}>
                    {s.done ? (
                      <LinearGradient
                        colors={["#2dd4bf", "#10b981"]}
                        style={[styles.stepDone, { width: L.isCompact ? 26 : 30, height: L.isCompact ? 26 : 30, borderRadius: 15 }]}
                      >
                        <Check size={L.isCompact ? 12 : 14} color="#FFF" strokeWidth={3} />
                      </LinearGradient>
                    ) : (
                      <View
                        style={[
                          styles.stepPending,
                          {
                            width: L.isCompact ? 26 : 30,
                            height: L.isCompact ? 26 : 30,
                            borderRadius: 15,
                            borderColor: c.cardBorder,
                          },
                        ]}
                      />
                    )}
                    <Text
                      style={[
                        styles.stepLbl,
                        { color: s.done ? c.accent : c.subtle, fontSize: L.isCompact ? 8 : 10 },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {s.label}
                    </Text>
                  </View>
                  {i < steps.length - 1 ? (
                    <View style={[styles.stepLine, (steps[i + 1]!.done || s.done) && styles.stepLineDone]} />
                  ) : null}
                </Fragment>
              ))}
            </View>

            {/* Was a dead "Call expert" button — the app holds no phone number for
                the pro. This opens the real live-tracking screen instead. */}
            <PressableScale
              onPress={() => router.push(`/track/${activeBooking.id}` as never)}
              style={styles.callBtn}
              haptic
              accessibilityRole="button"
              accessibilityLabel={`Track ${proName} on the live map`}
            >
              <LinearGradient colors={["#10b981", "#0d9488"]} style={[styles.callGrad, { height: L.isCompact ? 44 : 48 }]}>
                <Navigation2 size={L.isCompact ? 16 : 17} color="#FFF" strokeWidth={2.6} />
                <Text style={[styles.callTxt, { fontSize: L.isCompact ? 13 : 14 }]}>Track live</Text>
              </LinearGradient>
            </PressableScale>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: aiSpacing.section,
    paddingHorizontal: aiSpacing.screen,
    width: "100%",
    alignSelf: "stretch",
  },
  onWayBadge: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(74,222,128,0.14)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.38)",
  },
  onWayDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#4ADE80" },
  onWayTxt: {
    fontSize: 9,
    fontWeight: "800",
    color: "#4ADE80",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  shell: {
    width: "100%",
    borderWidth: 1,
    overflow: "hidden",
  },
  topBar: { height: 3, width: "100%" },
  details: {
    borderTopWidth: 1,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 12,
    width: "100%",
  },
  livePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(74,222,128,0.1)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.32)",
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" },
  liveLbl: { fontWeight: "800", color: "#4ADE80", letterSpacing: 0.5, textTransform: "uppercase" },
  expertRow: { flexDirection: "row", gap: 11, alignItems: "center", width: "100%" },
  avatarWrap: {
    flexShrink: 0,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(16, 185, 129,0.45)",
    backgroundColor: "#0a2018",
  },
  avatarInitials: { alignItems: "center", justifyContent: "center" },
  avatarInitialsTxt: { color: "#6ee7b7", fontWeight: "800", letterSpacing: 0.5 },
  expertMeta: { flex: 1, minWidth: 0 },
  expertName: { fontWeight: "800", letterSpacing: -0.3 },
  ratingTxt: { fontWeight: "600", flexShrink: 1, marginTop: 3 },
  bikeTxt: { fontWeight: "700", flexShrink: 1, marginTop: 5 },
  etaBlock: { gap: 3, width: "100%" },
  etaLbl: { fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  etaRow: { flexDirection: "row", alignItems: "baseline" },
  etaBig: { fontWeight: "800", letterSpacing: -2 },
  etaUnit: { fontWeight: "700", marginLeft: 3 },
  locTxt: { fontWeight: "600", flexShrink: 1, marginTop: 6 },
  mapTag: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  mapTagTxt: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  stepsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    width: "100%",
    marginTop: 2,
  },
  stepCol: { alignItems: "center", gap: 5, flex: 0 },
  stepDone: { alignItems: "center", justifyContent: "center" },
  stepPending: { borderWidth: 2, backgroundColor: "transparent" },
  stepLbl: { fontWeight: "700", textAlign: "center", maxWidth: 72 },
  stepLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(148,163,184,0.22)",
    marginTop: 13,
    marginHorizontal: 1,
    minWidth: 8,
  },
  stepLineDone: { backgroundColor: "#10b981" },
  callBtn: { width: "100%", marginTop: 2 },
  callGrad: {
    borderRadius: aiRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  },
  callTxt: { fontWeight: "700", color: "#FFF" },
});

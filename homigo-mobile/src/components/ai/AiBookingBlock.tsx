import React, { Fragment } from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Bike, Check, MapPin, Navigation2, Phone, Star } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useAiTheme, aiSpacing, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { useTrackingLayout } from "@/lib/tracking-layout";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";
import { AiLiveTrackingMap } from "./AiLiveTrackingMap";

const EXPERT =
  "https://api.dicebear.com/7.x/avataaars/png?seed=rahul&size=128&backgroundColor=1a2744";

const STEPS = [
  { label: "Confirmed", done: true },
  { label: "On the way", done: true },
  { label: "Arriving", done: false },
];

export function AiBookingBlock() {
  const router = useRouter();
  const { c, isDark } = useAiTheme();
  const L = useTrackingLayout();

  const onWayBadge = (
    <View style={styles.onWayBadge}>
      <View style={styles.onWayDot} />
      <Text style={styles.onWayTxt}>On the way</Text>
    </View>
  );

  return (
    <View style={styles.wrap}>
      <SectionTitle
        noInset
        title="Your Booking is Confirmed"
        subtitle="Live tracking · Expert on route"
        right={onWayBadge}
      />

      <Pressable onPress={() => router.push("/(tabs)/bookings")} style={{ width: "100%" }}>
        <View
          style={[
            styles.shell,
            {
              borderRadius: L.shellRadius,
              borderColor: isDark ? "rgba(123,97,255,0.3)" : "rgba(123,97,255,0.2)",
              backgroundColor: isDark ? "#0a0e1c" : "#f8fafc",
            },
            aiCardShadow("#7B61FF", "hero"),
          ]}
        >
          <LinearGradient
            colors={["#00D1FF", "#7B61FF", "#A855F7", "#00D1FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topBar}
          />

          <AiLiveTrackingMap height={L.mapH} />

          <View
            style={[
              styles.details,
              {
                paddingHorizontal: L.detailsPad,
                borderTopColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)",
              },
            ]}
          >
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={[styles.liveLbl, { fontSize: L.chipFont }]}>Service in progress</Text>
            </View>

            <View style={styles.expertRow}>
              <View
                style={[
                  styles.avatarWrap,
                  {
                    width: L.avatarSize,
                    height: L.avatarSize,
                    borderRadius: L.avatarSize * 0.28,
                  },
                ]}
              >
                <Image source={{ uri: EXPERT }} style={styles.avatar} />
              </View>
              <View style={styles.expertMeta}>
                <Text style={[styles.expertName, { color: c.text, fontSize: L.expertName }]} numberOfLines={1}>
                  Rahul Kumar
                </Text>
                <View style={styles.ratingRow}>
                  <Star size={L.isCompact ? 10 : 12} fill="#FBBF24" color="#FBBF24" />
                  <Text style={[styles.ratingTxt, { color: c.muted, fontSize: L.chipFontSm }]} numberOfLines={1}>
                    4.9 · AC Repair Expert
                  </Text>
                </View>
                <View style={styles.bikeRow}>
                  <Bike size={L.isCompact ? 11 : 13} color="#00D1FF" strokeWidth={2.5} />
                  <Text style={[styles.bikeTxt, { color: c.subtle, fontSize: L.chipFont }]} numberOfLines={1}>
                    Bike · HOMIGO Express
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.etaBlock}>
              <Text style={[styles.etaLbl, { color: c.subtle, fontSize: L.chipFont }]}>Arriving in</Text>
              <View style={styles.etaRow}>
                <Text style={[styles.etaBig, { color: c.text, fontSize: L.etaBig, lineHeight: L.etaBig + 4 }]}>
                  12
                </Text>
                <Text style={[styles.etaUnit, { color: c.muted, fontSize: L.etaUnit }]}>mins</Text>
              </View>
              <View style={[styles.locRow, L.isCompact && styles.locRowCompact]}>
                <View
                  style={[
                    styles.locChip,
                    { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)" },
                  ]}
                >
                  <MapPin size={10} color="#7B61FF" />
                  <Text style={[styles.locTxt, { color: c.muted, fontSize: L.chipFont }]} numberOfLines={1}>
                    Sector 12
                  </Text>
                </View>
                {!L.isCompact && <Navigation2 size={11} color={c.faint} />}
                <View
                  style={[
                    styles.locChip,
                    { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)" },
                  ]}
                >
                  <MapPin size={10} color="#00D1FF" />
                  <Text style={[styles.locTxt, { color: c.muted, fontSize: L.chipFont }]} numberOfLines={1}>
                    Indiranagar
                  </Text>
                </View>
                <Text style={[styles.kmSep, { color: c.faint, fontSize: L.chipFont }]}>· 2.4 km</Text>
              </View>
            </View>

            <View style={styles.stepsRow}>
              {STEPS.map((s, i) => (
                <Fragment key={s.label}>
                  <View style={[styles.stepCol, { minWidth: L.isCompact ? 52 : 58 }]}>
                    {s.done ? (
                      <LinearGradient
                        colors={["#00D1FF", "#7B61FF"]}
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
                  {i < STEPS.length - 1 ? (
                    <View style={[styles.stepLine, (STEPS[i + 1].done || s.done) && styles.stepLineDone]} />
                  ) : null}
                </Fragment>
              ))}
            </View>

            <PressableScale onPress={() => {}} style={styles.callBtn} haptic>
              <LinearGradient colors={["#22C55E", "#16A34A"]} style={[styles.callGrad, { height: L.isCompact ? 44 : 48 }]}>
                <Phone size={L.isCompact ? 16 : 17} color="#FFF" strokeWidth={2.6} />
                <Text style={[styles.callTxt, { fontSize: L.isCompact ? 13 : 14 }]}>Call expert</Text>
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
    borderColor: "rgba(123,97,255,0.45)",
    backgroundColor: "#1a2744",
  },
  avatar: { width: "100%", height: "100%" },
  expertMeta: { flex: 1, minWidth: 0 },
  expertName: { fontWeight: "800", letterSpacing: -0.3 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, flexWrap: "wrap" },
  ratingTxt: { fontWeight: "600", flexShrink: 1 },
  bikeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 7,
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0,209,255,0.28)",
    backgroundColor: "rgba(0,209,255,0.08)",
  },
  bikeTxt: { fontWeight: "700", flexShrink: 1 },
  etaBlock: { gap: 3, width: "100%" },
  etaLbl: { fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  etaRow: { flexDirection: "row", alignItems: "baseline" },
  etaBig: { fontWeight: "800", letterSpacing: -2 },
  etaUnit: { fontWeight: "700", marginLeft: 3 },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 6,
    width: "100%",
  },
  locRowCompact: { gap: 4 },
  locChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: "46%",
  },
  locTxt: { fontWeight: "600", flexShrink: 1 },
  kmSep: { fontWeight: "600" },
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
  stepLineDone: { backgroundColor: "#7B61FF" },
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

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Image, Linking, StyleSheet, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, MessageSquare, Star, Check, ShieldCheck, Navigation2 } from "lucide-react-native";
import { coreApi } from "@/services/core/api";
import { parityApi } from "@/services/core/parity-api";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { useAuthStore } from "@/stores/auth-store";
import { getApiBaseUrl, toWsBase } from "@/lib/api-config";
import { reportUxSignal } from "@/lib/observability/telemetry";
import { decodePolyline } from "@/lib/polyline";
import { toJourneyStage, STAGE_ORDER, RAIL_STEPS } from "@/lib/journey-stage";
import { HomeLiveMap, type LatLng } from "@/components/track/HomeLiveMap";
import { ServiceStartPinCard } from "@/components/track/ServiceStartPinCard";

const { height } = Dimensions.get("window");

function compass(a: LatLng, b: LatLng): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x =
    Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/**
 * Full-screen Uber/Rapido-style live tracking. Big real Google map with the
 * heading-rotated bike marker + real road route, a floating back button, and a
 * premium bottom sheet: stage, ETA/distance/heading, partner card, call/chat.
 * All REAL shared-backend data (WS + /api/tracking + /api/geo/route).
 */
export default function TrackBookingScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const router = useRouter();
  const token = useAuthStore((s) => s.accessToken);
  const [live, setLive] = useState<{
    lat?: number;
    lng?: number;
    eta?: number;
    distance?: number;
    status?: string;
    bearing?: number;
    speed?: number;
  }>({});

  const bookingQ = useQuery({
    queryKey: ["booking", bookingId],
    queryFn: () => coreApi.bookings.byId(bookingId),
    enabled: !!bookingId && !!token,
  });

  const wsBase = toWsBase(getApiBaseUrl());
  const ws = useRealtimeChannel({
    url: bookingId && token ? `${wsBase}/ws/tracking/${bookingId}?token=${encodeURIComponent(token)}` : null,
    enabled: !!bookingId && !!token,
    onMessage: (data) => {
      try {
        const raw = JSON.parse(data) as Record<string, unknown> & { data?: Record<string, unknown> };
        const p = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, number | string | undefined>;
        setLive((prev) => ({
          lat: (p.providerLatitude ?? p.latitude ?? prev.lat) as number | undefined,
          lng: (p.providerLongitude ?? p.longitude ?? prev.lng) as number | undefined,
          eta: (p.eta ?? prev.eta) as number | undefined,
          distance: (p.distance ?? prev.distance) as number | undefined,
          status: (p.status ?? prev.status) as string | undefined,
          bearing: (p.bearing ?? prev.bearing) as number | undefined,
          speed: (p.speed ?? prev.speed) as number | undefined,
        }));
      } catch {
        /* ignore malformed frame */
      }
    },
  });

  const trackingQ = useQuery({
    queryKey: ["tracking", bookingId],
    queryFn: () => coreApi.tracking.get(bookingId),
    enabled: !!bookingId && !!token,
    refetchInterval: ws.connected ? false : 20_000,
    retry: false,
  });

  useEffect(() => {
    reportUxSignal("nav_success", "track");
  }, []);

  const tracking = trackingQ.data?.tracking;
  const booking = bookingQ.data?.booking as
    | {
        address?: { latitude?: number; longitude?: number };
        provider?: { name?: string; rating?: number; profileImage?: string | null; phoneNumber?: string | null };
        serviceName?: string;
        service?: { name?: string };
      }
    | undefined;

  const provider: LatLng | null = useMemo(() => {
    const lat = live.lat ?? tracking?.providerLatitude;
    const lng = live.lng ?? tracking?.providerLongitude;
    return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
  }, [live.lat, live.lng, tracking?.providerLatitude, tracking?.providerLongitude]);

  const destination: LatLng | null = useMemo(() => {
    const lat = booking?.address?.latitude;
    const lng = booking?.address?.longitude;
    return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
  }, [booking?.address?.latitude, booking?.address?.longitude]);

  // Real road route (polyline + traffic distance/duration) between the two points.
  const routeQ = useQuery({
    queryKey: [
      "geo-route",
      provider?.latitude?.toFixed(4),
      provider?.longitude?.toFixed(4),
      destination?.latitude?.toFixed(4),
      destination?.longitude?.toFixed(4),
    ],
    queryFn: () =>
      parityApi.geo.route(
        { lat: provider!.latitude, lng: provider!.longitude },
        { lat: destination!.latitude, lng: destination!.longitude },
      ),
    enabled: !!provider && !!destination,
    staleTime: 45_000,
    retry: 1,
  });
  const routePoints = useMemo(() => decodePolyline(routeQ.data?.polyline), [routeQ.data?.polyline]);

  const eta = live.eta ?? routeQ.data?.durationMin ?? tracking?.eta ?? null;
  const distanceKm = routeQ.data?.distanceKm ?? live.distance ?? tracking?.distance ?? null;
  const bearing = live.bearing ?? null;
  const speedKmh = live.speed != null ? Math.round(live.speed * 3.6) : null;
  const status = live.status ?? tracking?.status ?? booking?.service?.name;
  const stage = toJourneyStage(status);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const enRoute = stageIdx <= STAGE_ORDER.indexOf("EN_ROUTE");
  const heading = provider && destination ? compass(provider, destination) : "—";

  const pro = booking?.provider;
  const proName = pro?.name?.trim() || "Your professional";
  const serviceName = booking?.service?.name ?? booking?.serviceName ?? "Home service";

  const region = {
    latitude: provider?.latitude ?? destination?.latitude ?? 28.6139,
    longitude: provider?.longitude ?? destination?.longitude ?? 77.209,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  const stageLine =
    stage === "COMPLETED"
      ? "Service complete"
      : stage === "STARTED"
        ? "Service in progress"
        : stage === "ARRIVED"
          ? "Your professional has arrived"
          : provider
            ? `${proName} is on the way`
            : "Waiting for a professional";

  const callPro = () => {
    if (pro?.phoneNumber) Linking.openURL(`tel:${pro.phoneNumber}`).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      {/* Full-screen map */}
      {provider && destination ? (
        <HomeLiveMap
          provider={provider}
          destination={destination}
          region={region}
          height={height}
          routePoints={routePoints}
          interactive
          bearing={bearing}
          follow={ws.connected && enRoute}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.waiting]}>
          <Navigation2 size={30} color="#10b981" />
          <Text style={styles.waitingText}>Locating your professional…</Text>
        </View>
      )}

      {/* Floating back button (Uber-style) */}
      <SafeAreaView style={styles.topBar} edges={["top"]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color="#0f172a" strokeWidth={2.4} />
        </Pressable>
        {/* live connection tag */}
        <View style={[styles.liveTag, { backgroundColor: ws.connected ? "#10b981" : ws.reconnecting ? "#f59e0b" : "#64748b" }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveTagText}>{ws.connected ? "LIVE" : ws.reconnecting ? "SYNCING" : "OFFLINE"}</Text>
        </View>
      </SafeAreaView>

      {/* Premium bottom sheet */}
      <SafeAreaView style={styles.sheetWrap} edges={["bottom"]}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          {/* stage + ETA hero */}
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.stageLine}>{stageLine}</Text>
              <Text style={styles.service}>{serviceName}</Text>
            </View>
            <View style={styles.etaBox}>
              <Text style={styles.etaValue}>{eta != null ? eta : "—"}</Text>
              <Text style={styles.etaUnit}>min</Text>
            </View>
          </View>

          {/* stats: distance · heading · speed */}
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{distanceKm != null ? `${distanceKm.toFixed(1)}` : "—"}</Text>
              <Text style={styles.statLabel}>km away</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{heading}</Text>
              <Text style={styles.statLabel}>heading</Text>
            </View>
            <View style={styles.statDiv} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{speedKmh != null && speedKmh > 0 ? speedKmh : "—"}</Text>
              <Text style={styles.statLabel}>km/h</Text>
            </View>
          </View>

          {/* journey rail */}
          <View style={styles.rail}>
            {RAIL_STEPS.map((step, i) => {
              const sIdx = STAGE_ORDER.indexOf(step.stage);
              const done = stageIdx > sIdx;
              const active = stageIdx === sIdx;
              return (
                <React.Fragment key={step.label}>
                  <View style={styles.railStep}>
                    <View style={[styles.railDot, done ? styles.railDotDone : active ? styles.railDotActive : styles.railDotIdle]}>
                      {done ? <Check size={10} color="#fff" strokeWidth={3} /> : null}
                    </View>
                    <Text style={[styles.railLabel, { color: done || active ? "#047857" : "#94a3b8", fontWeight: active ? "800" : "600" }]} numberOfLines={1}>
                      {step.label}
                    </Text>
                  </View>
                  {i < RAIL_STEPS.length - 1 ? (
                    <View style={[styles.railLine, { backgroundColor: stageIdx > sIdx ? "#10b981" : "#e2e8f0" }]} />
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>

          {/* service-start PIN — lights up the moment the partner requests it */}
          {stageIdx < STAGE_ORDER.indexOf("STARTED") ? (
            <ServiceStartPinCard bookingId={bookingId} proName={proName} />
          ) : null}

          {/* partner card */}
          <View style={styles.proCard}>
            {pro?.profileImage ? (
              <Image source={{ uri: pro.profileImage }} style={styles.proAvatar} />
            ) : (
              <View style={[styles.proAvatar, styles.proAvatarFallback]}>
                <Text style={styles.proInitial}>{proName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.proName} numberOfLines={1}>{proName}</Text>
              <View style={styles.proMetaRow}>
                {pro?.rating != null ? (
                  <View style={styles.ratingPill}>
                    <Star size={11} color="#f59e0b" fill="#f59e0b" strokeWidth={0} />
                    <Text style={styles.ratingText}>{pro.rating.toFixed(1)}</Text>
                  </View>
                ) : null}
                <View style={styles.verifyRow}>
                  <ShieldCheck size={12} color="#059669" />
                  <Text style={styles.verifyText}>Verified pro</Text>
                </View>
              </View>
            </View>
            <Pressable onPress={callPro} style={[styles.actionBtn, { backgroundColor: "#10b981" }]}>
              <Phone size={18} color="#fff" fill="#fff" />
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: "#0d9488" }]}>
              <MessageSquare size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#062a1f" },
  waiting: { alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#f0fdf4" },
  waitingText: { color: "#047857", fontSize: 14, fontWeight: "600" },

  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  backBtn: {
    marginTop: 8,
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  liveTag: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "#fff" },
  liveTagText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },

  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 16,
  },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: "#e2e8f0", marginBottom: 14 },

  heroRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stageLine: { fontSize: 18, fontWeight: "900", color: "#0f172a", letterSpacing: -0.4 },
  service: { fontSize: 12.5, fontWeight: "600", color: "#64748b", marginTop: 2 },
  etaBox: { alignItems: "center", backgroundColor: "#ecfdf5", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, minWidth: 72 },
  etaValue: { fontSize: 26, fontWeight: "900", color: "#0d9488", letterSpacing: -1 },
  etaUnit: { fontSize: 11, fontWeight: "700", color: "#059669", marginTop: -2 },

  stats: { flexDirection: "row", alignItems: "center", marginTop: 16, marginBottom: 4 },
  stat: { flex: 1, alignItems: "center" },
  statDiv: { width: 1, height: 30, backgroundColor: "#e2e8f0" },
  statValue: { fontSize: 17, fontWeight: "900", color: "#0f172a", letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontWeight: "600", color: "#94a3b8", marginTop: 1 },

  rail: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  railStep: { alignItems: "center", width: 56 },
  railDot: { width: 22, height: 22, borderRadius: 999, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  railDotDone: { backgroundColor: "#10b981", borderColor: "#10b981" },
  railDotActive: { backgroundColor: "#a7f3d0", borderColor: "#10b981" },
  railDotIdle: { backgroundColor: "transparent", borderColor: "#e2e8f0" },
  railLabel: { fontSize: 9.5 },
  railLine: { flex: 1, height: 2, borderRadius: 2, marginBottom: 20 },

  proCard: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  proAvatar: { width: 50, height: 50, borderRadius: 16, backgroundColor: "#ecfdf5" },
  proAvatarFallback: { alignItems: "center", justifyContent: "center" },
  proInitial: { fontSize: 20, fontWeight: "900", color: "#059669" },
  proName: { fontSize: 15.5, fontWeight: "800", color: "#0f172a" },
  proMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(245,158,11,0.12)", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  ratingText: { fontSize: 11.5, fontWeight: "800", color: "#d97706" },
  verifyRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifyText: { fontSize: 11.5, fontWeight: "700", color: "#059669" },
  actionBtn: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Image, Dimensions } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, Users } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { useStatsOverview, useCoverageCities } from "@/hooks/use-core-data";
import { CoverageSearch } from "./CoverageSearch";
import { CityCoverageSheet } from "./CityCoverageSheet";

const { width } = Dimensions.get("window");
const GAP = 12;
const H_PAD = 20;
const TILE_W = (width - H_PAD * 2 - GAP) / 2;

/** Same Unsplash imagery + order as the website services page (CITIES). */
const U = (id: string) =>
  `https://images.unsplash.com/${id}?w=600&q=85&auto=format&fit=crop`;

const CITIES = [
  { name: "Bangalore", image: U("photo-1596176530529-78163a4f5af6") },
  { name: "Delhi", image: U("photo-1587474260584-136574528ed5") },
  { name: "Mumbai", image: U("photo-1566552881560-0be862a7c445") },
  { name: "Pune", image: U("photo-1596178065887-1198b8048ed8") },
  { name: "Gurgaon", image: U("photo-1524492412937-2808ad67581e") },
  { name: "Noida", image: U("photo-1587474260584-136574528ed5") },
  { name: "Hyderabad", image: U("photo-1596176530529-78163a4f5af6") },
  { name: "Navi Mumbai", image: U("photo-1566552881560-0be862a7c445") },
  { name: "Faridabad", image: U("photo-1524492412937-2808ad67581e") },
  { name: "Ghaziabad", image: U("photo-1587474260584-136574528ed5") },
  { name: "Thane", image: U("photo-1566552881560-0be862a7c445") },
];

const citySlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");
const nf = (n: number) => n.toLocaleString("en-IN");

/**
 * Cities — 1:1 with the website services page "Available in 11+ Indian Cities"
 * section: a dark cinematic band with live metrics and premium city photo tiles
 * (image + gradient scrim + live partner counts from GET /api/coverage/cities).
 */
export function CitiesSection() {
  const { data: stats } = useStatsOverview();
  const { data: coverage } = useCoverageCities();
  const [openCity, setOpenCity] = useState<{ slug: string; name: string } | null>(null);

  const metrics = useMemo(
    () => [
      { number: "11+", label: "Cities" },
      {
        number: stats && stats.completedBookings > 0 ? `${nf(stats.completedBookings)}+` : "50,000+",
        label: "Homes Served",
      },
      {
        number: stats && stats.activeProviders > 0 ? `${nf(stats.activeProviders)}+` : "10,000+",
        label: "Verified Partners",
      },
      { number: stats?.averageRating != null ? `${stats.averageRating}★` : "4.9★", label: "Rating" },
    ],
    [stats],
  );

  const partnersBySlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of coverage?.cities ?? []) map.set(c.slug, c.activePartners);
    return map;
  }, [coverage?.cities]);

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={["#0b1f19", "#0f3d31", "#0b1f19"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.band}
      >
        {/* header */}
        <Animated.View entering={FadeInUp.duration(500)} style={styles.header}>
          <Text style={styles.title}>Available in 11+ Indian Cities</Text>
          <Text style={styles.subtitle}>
            Hyperlocal coverage — check your society, area or pincode
          </Text>
        </Animated.View>

        {/* hyperlocal coverage search — same endpoint as the website */}
        <View style={styles.searchWrap}>
          <CoverageSearch onOpenCity={(slug, name) => setOpenCity({ slug, name })} />
        </View>

        {/* live metrics */}
        <View style={styles.metricsRow}>
          {metrics.map((m, i) => (
            <Animated.View key={m.label} entering={FadeInUp.delay(80 + i * 70).duration(460)} style={styles.metric}>
              <Text style={styles.metricNum}>{m.number}</Text>
              <Text style={styles.metricLabel}>{m.label}</Text>
            </Animated.View>
          ))}
        </View>

        {/* premium city photo tiles */}
        <View style={styles.grid}>
          {CITIES.map((city, i) => {
            const partners = partnersBySlug.get(citySlug(city.name)) ?? 0;
            return (
              <Animated.View key={city.name} entering={FadeIn.delay(120 + (i % 6) * 55).duration(420)}>
                <PressableScale
                  haptic
                  scaleTo={0.95}
                  onPress={() => setOpenCity({ slug: citySlug(city.name), name: city.name })}
                  style={styles.tile}
                  accessibilityRole="button"
                  accessibilityLabel={
                    partners > 0
                      ? `${city.name}, ${partners} partners. View coverage details`
                      : `${city.name}. View coverage details`
                  }
                >
                  <Image source={{ uri: city.image }} style={styles.tileImg} resizeMode="cover" />
                  <LinearGradient
                    colors={["rgba(4,20,13,0.05)", "rgba(4,20,13,0.55)", "rgba(4,20,13,0.94)"]}
                    locations={[0, 0.5, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.tileContent}>
                    <Text style={styles.cityName}>{city.name}</Text>
                    {partners > 0 ? (
                      <View style={styles.covRow}>
                        <Users size={10} color="#6ee7b7" strokeWidth={2.6} />
                        <Text style={styles.covText}>{partners}+ partners</Text>
                      </View>
                    ) : (
                      <View style={styles.covRow}>
                        <MapPin size={10} color="#6ee7b7" strokeWidth={2.6} />
                        <Text style={styles.covText}>View coverage</Text>
                      </View>
                    )}
                  </View>
                </PressableScale>
              </Animated.View>
            );
          })}
        </View>

        <Text style={styles.footNote}>
          Tap a city to explore areas, pincodes, societies and live availability
        </Text>
      </LinearGradient>

      <CityCoverageSheet
        slug={openCity?.slug ?? null}
        cityName={openCity?.name}
        onClose={() => setOpenCity(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  band: { paddingVertical: 28, paddingHorizontal: H_PAD },

  searchWrap: { marginBottom: 24 },
  header: { alignItems: "center", marginBottom: 22 },
  title: {
    color: "#fff",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 29,
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 19,
  },

  metricsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  metric: { flex: 1, alignItems: "center" },
  metricNum: { color: "#34d399", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  metricLabel: { color: "rgba(255,255,255,0.62)", fontSize: 11, fontWeight: "600", marginTop: 3, textAlign: "center" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  tile: {
    width: TILE_W,
    height: 118,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0b1f19",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tileImg: { width: "100%", height: "100%" },
  tileContent: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingBottom: 12, gap: 3 },
  cityName: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  covRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  covText: { color: "#6ee7b7", fontSize: 10.5, fontWeight: "700" },

  footNote: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 20,
  },
});

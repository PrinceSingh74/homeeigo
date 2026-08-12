import React from "react";
import { View, Text, StyleSheet, FlatList, Image, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Sparkles } from "lucide-react-native";
import { SectionHeader } from "./common/SectionHeader";
import { useServicesTheme } from "./ServicesThemeContext";
import { useCatalogServices } from "@/hooks/use-catalog";
import { getServicePhoto } from "@/lib/service-photos";
import { useServicesActions } from "@/hooks/useServicesActions";
import { PressableScale } from "@/components/ai/PressableScale";
import { layout } from "@/components/services/theme/layout";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.52;
const CARD_H = CARD_W * 1.14;

type CatItem = { name: string };

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Reusable category rail — mirrors the website services-page category sections
 * (Home Care / Premium Care / Laundry / Outdoor / Coming Soon). Each service is
 * a premium card: branded website photo when available, else a gradient accent
 * tile. Live prices/ids from the catalog; matched by name.
 */
export function CategoryRail({
  overline,
  title,
  subtitle,
  items,
  soon = false,
}: {
  overline: string;
  title: string;
  subtitle: string;
  items: CatItem[];
  soon?: boolean;
}) {
  const { c, layout: L } = useServicesTheme();
  const { book } = useServicesActions();
  const { services: catalog } = useCatalogServices();

  const findCatalog = (name: string) =>
    catalog.find((s) => s.name.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));

  return (
    <View>
      <SectionHeader overline={overline} title={title} subtitle={subtitle} />
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_W + 16}
        keyExtractor={(i) => i.name}
        contentContainerStyle={[styles.list, { paddingLeft: L.pad, paddingRight: L.listPeek }]}
        renderItem={({ item }) => {
          const svc = findCatalog(item.name);
          const photo = getServicePhoto(item.name);
          const accent = photo?.accent ?? "#10b981";
          const price = svc?.price;
          return (
            <PressableScale
              haptic={!soon}
              onPress={() => {
                if (!soon && svc) book({ service: svc.id });
              }}
              style={[styles.card, { shadowColor: accent }]}
            >
              {photo ? (
                <Image source={photo.photo} style={styles.photo} resizeMode="cover" />
              ) : (
                <LinearGradient
                  colors={[shade(accent, 40), accent, shade(accent, -30)]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.photo}
                >
                  <Sparkles size={44} color="rgba(255,255,255,0.9)" strokeWidth={1.6} />
                </LinearGradient>
              )}
              <LinearGradient
                colors={["transparent", "rgba(4,20,13,0.12)", "rgba(4,20,13,0.88)"]}
                locations={[0, 0.45, 1]}
                style={styles.scrim}
              />
              {soon ? (
                <View style={styles.soonBadge}>
                  <Text style={styles.soonText}>COMING SOON</Text>
                </View>
              ) : null}
              <View style={styles.info}>
                <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                <View style={styles.row}>
                  {soon ? (
                    <Text style={styles.notify}>Notify me</Text>
                  ) : price ? (
                    <View style={styles.pricePill}>
                      <Text style={styles.priceText}>From {price}</Text>
                    </View>
                  ) : (
                    <View />
                  )}
                  {!soon ? (
                    <View style={[styles.arrow, { backgroundColor: accent }]}>
                      <ArrowRight size={15} color="#fff" strokeWidth={2.6} />
                    </View>
                  ) : null}
                </View>
              </View>
            </PressableScale>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16, paddingVertical: 4 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: layout.cardRadiusLg,
    overflow: "hidden",
    backgroundColor: "#e5f6ee",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 9,
  },
  photo: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  soonBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(4,20,13,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  soonText: { color: "#a7f3d0", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.6 },
  info: { position: "absolute", left: 14, right: 14, bottom: 13 },
  name: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  row: { marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pricePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  priceText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  notify: { color: "#a7f3d0", fontSize: 12, fontWeight: "800" },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});

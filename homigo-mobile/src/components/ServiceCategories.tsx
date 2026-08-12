import React, { useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Animated,
  Image,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { useRouter } from "expo-router";
import { ArrowRight, Scissors, type LucideIcon } from "lucide-react-native";
import { openBook, openProviders } from "@/lib/navigation";
import { useCatalogServices } from "@/hooks/use-catalog";
import { getServicePhoto } from "@/lib/service-photos";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.36;
const FEAT_W = width * 0.4;
/* Branded photo tiles — same artwork as the website's Popular Services. */
const PHOTO_W = width * 0.58;
const PHOTO_H = PHOTO_W * 1.18;
const SNAP = PHOTO_W + 14;

const IMAGES: Record<string, any> = {
  cleaning: require("../../assets/svc-cleaning.png"),
  ac: require("../../assets/svc-ac.png"),
  plumbing: require("../../assets/svc-plumbing.png"),
  electrician: require("../../assets/svc-electrician.png"),
  pest: require("../../assets/svc-pest.png"),
};

type Svc = {
  serviceId: string;
  name: string;
  price?: string;
  imgKey?: string;
  icon?: LucideIcon;
  color: string;
  featured?: boolean;
};

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0x00ff) + amt;
  let b = (n & 0x0000ff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function IconChip({
  color,
  feat,
  children,
}: {
  color: string;
  feat: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.iconShadow, { shadowColor: feat ? "#065f46" : color }]}>
      <LinearGradient
        colors={
          feat
            ? ["rgba(255,255,255,0.30)", "rgba(255,255,255,0.12)"]
            : [color + "26", color + "10"]
        }
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.iconChip}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.7 }}
          style={styles.gloss}
        />
        {children}
      </LinearGradient>
    </View>
  );
}

function ServiceIcon({ item, feat }: { item: Svc; feat: boolean }) {
  const hasImg = item.imgKey && IMAGES[item.imgKey];
  return (
    <IconChip color={item.color} feat={feat}>
      {hasImg ? (
        <Image
          source={IMAGES[item.imgKey as string]}
          style={styles.icon3d}
          resizeMode="contain"
        />
      ) : (
        <LinearGradient
          colors={[shade(item.color, 50), item.color, shade(item.color, -35)]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.fauxInner}
        >
          {React.createElement(item.icon ?? Scissors, {
            size: 24,
            color: "#fff",
            strokeWidth: 2.4,
          })}
        </LinearGradient>
      )}
    </IconChip>
  );
}

/**
 * Premium branded photo tile — mirrors the website's Popular Services cards:
 * a clear, full-bleed service photo with a bottom gradient scrim, extrabold
 * name, glass price pill, and accent arrow. Fully static (no tilt), image stays
 * crisp and uncovered — the scrim only darkens the lower third for legibility.
 */
function PhotoCard({ item, photo, accent }: { item: Svc; photo: any; accent: string }) {
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number, b = 0) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 50, bounciness: b }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => openBook(router, { service: item.serviceId })}
        onPressIn={() => to(0.96)}
        onPressOut={() => to(1, 7)}
        style={[styles.photoCard, { shadowColor: accent }]}
      >
        <Image source={photo} style={styles.photoImg} resizeMode="cover" />
        {/* bottom scrim only — keeps the image clear */}
        <LinearGradient
          colors={["transparent", "rgba(4,20,13,0.10)", "rgba(4,20,13,0.86)"]}
          locations={[0, 0.45, 1]}
          style={styles.photoScrim}
        />
        {item.featured ? (
          <View style={[styles.photoBadge, { backgroundColor: accent }]}>
            <Text style={styles.photoBadgeText}>POPULAR</Text>
          </View>
        ) : null}
        <View style={styles.photoInfo}>
          <Text numberOfLines={1} style={styles.photoName}>{item.name}</Text>
          <View style={styles.photoRow}>
            {item.price ? (
              <View style={styles.pricePill}>
                <Text style={styles.pricePillText}>From {item.price}</Text>
              </View>
            ) : <View />}
            <View style={[styles.photoArrow, { backgroundColor: accent }]}>
              <ArrowRight size={15} color="#fff" strokeWidth={2.6} />
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function Card({ item }: { item: Svc }) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const feat = !!item.featured;

  const to = (v: number, b = 0) =>
    Animated.spring(scale, {
      toValue: v,
      useNativeDriver: true,
      speed: 50,
      bounciness: b,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => openBook(router, { service: item.serviceId })}
        onPressIn={() => to(0.94)}
        onPressOut={() => to(1, 8)}
        style={{ width: feat ? FEAT_W : CARD_W }}
      >
        {feat ? (
          <LinearGradient
            colors={["#10b981", "#0d9488", "#0f766e"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, shadowStyles.glowEmerald]}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0.28)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.featSheen}
            />
            <ServiceIcon item={item} feat />
            <Text style={[styles.name, { color: "#fff" }]}>{item.name}</Text>
            <Text style={[styles.price, { color: "rgba(255,255,255,0.85)" }]}>
              From {item.price}
            </Text>
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.card,
              {
                backgroundColor: "#FFFFFF",
                borderColor: item.color + "1F",
                borderWidth: 1,
              },
              shadowStyles.lg,
            ]}
          >
            <ServiceIcon item={item} feat={false} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.name, { color: themeColors.text }]}
            >
              {item.name}
            </Text>
            <Text style={[styles.price, { color: themeColors.textSecondary }]}>
              {item.price ? `From ${item.price}` : ""}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export const ServiceCategories: React.FC = () => {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const { services: catalogServices } = useCatalogServices();

  const services: Svc[] = catalogServices.map((s) => ({
    serviceId: s.id,
    name: s.name,
    price: s.price,
    imgKey: s.imageKey,
    icon: s.iconKey === "scissors" ? Scissors : undefined,
    color: s.color,
    featured: s.featured,
  }));

  // Split: services with branded website photos ride the premium photo rail;
  // the rest keep the compact icon cards (never leaves the section empty).
  const withPhoto = services
    .map((s) => ({ svc: s, ...(getServicePhoto(s.name) ?? {}) }))
    .filter((x): x is { svc: Svc; photo: any; accent: string } => Boolean((x as { photo?: unknown }).photo));
  const rest = services.filter((s) => !getServicePhoto(s.name));
  const hasPhotos = withPhoto.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Popular Services
        </Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable onPress={() => openProviders(router)}>
            <Text style={[styles.seeAll, { color: "#059669" }]}>
              Find pros
            </Text>
          </Pressable>
          <Pressable onPress={() => openBook(router)}>
            <Text style={[styles.seeAll, { color: "#059669" }]}>
              Book now
            </Text>
          </Pressable>
        </View>
      </View>

      {hasPhotos ? (
        <FlatList
          data={withPhoto}
          renderItem={({ item }) => (
            <PhotoCard item={item.svc} photo={item.photo} accent={item.accent} />
          )}
          keyExtractor={(i) => i.svc.serviceId}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={SNAP}
          snapToAlignment="start"
          contentContainerStyle={styles.photoList}
        />
      ) : null}

      {rest.length > 0 ? (
        <FlatList
          data={rest}
          renderItem={({ item }) => <Card item={item} />}
          keyExtractor={(i) => i.serviceId}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          contentContainerStyle={[styles.list, hasPhotos && { marginTop: 14 }]}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  seeAll: { fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 24, gap: 12, paddingVertical: 4 },

  /* ---- Premium branded photo rail (matches website Popular Services) ---- */
  photoList: { paddingHorizontal: 24, gap: 14, paddingVertical: 4 },
  photoCard: {
    width: PHOTO_W,
    height: PHOTO_H,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#e5f6ee",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 10,
  },
  photoImg: { width: "100%", height: "100%" },
  photoScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "62%" },
  photoBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  photoBadgeText: { color: "#fff", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6 },
  photoInfo: { position: "absolute", left: 14, right: 14, bottom: 13 },
  photoName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  photoRow: {
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pricePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  pricePillText: { color: "#fff", fontSize: 11.5, fontWeight: "800" },
  photoArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  card: {
    height: 172,
    borderRadius: 26,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  icon3d: {
    width: 76,
    height: 76,
  },
  fauxInner: {
    width: 58,
    height: 58,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  iconShadow: {
    marginBottom: 12,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 9,
  },
  iconChip: {
    width: 92,
    height: 92,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  featSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  name: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  price: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
    textAlign: "center",
  },
});

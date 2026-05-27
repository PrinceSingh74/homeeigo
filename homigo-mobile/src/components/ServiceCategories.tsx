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
import { Scissors, type LucideIcon } from "lucide-react-native";
import { openBook } from "@/lib/navigation";
import { SERVICES } from "@/lib/services";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.36;
const FEAT_W = width * 0.4;

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

const services: Svc[] = SERVICES.map((s) => ({
  serviceId: s.id,
  name: s.name,
  price: s.price,
  imgKey: s.imageKey,
  icon: s.iconKey === "scissors" ? Scissors : undefined,
  color: s.color,
  featured: s.featured,
}));

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
    <View style={[styles.iconShadow, { shadowColor: feat ? "#4C1D95" : color }]}>
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
            colors={["#8B5CF6", "#7C3AED", "#6D28D9"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, shadowStyles.glowViolet]}
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Popular Services
        </Text>
        <Pressable onPress={() => openBook(router)}>
          <Text style={[styles.seeAll, { color: themeColors.primary }]}>
            See all
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={services}
        renderItem={({ item }) => <Card item={item} />}
        keyExtractor={(i) => i.serviceId}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        contentContainerStyle={styles.list}
      />
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

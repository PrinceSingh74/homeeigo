import React, { useRef } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import {
  Sparkles,
  Wind,
  Droplets,
  Zap,
  Bug,
  Scissors,
  type LucideIcon,
} from "lucide-react-native";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.32;
const FEAT_W = width * 0.36;

type Svc = {
  id: number;
  name: string;
  price?: string;
  sub?: string;
  icon: LucideIcon;
  color: string;
  featured?: boolean;
};

const services: Svc[] = [
  { id: 1, name: "Cleaning", price: "₹199", icon: Sparkles, color: "#7C3AED", featured: true },
  { id: 2, name: "AC Service", price: "₹299", icon: Wind, color: "#06B6D4" },
  { id: 3, name: "Plumbing", price: "₹249", icon: Droplets, color: "#3B82F6" },
  { id: 4, name: "Electrician", price: "₹249", icon: Zap, color: "#F59E0B" },
  { id: 5, name: "Pest Control", price: "₹299", icon: Bug, color: "#10B981" },
  { id: 6, name: "Salon", price: "₹199", icon: Scissors, color: "#EC4899" },
];

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

function Icon3D({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <View style={[styles.iconShadow, { shadowColor: color }]}>
      <LinearGradient
        colors={[shade(color, 55), color, shade(color, -35)]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.iconChip}
      >
        {/* glossy top highlight */}
        <LinearGradient
          colors={["rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.7 }}
          style={styles.gloss}
        />
        <Icon size={26} color="#fff" strokeWidth={2.4} />
      </LinearGradient>
    </View>
  );
}

function Card({ item }: { item: Svc }) {
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
            <Icon3D icon={item.icon} color="#A78BFA" />
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
            <Icon3D icon={item.icon} color={item.color} />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.name, { color: themeColors.text }]}
            >
              {item.name}
            </Text>
            <Text style={[styles.price, { color: themeColors.textSecondary }]}>
              {item.price ? `From ${item.price}` : item.sub}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export const ServiceCategories: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Popular Services
        </Text>
        <Text style={[styles.seeAll, { color: themeColors.primary }]}>
          See all
        </Text>
      </View>
      <FlatList
        data={services}
        renderItem={({ item }) => <Card item={item} />}
        keyExtractor={(i) => i.id.toString()}
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
    height: 150,
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconShadow: {
    marginBottom: 12,
    borderRadius: 17,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  iconChip: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "60%",
    borderTopLeftRadius: 17,
    borderTopRightRadius: 17,
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

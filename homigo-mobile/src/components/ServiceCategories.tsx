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
  Grid3x3,
  type LucideIcon,
} from "lucide-react-native";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.30;
const FEAT_W = width * 0.34;

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
  { id: 6, name: "More", sub: "Services", icon: Grid3x3, color: "#7C3AED" },
];

function Card({ item }: { item: Svc }) {
  const { colors: themeColors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const Icon = item.icon;
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
            <View style={[styles.iconChip, styles.iconChipFeat]}>
              <Icon size={24} color="#fff" />
            </View>
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
                backgroundColor: themeColors.cardBg,
                borderColor: themeColors.border,
                borderWidth: 1,
              },
              shadowStyles.md,
            ]}
          >
            <LinearGradient
              colors={[item.color + "26", item.color + "0D"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconChip}
            >
              <Icon size={23} color={item.color} />
            </LinearGradient>
            <Text style={[styles.name, { color: themeColors.text }]}>
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
  container: { marginVertical: 14 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  seeAll: { fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 16, gap: 12, paddingVertical: 4 },
  card: {
    height: 138,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconChip: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  iconChipFeat: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  name: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  price: {
    fontSize: 10.5,
    fontWeight: "600",
    marginTop: 3,
    textAlign: "center",
  },
});

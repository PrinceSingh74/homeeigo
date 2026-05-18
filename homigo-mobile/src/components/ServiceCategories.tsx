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
} from "lucide-react-native";

const { width } = Dimensions.get("window");

const services = [
  { id: 1, name: "Cleaning", icon: Sparkles, price: "₹199", color: "#7C3AED", featured: true },
  { id: 2, name: "AC Service", icon: Wind, price: "₹299", color: "#06B6D4" },
  { id: 3, name: "Plumbing", icon: Droplets, price: "₹249", color: "#3B82F6" },
  { id: 4, name: "Electrician", icon: Zap, price: "₹249", color: "#F59E0B" },
  { id: 5, name: "Pest Control", icon: Bug, price: "₹299", color: "#10B981" },
  { id: 6, name: "Salon", icon: Scissors, price: "₹199", color: "#EC4899" },
];

const FEATURED_W = width * 0.46;
const CARD_W = width * 0.34;

function ServiceCard({ item }: { item: (typeof services)[number] }) {
  const { colors: themeColors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const Icon = item.icon;
  const featured = !!item.featured;

  const press = (to: number, bounce = 0) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 50,
      bounciness: bounce,
    }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={() => press(0.95)}
        onPressOut={() => press(1, 8)}
        style={{ width: featured ? FEATURED_W : CARD_W }}
      >
        {featured ? (
          <LinearGradient
            colors={["#7C3AED", "#EC4899"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.card, shadowStyles.glowViolet]}
          >
            <View style={styles.featuredBadge}>
              <Text style={styles.featuredBadgeText}>FEATURED</Text>
            </View>
            <View style={[styles.iconWrap, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
              <Icon size={30} color="#fff" />
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
                borderWidth: 1,
                borderColor: themeColors.border,
              },
              shadowStyles.md,
            ]}
          >
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: item.color + "1A" },
              ]}
            >
              <Icon size={30} color={item.color} />
            </View>
            <Text style={[styles.name, { color: themeColors.text }]}>
              {item.name}
            </Text>
            <Text style={[styles.price, { color: themeColors.textSecondary }]}>
              From {item.price}
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
        renderItem={({ item }) => <ServiceCard item={item} />}
        keyExtractor={(item) => item.id.toString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={CARD_W + 14}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  seeAll: {
    fontSize: 14,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 14,
    paddingVertical: 6,
  },
  card: {
    height: 190,
    borderRadius: 22,
    padding: 18,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  price: {
    fontSize: 12,
    fontWeight: "600",
  },
  featuredBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  featuredBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
});

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from "react-native";
import { Star } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const ITEMS = [
  {
    id: 1,
    title: "Sofa Deep Clean",
    price: "₹699",
    rating: "4.9",
    img: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&q=70",
  },
  {
    id: 2,
    title: "AC Gas Refill",
    price: "₹1,299",
    rating: "4.8",
    img: "https://images.unsplash.com/photo-1635048424329-a9bfb146d7aa?w=400&q=70",
  },
  {
    id: 3,
    title: "Full Home Painting",
    price: "₹4,999",
    rating: "4.9",
    img: "https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=400&q=70",
  },
];

export const RecommendedSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Recommended for You
        </Text>
        <Text style={[styles.seeAll, { color: themeColors.primary }]}>
          See all
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {ITEMS.map((it) => (
          <Pressable
            key={it.id}
            style={[
              styles.card,
              {
                backgroundColor: themeColors.cardBg,
                borderColor: themeColors.border,
              },
              shadowStyles.md,
            ]}
          >
            <Image source={{ uri: it.img }} style={styles.img} />
            <View style={styles.body}>
              <Text
                numberOfLines={1}
                style={[styles.cardTitle, { color: themeColors.text }]}
              >
                {it.title}
              </Text>
              <View style={styles.metaRow}>
                <Text style={[styles.price, { color: themeColors.primary }]}>
                  {it.price}
                </Text>
                <View style={styles.rating}>
                  <Star size={12} color="#F59E0B" fill="#F59E0B" />
                  <Text style={[styles.ratingText, { color: themeColors.textSecondary }]}>
                    {it.rating}
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginTop: 8, marginBottom: 8 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 2 },
  seeAll: { fontSize: 12, fontWeight: "700" },
  list: { paddingHorizontal: 16, gap: 14 },
  card: {
    width: 200,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  img: { width: "100%", height: 120, backgroundColor: "#E5E7EB" },
  body: { padding: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  price: { fontSize: 15, fontWeight: "800" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 12, fontWeight: "600" },
});

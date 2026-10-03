import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Star, ChevronRight } from "lucide-react-native";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

export type AiServiceCardProps = {
  id: string;
  name: string;
  basePrice: number;
  category?: string;
  rating?: number;
  reviewCount?: number;
  image?: string;
  onPress?: (id: string) => void;
};

export function AiServiceCard({
  id,
  name,
  basePrice,
  category,
  rating,
  reviewCount,
  image,
  onPress,
}: AiServiceCardProps) {
  const { c } = useAiTheme();

  return (
    <PressableScale
      onPress={() => onPress?.(id)}
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.cardBorder },
        aiCardShadow(c.shadowColor, "soft"),
      ]}
      haptic
    >
      {image && (
        <Image
          source={{ uri: image }}
          style={styles.image}
          resizeMode="cover"
        />
      )}

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
              {name}
            </Text>
            {category && (
              <Text style={[styles.category, { color: c.muted }]} numberOfLines={1}>
                {category}
              </Text>
            )}
          </View>
          <ChevronRight size={18} color={c.muted} strokeWidth={2} />
        </View>

        <View style={styles.footer}>
          <View style={styles.priceRating}>
            <Text style={[styles.price, { color: c.accent }]}>
              From ₹{basePrice.toLocaleString("en-IN")}
            </Text>
            {rating !== undefined && (
              <View style={styles.rating}>
                <Star size={14} color="#FBBF24" strokeWidth={2} fill="#FBBF24" />
                <Text style={[styles.ratingText, { color: c.text }]}>
                  {rating.toFixed(1)}
                </Text>
                {reviewCount !== undefined && (
                  <Text style={[styles.reviewCount, { color: c.muted }]}>
                    ({reviewCount})
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: aiRadius.lg,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: aiSpacing.gap,
  },
  image: {
    width: "100%",
    height: 120,
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  content: {
    padding: aiSpacing.gap,
    gap: aiSpacing.gapSm,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: aiSpacing.gapSm,
  },
  name: {
    ...aiType.body,
    fontWeight: "600",
    fontSize: 14,
    marginBottom: 2,
  },
  category: {
    ...aiType.caption,
    fontSize: 12,
  },
  footer: {
    gap: aiSpacing.micro,
  },
  priceRating: {
    gap: 8,
  },
  price: {
    ...aiType.body,
    fontWeight: "600",
    fontSize: 13,
  },
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  ratingText: {
    ...aiType.caption,
    fontSize: 12,
    fontWeight: "600",
  },
  reviewCount: {
    ...aiType.caption,
    fontSize: 11,
  },
});

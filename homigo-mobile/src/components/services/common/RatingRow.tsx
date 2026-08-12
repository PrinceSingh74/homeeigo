import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Star } from "lucide-react-native";
import { serviceType } from "@/components/services/theme/typography";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  rating: number | null;
  reviews: string;
};

export function RatingRow({ rating, reviews }: Props) {
  const { c } = useServicesTheme();

  // No reviews yet → show an honest "New" instead of a fabricated rating.
  if (rating == null) {
    return (
      <View style={styles.row}>
        <Text style={[styles.rating, { color: c.textMuted }]}>New</Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Star size={13} color={c.gold} fill={c.gold} />
      <Text style={[styles.rating, { color: c.textPrimary }]}>
        {rating.toFixed(1)}
      </Text>
      <Text style={[styles.dot, { color: c.textMuted }]}>·</Text>
      <Text style={[styles.reviews, { color: c.textMuted }]}>{reviews} reviews</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  rating: {
    ...serviceType.cardTitleSm,
    fontSize: 12,
  },
  dot: { ...serviceType.caption, marginHorizontal: 1 },
  reviews: { ...serviceType.caption },
});

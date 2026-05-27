import React from "react";
import { View, Text, StyleSheet, FlatList, Image } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Clock, Heart } from "lucide-react-native";
import { SectionHeader } from "./common/SectionHeader";
import { BookNowButton } from "./common/BookNowButton";
import { RatingRow } from "./common/RatingRow";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesContext } from "./ServicesContext";
import { useServicesTheme } from "./ServicesThemeContext";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useAppStore } from "@/lib/store";
import { PressableScale } from "@/components/ai/PressableScale";
import { Premium3DCard } from "./visual/Premium3DCard";
import type { TrendingService } from "@/constants/servicesData";

export function TrendingServices() {
  const { filteredTrending } = useServicesContext();
  const { book, openTrending } = useServicesActions();
  const toggleWishlist = useAppStore((s) => s.toggleWishlist);
  const isWishlisted = useAppStore((s) => s.isWishlisted);
  const showToast = useAppStore((s) => s.showToast);
  const { c, shadows, isDark, layout: L } = useServicesTheme();

  const renderItem = ({
    item,
    index,
  }: {
    item: TrendingService;
    index: number;
  }) => (
    <Animated.View entering={FadeInRight.delay(index * 65).springify()}>
      <Premium3DCard
        radius={layout.cardRadius + 2}
        depth="medium"
        style={{ width: L.trendingCardW }}
      >
        <View style={[styles.imageWrap, { height: L.trendingImageH }]}>
          <Image
            source={{ uri: item.imageUri }}
            style={styles.image}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(15, 10, 30, 0.55)"]}
            style={styles.imageOverlay}
          />
          <View style={[styles.hdBadge, { backgroundColor: c.hdBadgeBg }]}>
            <Text style={styles.hdText}>4K</Text>
          </View>
          <PressableScale
            style={[
              styles.heartBtn,
              shadows.glass,
              {
                backgroundColor: isDark
                  ? "rgba(30, 26, 48, 0.95)"
                  : "rgba(255,255,255,0.96)",
              },
            ]}
            scaleTo={0.9}
            haptic
            onPress={() => {
              const saved = toggleWishlist(item.id);
              showToast(saved ? "Saved to wishlist" : "Removed from wishlist");
            }}
          >
            <Heart
              size={15}
              color={
                isWishlisted(item.id) ? c.error : c.textMuted
              }
              fill={isWishlisted(item.id) ? c.error : "transparent"}
              strokeWidth={2}
            />
          </PressableScale>
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={2}>
            {item.title}
          </Text>
          <RatingRow rating={item.rating} reviews={item.reviews} />
          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: c.textPrimary }]}>₹{item.price}</Text>
            <View style={styles.durationRow}>
              <Clock size={12} color={c.textMuted} strokeWidth={2} />
              <Text style={[styles.duration, { color: c.textMuted }]}>
                {item.duration}
              </Text>
            </View>
          </View>
          <BookNowButton
            onPress={() => book({ service: item.serviceId })}
            style={styles.bookBtn}
          />
        </View>
      </Premium3DCard>
    </Animated.View>
  );

  return (
    <View>
      <SectionHeader
        overline="Popular now"
        title="Trending Services"
        subtitle="Ultra HD service photography · most booked this week"
        onViewAll={openTrending}
      />
      <FlatList
        horizontal
        data={filteredTrending}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          L.listContent,
          { minHeight: L.trendingListMinH },
        ]}
        snapToInterval={L.trendingSnap}
        decelerationRate="fast"
        ListEmptyComponent={
          <View style={[styles.emptyWrap, { paddingHorizontal: L.pad }]}>
            <Text style={[styles.empty, { color: c.textMuted }]}>
              No services match your search
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  imageWrap: { position: "relative" },
  image: { width: "100%", height: "100%" },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: "35%",
  },
  hdBadge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  hdText: {
    ...serviceType.badge,
    color: "#fff",
    fontSize: 9,
    letterSpacing: 1,
  },
  heartBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 15 },
  title: {
    ...serviceType.cardTitleSm,
    minHeight: 36,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  price: { ...serviceType.price },
  durationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  duration: { ...serviceType.caption },
  bookBtn: { marginTop: 12, width: "100%" },
  emptyWrap: { paddingVertical: 24 },
  empty: { ...serviceType.body },
});

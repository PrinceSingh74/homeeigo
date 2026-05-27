import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { Star, Check } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { CUSTOMER_REVIEWS } from "@/constants/servicesData";
import { SectionHeader } from "./common/SectionHeader";
import { Premium3DCard } from "./visual/Premium3DCard";
import { useServicesTheme } from "./ServicesThemeContext";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesActions } from "@/hooks/useServicesActions";

export function CustomerReviews() {
  const { openReviews, book } = useServicesActions();
  const [activeIndex, setActiveIndex] = useState(0);
  const { c, isDark, layout: L } = useServicesTheme();

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / L.reviewSnap);
    setActiveIndex(Math.min(idx, CUSTOMER_REVIEWS.length - 1));
  };

  return (
    <View>
      <SectionHeader
        overline="Reviews"
        title="What Our Customers Say"
        subtitle="Real experiences from homes across Gurugram"
        viewAllLabel="View All →"
        onViewAll={openReviews}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={L.reviewSnap}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={L.listContent}
      >
        {CUSTOMER_REVIEWS.map((r, index) => {
          const isActive = index === activeIndex;
          return (
            <Animated.View
              key={r.id}
              entering={FadeInRight.delay(index * 70)}
              style={[
                styles.cardWrap,
                { width: L.reviewCardW },
                isActive ? styles.cardActive : styles.cardInactive,
              ]}
            >
              <PressableScale
                haptic
                scaleTo={0.98}
                onPress={() => book({ service: "cleaning" })}
              >
              <Premium3DCard radius={layout.cardRadius + 2} depth="soft">
                <View style={styles.cardInner}>
                <View style={styles.topRow}>
                  <View style={[styles.avatar, { backgroundColor: c.primary }]}>
                    <Text style={styles.avatarText}>{r.initial}</Text>
                  </View>
                  <View style={styles.meta}>
                    <Text style={[styles.name, { color: c.textPrimary }]}>{r.name}</Text>
                    <Text style={[styles.location, { color: c.textMuted }]}>
                      {r.location}
                    </Text>
                  </View>
                  <View style={styles.stars}>
                    {Array.from({ length: r.rating }).map((_, i) => (
                      <Star
                        key={i}
                        size={13}
                        color={c.gold}
                        fill={c.gold}
                      />
                    ))}
                  </View>
                </View>
                <Text style={[styles.review, { color: c.textSecondary }]}>
                  {r.review}
                </Text>
                <View style={[styles.verified, { borderTopColor: c.borderLight }]}>
                  <Check size={12} color={c.success} strokeWidth={2.5} />
                  <Text style={[styles.verifiedText, { color: c.success }]}>
                    Verified booking
                  </Text>
                </View>
                </View>
              </Premium3DCard>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>
      <View style={styles.dots}>
        {CUSTOMER_REVIEWS.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: isDark ? "rgba(139, 92, 246, 0.35)" : "#D1D5DB",
              },
              i === activeIndex && styles.dotActive,
              i === activeIndex && { backgroundColor: c.primary },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    transform: [{ scale: 0.97 }],
    opacity: 0.92,
  },
  cardActive: {
    transform: [{ scale: 1 }],
    opacity: 1,
  },
  cardInactive: {},
  cardInner: {
    padding: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    ...serviceType.sectionTitle,
    fontSize: 18,
    color: "#fff",
  },
  meta: { flex: 1 },
  name: { ...serviceType.cardTitle },
  location: {
    ...serviceType.caption,
    marginTop: 2,
  },
  stars: { flexDirection: "row", gap: 2 },
  review: {
    ...serviceType.body,
    marginTop: 14,
    lineHeight: 21,
  },
  verified: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verifiedText: {
    ...serviceType.badge,
    fontSize: 10,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 22,
    height: 6,
    borderRadius: 3,
  },
});

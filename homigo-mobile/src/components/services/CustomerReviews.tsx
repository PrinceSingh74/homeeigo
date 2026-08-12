import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import Animated, { FadeInRight, FadeInUp } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Star, Check, Quote, ArrowRight } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { SkeletonCard } from "./common/Skeleton";
import { BookNowButton } from "./common/BookNowButton";
import { useServicesTheme } from "./ServicesThemeContext";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useStatsOverview } from "@/hooks/use-core-data";

const AUTO_ADVANCE_MS = 4800;
const nf = (n: number) => n.toLocaleString("en-IN");

/**
 * Customer reviews — a cinematic, full-bleed dark band so social proof reads as a
 * deliberate moment instead of blending into the mint canvas.
 *
 * Reviews come from the public ratings feed; the aggregate rating comes from
 * /api/stats/overview and hides entirely when the backend has no value. Nothing
 * here is hardcoded.
 */
export function CustomerReviews() {
  const { openReviews, book } = useServicesActions();
  const [activeIndex, setActiveIndex] = useState(0);
  const { c, layout: L } = useServicesTheme();
  const { data: reviews = [], isLoading } = useCustomerReviews(6);
  const { data: stats } = useStatsOverview();
  const scrollRef = useRef<ScrollView>(null);
  const pausedRef = useRef(false);

  // Auto-advance — pauses while the user is interacting, resumes after.
  useEffect(() => {
    if (reviews.length < 2) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setActiveIndex((prev) => {
        const next = (prev + 1) % reviews.length;
        scrollRef.current?.scrollTo({ x: next * L.reviewSnap, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [reviews.length, L.reviewSnap]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / L.reviewSnap);
    setActiveIndex(Math.min(Math.max(idx, 0), Math.max(reviews.length - 1, 0)));
    pausedRef.current = false;
  };

  const hasAggregate = stats?.averageRating != null && stats.averageRating > 0;

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={["#0b1f19", "#0f3d31", "#0b1f19"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.band}
      >
        {/* ---- Cinematic header ---- */}
        <Animated.View entering={FadeInUp.duration(500)} style={[styles.header, { paddingHorizontal: L.pad }]}>
          <View style={styles.kickerRow}>
            <LinearGradient
              colors={["#34d399", "#2dd4bf"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.kickerBar}
            />
            <Text style={styles.overline}>Reviews</Text>
          </View>
          <Text style={styles.title}>What Our Customers Say</Text>
          <Text style={styles.subtitle}>Real experiences from verified Homeeigo bookings</Text>

          {/* Aggregate rating — live, hidden when the backend has none */}
          {hasAggregate ? (
            <View style={styles.aggregate}>
              <Text style={styles.aggScore}>{stats!.averageRating}</Text>
              <View style={styles.aggMeta}>
                <View style={styles.aggStars}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={13}
                      color="#fbbf24"
                      fill={i < Math.round(stats!.averageRating!) ? "#fbbf24" : "transparent"}
                    />
                  ))}
                </View>
                {stats!.reviewCount > 0 ? (
                  <Text style={styles.aggCount}>from {nf(stats!.reviewCount)} verified reviews</Text>
                ) : (
                  <Text style={styles.aggCount}>average rating</Text>
                )}
              </View>
            </View>
          ) : null}
        </Animated.View>

        {/* ---- Content ---- */}
        {isLoading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={L.listContent}>
            {[0, 1].map((i) => (
              <SkeletonCard key={i} width={L.reviewCardW} />
            ))}
          </ScrollView>
        ) : reviews.length === 0 ? (
          <View style={[styles.empty, { marginHorizontal: L.pad }]}>
            <View style={styles.emptyIcon}>
              <Star size={20} color="#6ee7b7" strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>No reviews yet</Text>
            <Text style={styles.emptyText}>
              Book a service and your rating will appear here for everyone to see.
            </Text>
            <BookNowButton label="Book a service" onPress={() => book()} style={styles.emptyCta} />
          </View>
        ) : (
          <>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={L.reviewSnap}
              decelerationRate="fast"
              onScrollBeginDrag={() => {
                pausedRef.current = true;
              }}
              onMomentumScrollEnd={onMomentumEnd}
              scrollEventThrottle={16}
              contentContainerStyle={L.listContent}
            >
              {reviews.map((r, index) => (
                <Animated.View
                  key={r.id}
                  entering={FadeInRight.delay(index * 80).duration(460)}
                  style={{ width: L.reviewCardW }}
                >
                  <PressableScale
                    haptic
                    scaleTo={0.98}
                    onPress={() => book({ service: r.serviceId ?? "cleaning" })}
                    style={styles.card}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.name} from ${r.location} rated ${r.rating} stars. ${r.review}`}
                  >
                    <Quote size={26} color="rgba(52,211,153,0.5)" strokeWidth={2.2} />

                    <Text style={styles.review} numberOfLines={5}>
                      {r.review}
                    </Text>

                    <View style={styles.cardFooter}>
                      <LinearGradient
                        colors={["#10b981", "#0d9488"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.avatar}
                      >
                        <Text style={styles.avatarText}>{r.initial}</Text>
                      </LinearGradient>
                      <View style={styles.meta}>
                        <Text style={styles.name} numberOfLines={1}>
                          {r.name}
                        </Text>
                        <Text style={styles.location} numberOfLines={1}>
                          {r.location}
                        </Text>
                      </View>
                      <View style={styles.starsCol}>
                        <View style={styles.stars}>
                          {Array.from({ length: r.rating }).map((_, i) => (
                            <Star key={i} size={11} color="#fbbf24" fill="#fbbf24" />
                          ))}
                        </View>
                        <View style={styles.verified}>
                          <Check size={9} color="#6ee7b7" strokeWidth={3} />
                          <Text style={styles.verifiedText}>Verified</Text>
                        </View>
                      </View>
                    </View>
                  </PressableScale>
                </Animated.View>
              ))}
            </ScrollView>

            {/* progress + view all */}
            <View style={[styles.footerRow, { paddingHorizontal: L.pad }]}>
              <View style={styles.dots}>
                {reviews.map((_, i) => (
                  <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
                ))}
              </View>
              <PressableScale
                haptic
                onPress={openReviews}
                style={styles.viewAll}
                accessibilityRole="button"
                accessibilityLabel="View all reviews"
              >
                <Text style={styles.viewAllText}>View all</Text>
                <ArrowRight size={13} color="#6ee7b7" strokeWidth={2.6} />
              </PressableScale>
            </View>
          </>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  band: { paddingVertical: 32 },

  header: { marginBottom: 24 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  kickerBar: { width: 18, height: 3, borderRadius: 2 },
  overline: { ...serviceType.overline, color: "#6ee7b7" },
  title: { color: "#fff", fontSize: 23, fontWeight: "900", letterSpacing: -0.5, lineHeight: 29 },
  subtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 6,
    lineHeight: 19,
  },

  aggregate: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 },
  aggScore: { color: "#fff", fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
  aggMeta: { gap: 3 },
  aggStars: { flexDirection: "row", gap: 2 },
  aggCount: { color: "rgba(255,255,255,0.6)", fontSize: 11.5, fontWeight: "600" },

  card: {
    gap: 12,
    padding: 20,
    borderRadius: layout.cardRadiusLg,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.18)",
    minHeight: 208,
  },
  review: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14.5,
    lineHeight: 22,
    fontWeight: "500",
    flex: 1,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.14)",
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  meta: { flex: 1, minWidth: 0 },
  name: { color: "#fff", fontSize: 13.5, fontWeight: "800", letterSpacing: -0.2 },
  location: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 1 },
  starsCol: { alignItems: "flex-end", gap: 4 },
  stars: { flexDirection: "row", gap: 1.5 },
  verified: { flexDirection: "row", alignItems: "center", gap: 3 },
  verifiedText: { color: "#6ee7b7", fontSize: 9.5, fontWeight: "800" },

  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
  },
  dots: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  dotActive: { width: 22, backgroundColor: "#34d399" },
  viewAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.35)",
  },
  viewAllText: { color: "#6ee7b7", fontSize: 12, fontWeight: "700" },

  empty: {
    alignItems: "center",
    gap: 8,
    padding: 24,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.2)",
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(52,211,153,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  emptyText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11.5,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 17,
  },
  emptyCta: { marginTop: 8, paddingHorizontal: 20 },
});

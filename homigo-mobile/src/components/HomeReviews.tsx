import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Star, BadgeCheck, Quote } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useAfterInteractive } from "@/hooks/use-after-interactive";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.82;
const SNAP = CARD_W + 16;

/** Per-card accent gradient — harmonised emerald / teal / green family so the
 *  reviews rail stays consistent with the rest of the home canvas. */
const ACCENTS: [string, string][] = [
  ["#10b981", "#0d9488"],
  ["#14b8a6", "#0f766e"],
  ["#22c55e", "#15803d"],
  ["#059669", "#047857"],
  ["#2dd4bf", "#0d9488"],
  ["#34d399", "#059669"],
];

/**
 * Customer Reviews — world-class, next-gen testimonial experience.
 * A trust-rating hero, then auto-sliding premium glass cards: gradient accent
 * bar, floating quote, full gold star row, gradient-ring avatar with a verified
 * badge, and a colored glow. Pauses while dragging; animated pagination dots.
 * Real platform reviews via useCustomerReviews (admin-moderated feed).
 */
export const HomeReviews: React.FC = () => {
  const { colors: c, isDark } = useTheme();
  const afterInteractive = useAfterInteractive();
  const { data: reviews = [] } = useCustomerReviews(6, afterInteractive);
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const dragging = useRef(false);
  const activeRef = useRef(0);

  const avg = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((s, r) => s + (r.rating || 5), 0) / reviews.length;
  }, [reviews]);

  useEffect(() => {
    if (reviews.length < 2) return;
    const id = setInterval(() => {
      if (dragging.current) return;
      const next = (activeRef.current + 1) % reviews.length;
      activeRef.current = next;
      setActive(next);
      scrollRef.current?.scrollTo({ x: next * SNAP, animated: true });
    }, 3400);
    return () => clearInterval(id);
  }, [reviews.length]);

  if (!reviews.length) return null;

  const cardBg = isDark ? "rgba(255,255,255,0.045)" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.10)" : "rgba(16,185,129,0.16)";
  const chipBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(16,185,129,0.08)";
  const accentText = isDark ? "#6ee7b7" : "#047857";

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SNAP);
    activeRef.current = i;
    setActive(i);
  };

  return (
    <View style={styles.container}>
      {/* ---- Header ---- */}
      <View style={styles.header}>
        <View style={[styles.eyebrow, { backgroundColor: chipBg }]}>
          <Star size={11} color={accentText} fill={accentText} strokeWidth={0} />
          <Text style={[styles.eyebrowText, { color: accentText }]}>TESTIMONIALS</Text>
        </View>
        <Text style={[styles.title, { color: c.text }]}>Loved by customers</Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>
          Real experiences from verified Homeeigo bookings
        </Text>
      </View>

      {/* ---- Trust rating hero ---- */}
      <View style={[styles.hero, { backgroundColor: cardBg, borderColor: border }, shadowStyles.md]}>
        <LinearGradient
          colors={["#10b981", "#0d9488"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroScore}
        >
          <Text style={styles.heroScoreText}>{avg ? avg.toFixed(1) : "5.0"}</Text>
          <View style={styles.heroScoreStars}>
            {Array.from({ length: 5 }).map((_, s) => (
              <Star key={s} size={8} color="#fff" fill="#fff" strokeWidth={0} />
            ))}
          </View>
        </LinearGradient>
        <View style={styles.heroRight}>
          <Text style={[styles.heroTitle, { color: c.text }]}>Excellent service</Text>
          <Text style={[styles.heroMeta, { color: c.textSecondary }]}>
            Rated by verified Homeeigo customers
          </Text>
          <View style={styles.heroChips}>
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <BadgeCheck size={12} color={accentText} />
              <Text style={[styles.chipText, { color: accentText }]}>Verified</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <Text style={[styles.chipText, { color: accentText }]}>Real bookings</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ---- Auto-sliding premium carousel ---- */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={SNAP}
        snapToAlignment="start"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => (dragging.current = true)}
        onScrollEndDrag={() => (dragging.current = false)}
        contentContainerStyle={styles.list}
      >
        {reviews.map((r, i) => {
          const [a1, a2] = ACCENTS[i % ACCENTS.length];
          const initial = (r.name?.trim()?.[0] ?? "H").toUpperCase();
          return (
            <View key={`${r.id}-${i}`} style={[styles.card, { shadowColor: a1 }, shadowStyles.lg]}>
              <LinearGradient
                colors={
                  isDark
                    ? ["rgba(255,255,255,0.05)", "rgba(255,255,255,0.02)"]
                    : ["#ffffff", "#f3fbf7"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.cardFill, { borderColor: border }]}
              >
                {/* gradient accent bar */}
                <LinearGradient
                  colors={[a1, a2]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.accentBar}
                />

                {/* floating quote + full star row */}
                <View style={styles.cardTop}>
                  <Quote
                    size={30}
                    color={isDark ? "rgba(110,231,183,0.4)" : `${a1}55`}
                    fill={isDark ? "rgba(110,231,183,0.18)" : `${a1}22`}
                  />
                  <View style={styles.stars}>
                    {Array.from({ length: 5 }).map((_, s) => (
                      <Star
                        key={s}
                        size={14}
                        color="#f59e0b"
                        fill={s < Math.round(r.rating) ? "#f59e0b" : "transparent"}
                        strokeWidth={2}
                      />
                    ))}
                  </View>
                </View>

                {/* review text */}
                <Text style={[styles.reviewText, { color: c.text }]} numberOfLines={4}>
                  {r.review}
                </Text>

                <View style={[styles.divider, { backgroundColor: border }]} />

                {/* footer: gradient-ring avatar + verified badge + name */}
                <View style={styles.footer}>
                  <View style={styles.avatarWrap}>
                    <LinearGradient
                      colors={[a1, a2]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.avatarRing}
                    >
                      <View style={[styles.avatarInner, { backgroundColor: cardBg }]}>
                        <Text style={[styles.avatarText, { color: a1 }]}>{initial}</Text>
                      </View>
                    </LinearGradient>
                    <View style={[styles.verifyDot, { borderColor: cardBg }]}>
                      <BadgeCheck size={13} color="#fff" fill="#10b981" />
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={[styles.loc, { color: c.textSecondary }]} numberOfLines={1}>
                      {r.location}
                    </Text>
                  </View>
                </View>
              </LinearGradient>
            </View>
          );
        })}
      </ScrollView>

      {/* ---- Animated pagination dots ---- */}
      <View style={styles.dots}>
        {reviews.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === active
                ? { width: 22, backgroundColor: isDark ? "#6ee7b7" : "#10b981" }
                : { backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(16,185,129,0.25)" },
            ]}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 22 },
  header: { paddingHorizontal: 24, marginBottom: 14 },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  eyebrowText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, fontWeight: "500", marginTop: 4 },

  hero: {
    marginHorizontal: 24,
    marginBottom: 18,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  heroScore: {
    width: 66,
    height: 66,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  heroScoreText: { color: "#fff", fontSize: 25, fontWeight: "900", letterSpacing: -0.5 },
  heroScoreStars: { flexDirection: "row", gap: 1.5, marginTop: 2 },
  heroRight: { flex: 1 },
  heroTitle: { fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2 },
  heroMeta: { fontSize: 11.5, fontWeight: "500", marginTop: 2 },
  heroChips: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: { fontSize: 10.5, fontWeight: "700" },

  list: { paddingHorizontal: 24, gap: 16, paddingVertical: 4, paddingBottom: 8 },
  card: {
    width: CARD_W,
    borderRadius: 26,
  },
  cardFill: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 20,
    paddingTop: 24,
    overflow: "hidden",
  },
  accentBar: { position: "absolute", top: 0, left: 0, right: 0, height: 4 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  stars: { flexDirection: "row", gap: 2 },
  reviewText: { fontSize: 14.5, fontWeight: "500", lineHeight: 22, marginTop: 10, marginBottom: 16 },
  divider: { height: 1, marginBottom: 14 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { position: "relative" },
  avatarRing: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  avatarInner: {
    width: "100%",
    height: "100%",
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontWeight: "900" },
  verifyDot: {
    position: "absolute",
    bottom: -3,
    right: -3,
    borderRadius: 999,
    borderWidth: 2,
  },
  name: { fontSize: 14, fontWeight: "800" },
  loc: { fontSize: 11.5, fontWeight: "600", marginTop: 1 },

  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 16 },
  dot: { width: 7, height: 7, borderRadius: 999 },
});

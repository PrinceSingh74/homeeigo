import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  Star,
  ShieldCheck,
  Briefcase,
  Clock,
  CheckCircle2,
  MapPin,
  Calendar,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { useProviderDetailQuery, useProviderReviewsQuery } from "@/hooks/use-core-data";
import { openBook } from "@/lib/navigation";
import { spacing, type, radius, screenPadding } from "@/lib/typography";
import { shadowStyles, gradients } from "@/lib/colors";

export default function ProviderDetailScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailQuery = useProviderDetailQuery(id);
  const reviewsQuery = useProviderReviewsQuery(id);

  const provider = detailQuery.data?.provider;
  const reviews = reviewsQuery.data?.reviews ?? [];
  const primaryServiceId = provider?.services?.[0]?.id;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.backBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={c.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Provider details</Text>
      </View>

      {detailQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
          <Text style={[styles.muted, { color: c.textSecondary }]}>Loading profile…</Text>
        </View>
      ) : detailQuery.isError || !provider ? (
        <View style={styles.center}>
          <Text style={[styles.stateTitle, { color: c.text }]}>Couldn't load this provider</Text>
          <Text style={[styles.stateBody, { color: c.textSecondary }]}>
            Please check your connection and try again.
          </Text>
          <Pressable
            onPress={() => void detailQuery.refetch()}
            style={[styles.cta, { backgroundColor: c.primary }]}
          >
            <Text style={styles.ctaText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
          {/* Profile header */}
          <View style={[styles.profileCard, { paddingHorizontal: screenPadding }]}>
            <View style={styles.avatarWrap}>
              {provider.profileImage ? (
                <Image source={{ uri: provider.profileImage }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={gradients.hero} style={styles.avatar}>
                  <Text style={styles.avatarInitial}>{provider.name.charAt(0).toUpperCase()}</Text>
                </LinearGradient>
              )}
              {provider.isOnline ? <View style={[styles.online, { borderColor: c.bg }]} /> : null}
            </View>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: c.text }]}>{provider.name}</Text>
              {provider.isVerified ? <ShieldCheck size={18} color={c.success} strokeWidth={2.4} /> : null}
            </View>
            {provider.city ? (
              <View style={styles.cityRow}>
                <MapPin size={13} color={c.textSecondary} strokeWidth={2} />
                <Text style={[styles.city, { color: c.textSecondary }]}>{provider.city}</Text>
              </View>
            ) : null}
            <View style={styles.ratingPill}>
              <Star size={14} color={c.gold} fill={c.gold} strokeWidth={0} />
              <Text style={[styles.ratingValue, { color: c.text }]}>
                {(provider.rating ?? 0).toFixed(1)}
              </Text>
              <Text style={[styles.ratingCount, { color: c.textSecondary }]}>
                ({provider.reviewCount ?? 0} reviews)
              </Text>
            </View>
            {provider.bio ? (
              <Text style={[styles.bio, { color: c.textSecondary }]}>{provider.bio}</Text>
            ) : null}
          </View>

          {/* Stat tiles */}
          <View style={[styles.statRow, { paddingHorizontal: screenPadding }]}>
            <StatTile
              c={c}
              icon={<Briefcase size={18} color={c.primary} strokeWidth={2} />}
              value={String(provider.completedJobs ?? 0)}
              label="Jobs done"
            />
            <StatTile
              c={c}
              icon={<Star size={18} color={c.gold} strokeWidth={2} />}
              value={`${provider.yearsOfExperience ?? 0}y`}
              label="Experience"
            />
            <StatTile
              c={c}
              icon={<CheckCircle2 size={18} color={c.success} strokeWidth={2} />}
              value={`${Math.round((provider.acceptanceRate ?? 0) * 100)}%`}
              label="Acceptance"
            />
            <StatTile
              c={c}
              icon={<Clock size={18} color={c.tealDeep} strokeWidth={2} />}
              value={provider.responseTime ? `${provider.responseTime}m` : "—"}
              label="Responds"
            />
          </View>

          {/* Badges */}
          {provider.badges && provider.badges.length > 0 ? (
            <Section c={c} label="Badges">
              <View style={styles.badgeWrap}>
                {provider.badges.map((b) => (
                  <View
                    key={b}
                    style={[styles.badge, { backgroundColor: `${c.primary}14`, borderColor: `${c.primary}30` }]}
                  >
                    <Text style={[styles.badgeText, { color: c.primary }]}>{b}</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {/* Services + pricing */}
          {provider.services && provider.services.length > 0 ? (
            <Section c={c} label="Services & pricing">
              <View style={{ gap: spacing.sm }}>
                {provider.services.map((s) => (
                  <View
                    key={s.id}
                    style={[styles.svcRow, { backgroundColor: c.cardBg, borderColor: c.border }]}
                  >
                    <Text style={[styles.svcName, { color: c.text }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={[styles.svcPrice, { color: c.primary }]}>
                      {typeof s.basePrice === "number" ? `₹${s.basePrice}` : "—"}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {/* Reviews */}
          <Section c={c} label={`Reviews${reviews.length ? ` (${reviews.length})` : ""}`}>
            {reviewsQuery.isLoading ? (
              <ActivityIndicator color={c.primary} style={{ marginVertical: spacing.lg }} />
            ) : reviews.length === 0 ? (
              <Text style={[styles.emptyReviews, { color: c.textSecondary }]}>
                No reviews yet for this provider.
              </Text>
            ) : (
              <View style={{ gap: spacing.md }}>
                {reviews.map((r) => (
                  <View
                    key={r.id}
                    style={[styles.reviewCard, { backgroundColor: c.cardBg, borderColor: c.border }]}
                  >
                    <View style={styles.reviewHead}>
                      <Text style={[styles.reviewName, { color: c.text }]}>
                        {r.userName ?? "Customer"}
                      </Text>
                      <View style={styles.reviewStars}>
                        <Star size={12} color={c.gold} fill={c.gold} strokeWidth={0} />
                        <Text style={[styles.reviewRating, { color: c.text }]}>{r.rating.toFixed(1)}</Text>
                      </View>
                    </View>
                    {r.reviewText ? (
                      <Text style={[styles.reviewText, { color: c.textSecondary }]}>{r.reviewText}</Text>
                    ) : null}
                    {r.providerResponse ? (
                      <View style={[styles.responseBox, { backgroundColor: `${c.primary}0D` }]}>
                        <Text style={[styles.responseLabel, { color: c.primary }]}>Provider replied</Text>
                        <Text style={[styles.reviewText, { color: c.textSecondary }]}>
                          {r.providerResponse}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </Section>
        </ScrollView>
      )}

      {provider && primaryServiceId ? (
        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>
          <Pressable
            onPress={() =>
              openBook(router, { providerId: provider.id, service: primaryServiceId })
            }
            style={[styles.bookBtn, { backgroundColor: c.primary }]}
          >
            <Calendar size={18} color="#fff" />
            <Text style={styles.bookBtnText}>Book {provider.name.split(" ")[0]}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function StatTile({
  c,
  icon,
  value,
  label,
}: {
  c: ReturnType<typeof useTheme>["colors"];
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: c.cardBg, borderColor: c.border }, shadowStyles.sm]}>
      {icon}
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.textSecondary }]}>{label}</Text>
    </View>
  );
}

function Section({
  c,
  label,
  children,
}: {
  c: ReturnType<typeof useTheme>["colors"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { paddingHorizontal: screenPadding }]}>
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollBody: { paddingBottom: 140 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { ...type.bodyBold, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: screenPadding },
  muted: { ...type.caption },
  profileCard: { alignItems: "center", paddingTop: spacing["2xl"] },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInitial: { ...type.display, color: "#fff", fontSize: 38 },
  online: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    backgroundColor: "#10B981",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  name: { ...type.title, fontSize: 22, letterSpacing: -0.4 },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  city: { ...type.caption },
  ratingPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.sm },
  ratingValue: { ...type.bodyBold, fontSize: 15 },
  ratingCount: { ...type.caption },
  bio: { ...type.body, textAlign: "center", marginTop: spacing.md, lineHeight: 22, maxWidth: 320 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing["2xl"] },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    gap: 4,
  },
  statValue: { ...type.bodyBold, fontSize: 16 },
  statLabel: { ...type.caption, fontSize: 10 },
  section: { marginTop: spacing["2xl"] },
  sectionLabel: { ...type.overline, marginBottom: spacing.md, letterSpacing: 1, fontSize: 10 },
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
  badgeText: { ...type.caption, fontWeight: "700" },
  svcRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  svcName: { ...type.body, flex: 1 },
  svcPrice: { ...type.bodyBold, fontSize: 15 },
  emptyReviews: { ...type.body, paddingVertical: spacing.md },
  reviewCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewName: { ...type.bodyBold, fontSize: 14 },
  reviewStars: { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewRating: { ...type.caption, fontWeight: "800" },
  reviewText: { ...type.body, lineHeight: 21 },
  responseBox: { borderRadius: radius.md, padding: spacing.sm, gap: 2 },
  responseLabel: { ...type.caption, fontWeight: "700" },
  cta: { paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, borderRadius: radius.pill },
  ctaText: { ...type.bodyBold, color: "#fff" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: screenPadding,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  bookBtnText: { ...type.bodyBold, color: "#fff", fontSize: 16 },
  stateTitle: { ...type.title, fontSize: 18, textAlign: "center" },
  stateBody: { ...type.body, textAlign: "center", maxWidth: 280, lineHeight: 22 },
});

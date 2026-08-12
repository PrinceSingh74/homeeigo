import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Search, Star, MapPin, Clock, ShieldCheck, Users } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { useServicesQuery, useMatchedProvidersQuery, useProvidersQuery } from "@/hooks/use-core-data";
import { useDeviceCoordinates } from "@/hooks/use-device-coordinates";
import { useAuthStore } from "@/stores/auth-store";
import { spacing, type, radius, screenPadding } from "@/lib/typography";
import { shadowStyles, gradients } from "@/lib/colors";
import type { BackendMatchedProvider, BackendProvider } from "@/types/backend";

/** Unified provider card shape (search + match results normalised). */
type ProviderRow = {
  id: string;
  name: string;
  profileImage?: string | null;
  rating: number;
  reviews: number;
  distanceKm?: number;
  etaMin?: number;
  isOnline: boolean;
  available?: boolean;
};

function fromMatched(p: BackendMatchedProvider): ProviderRow {
  return {
    id: p.providerId,
    name: p.name,
    profileImage: p.profileImage,
    rating: p.rating ?? 0,
    reviews: p.totalReviews ?? 0,
    distanceKm: p.distance,
    etaMin: p.eta,
    isOnline: p.isOnline,
    available: p.availability,
  };
}

function fromSearch(p: BackendProvider): ProviderRow {
  return {
    id: p.id,
    name: p.name,
    profileImage: p.profileImage,
    rating: p.rating ?? 0,
    reviews: p.reviewCount ?? 0,
    distanceKm: p.distance,
    etaMin: p.eta,
    isOnline: p.isOnline ?? false,
  };
}

/**
 * Memoised row: the results list is virtualised, so rows must not re-render when
 * the parent's search text or query state changes.
 */
const ProviderCard = React.memo(function ProviderCard({
  p,
  c,
  onPress,
}: {
  p: ProviderRow;
  c: ReturnType<typeof useTheme>["colors"];
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(p.id)}
      style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.border }, shadowStyles.sm]}
    >
      <View style={styles.avatarWrap}>
        {p.profileImage ? (
          <Image source={{ uri: p.profileImage }} style={styles.avatar} />
        ) : (
          <LinearGradient colors={gradients.hero} style={styles.avatar}>
            <Text style={styles.avatarInitial}>{p.name.charAt(0).toUpperCase()}</Text>
          </LinearGradient>
        )}
        {p.isOnline ? <View style={[styles.online, { borderColor: c.cardBg }]} /> : null}
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {p.name}
          </Text>
          <ShieldCheck size={14} color={c.success} strokeWidth={2.4} />
        </View>
        <View style={styles.metaRow}>
          <Star size={13} color={c.gold} fill={c.gold} strokeWidth={0} />
          <Text style={[styles.metaStrong, { color: c.text }]}>{p.rating.toFixed(1)}</Text>
          <Text style={[styles.meta, { color: c.textSecondary }]}>({p.reviews})</Text>
          {typeof p.distanceKm === "number" ? (
            <>
              <MapPin size={13} color={c.textSecondary} strokeWidth={2} />
              <Text style={[styles.meta, { color: c.textSecondary }]}>
                {p.distanceKm.toFixed(1)} km
              </Text>
            </>
          ) : null}
          {typeof p.etaMin === "number" ? (
            <>
              <Clock size={13} color={c.textSecondary} strokeWidth={2} />
              <Text style={[styles.meta, { color: c.textSecondary }]}>{p.etaMin} min</Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

export default function ProviderSearchScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const params = useLocalSearchParams<{ serviceId?: string }>();
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const { coords } = useDeviceCoordinates();

  const servicesQuery = useServicesQuery();
  const services = servicesQuery.data?.services ?? [];

  const [serviceId, setServiceId] = useState<string>(params.serviceId ?? "");
  const [search, setSearch] = useState("");

  // Pick a default service once the catalogue loads (search/match require a serviceId).
  const effectiveServiceId = serviceId || services[0]?.id || "";

  // Authenticated users get the richer "match" ranking (distance/eta/score);
  // unauthenticated users fall back to the public provider search.
  const matched = useMatchedProvidersQuery(effectiveServiceId, isAuthenticated, coords);
  const searched = useProvidersQuery(isAuthenticated ? "" : effectiveServiceId, coords);

  const activeQuery = isAuthenticated ? matched : searched;

  const rows: ProviderRow[] = useMemo(() => {
    const base = isAuthenticated
      ? (matched.data?.providers ?? []).map(fromMatched)
      : (searched.data?.providers ?? []).map(fromSearch);
    const q = search.trim().toLowerCase();
    return q ? base.filter((p) => p.name.toLowerCase().includes(q)) : base;
  }, [isAuthenticated, matched.data?.providers, searched.data?.providers, search]);

  const keyExtractor = useCallback((p: ProviderRow) => p.id, []);
  const openProvider = useCallback((id: string) => router.push(`/providers/${id}`), [router]);
  const renderItem = useCallback(
    ({ item }: { item: ProviderRow }) => (
      <View style={styles.rowInset}>
        <ProviderCard p={item} c={c} onPress={openProvider} />
      </View>
    ),
    [c, openProvider],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <LinearGradient
        colors={[`${c.primary}08`, "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={[styles.backBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={c.text} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.overline, { color: c.primary }]}>FIND A PRO</Text>
          <Text style={[styles.title, { color: c.text }]}>Verified providers</Text>
        </View>
      </View>

      {/* Search box */}
      <View style={[styles.searchWrap, { paddingHorizontal: screenPadding }]}>
        <View style={[styles.searchBox, { backgroundColor: c.cardBg, borderColor: c.border }]}>
          <Search size={18} color={c.textSecondary} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search providers by name"
            placeholderTextColor={c.textSecondary}
            style={[styles.searchInput, { color: c.text }]}
            returnKeyType="search"
          />
        </View>
      </View>

      {/* Service filter chips */}
      {services.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.chips, { paddingHorizontal: screenPadding }]}
        >
          {services.slice(0, 10).map((s) => {
            const active = s.id === effectiveServiceId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setServiceId(s.id)}
                style={[
                  styles.chip,
                  active
                    ? { backgroundColor: c.primary }
                    : { backgroundColor: c.cardBg, borderColor: c.border, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? "#fff" : c.text }]}>{s.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {activeQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
          <Text style={[styles.muted, { color: c.textSecondary }]}>Finding providers near you…</Text>
        </View>
      ) : activeQuery.isError ? (
        <StateBlock
          c={c}
          title="Couldn't load providers"
          body="Something went wrong reaching the server. Please try again."
          cta="Retry"
          onCta={() => void activeQuery.refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollBody}
          // Search can return a long provider list; only rows near the viewport
          // stay mounted, each of which loads a remote avatar.
          removeClippedSubviews
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          windowSize={7}
          ListHeaderComponent={
            rows.length > 0 ? (
              <Text style={[styles.count, styles.rowInset, { color: c.textSecondary }]}>
                {rows.length} {rows.length === 1 ? "provider" : "providers"} available
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <StateBlock
              c={c}
              title="No providers found"
              body={
                search
                  ? "No providers match your search. Try a different name."
                  : "No providers available for this service right now. Check back soon."
              }
              cta={search ? "Clear search" : "Retry"}
              onCta={() => (search ? setSearch("") : void activeQuery.refetch())}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function StateBlock({
  c,
  title,
  body,
  cta,
  onCta,
}: {
  c: ReturnType<typeof useTheme>["colors"];
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <View style={styles.center}>
      <View style={[styles.stateIcon, { backgroundColor: c.cardBg, borderColor: c.border }]}>
        <Users size={28} color={c.primary} strokeWidth={1.8} />
      </View>
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: c.textSecondary }]}>{body}</Text>
      <Pressable onPress={onCta} style={[styles.stateCta, { backgroundColor: c.primary }]}>
        <Text style={styles.stateCtaText}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollBody: { paddingBottom: 120, paddingTop: spacing.lg },
  // Rows carry the screen inset now that they are virtualised list items.
  rowInset: { paddingHorizontal: screenPadding, marginBottom: spacing.md },
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
  overline: { ...type.overline, letterSpacing: 1.2, fontSize: 10 },
  title: { ...type.title, fontSize: 22, letterSpacing: -0.4, marginTop: 2 },
  searchWrap: { marginTop: spacing.lg },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchInput: { ...type.body, flex: 1, padding: 0 },
  chips: { gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipText: { ...type.caption, fontWeight: "700" },
  count: { ...type.caption, fontWeight: "600", marginBottom: spacing.xs },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInitial: { ...type.title, color: "#fff", fontSize: 22 },
  online: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    backgroundColor: "#10B981",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { ...type.bodyBold, fontSize: 15, flexShrink: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, flexWrap: "wrap" },
  metaStrong: { ...type.caption, fontWeight: "800" },
  meta: { ...type.caption },
  center: { alignItems: "center", justifyContent: "center", paddingTop: spacing["3xl"], gap: spacing.md },
  muted: { ...type.caption },
  stateIcon: {
    width: 72,
    height: 72,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: { ...type.title, fontSize: 18 },
  stateBody: { ...type.body, textAlign: "center", maxWidth: 280, lineHeight: 22 },
  stateCta: { paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, borderRadius: radius.pill },
  stateCtaText: { ...type.bodyBold, color: "#fff", fontSize: 14 },
});

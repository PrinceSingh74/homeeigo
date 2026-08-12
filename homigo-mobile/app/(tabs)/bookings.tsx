import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Plus, CalendarDays, Sparkles } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore, type SavedBooking } from "@/lib/store";
import { openBook } from "@/lib/navigation";
import { gradients, shadowStyles } from "@/lib/colors";
import { spacing, type, screenPadding, radius } from "@/lib/typography";
import { bookingUi } from "@/lib/booking-ui";
import {
  filterBookings,
  countByFilter,
  type BookingFilter,
} from "@/lib/booking-status";
import { BookingCard } from "@/components/booking/BookingCard";
import { BookingDetailSheet } from "@/components/booking/BookingDetailSheet";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useBookingsQuery } from "@/hooks/use-core-data";

const FILTERS: { key: BookingFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
];

const FLOW = [
  { n: "01", label: "Book", desc: "Choose service" },
  { n: "02", label: "Track", desc: "Live updates" },
  { n: "03", label: "Done", desc: "Rebook fast" },
];

export default function BookingsScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  useBookingsQuery();
  const bookings = useAppStore((s) => s.bookings);

  const [filter, setFilter] = useState<BookingFilter>("all");
  const [selected, setSelected] = useState<SavedBooking | null>(null);

  const counts = useMemo(() => countByFilter(bookings), [bookings]);
  const filtered = useMemo(
    () => filterBookings(bookings, filter),
    [bookings, filter],
  );

  // Stable identities so memoised rows are not invalidated on every parent render
  // (filter chip taps and opening the detail sheet both re-render this screen).
  const keyExtractor = useCallback((b: SavedBooking) => b.id, []);
  const renderItem = useCallback(
    ({ item }: { item: SavedBooking }) => (
      // Rows carry the screen inset themselves now that they are list items rather
      // than children of the padded list wrapper.
      <View style={styles.rowInset}>
        <BookingCard booking={item} onPress={() => setSelected(item)} />
      </View>
    ),
    [],
  );

  return (
    <AuthGuard title="Sign in to view your bookings">
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <LinearGradient
        colors={[`${c.primary}08`, "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <View style={styles.headerMain}>
          <View style={[styles.brandMark, { backgroundColor: c.primary + "18" }]}>
            <Sparkles size={14} color={c.primary} strokeWidth={2.5} />
          </View>
          <Text style={[styles.overline, { color: c.primary }]}>Homeeigo</Text>
          <Text style={[styles.title, { color: c.text }]}>My Bookings</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Your appointments, beautifully organised — track, manage, rebook.
          </Text>
        </View>
        <Pressable
          onPress={() => openBook(router)}
          style={[styles.addBtn, shadowStyles.glowPrimary]}
          accessibilityLabel="Book new service"
        >
          <LinearGradient colors={gradients.hero} style={styles.addGrad}>
            <Plus size={22} color="#fff" strokeWidth={2.5} />
          </LinearGradient>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollBody}
        // Only the rows near the viewport stay mounted. Each card decodes a photo
        // and paints a gradient, so mounting all of them was the scroll cost here.
        removeClippedSubviews
        initialNumToRender={4}
        maxToRenderPerBatch={5}
        windowSize={7}
        ListHeaderComponent={
          <>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Journey</Text>
          <View style={styles.flowRow}>
            {FLOW.map((step) => (
              <View
                key={step.n}
                style={[
                  styles.flowCard,
                  {
                    backgroundColor: c.cardBg,
                    borderColor: "rgba(148, 163, 184, 0.25)",
                  },
                  shadowStyles.md,
                ]}
              >
                <LinearGradient
                  colors={[`${c.primary}22`, "transparent"]}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
                <Text style={[styles.flowNum, { color: c.primary }]}>{step.n}</Text>
                <Text style={[styles.flowTitle, { color: c.text }]}>{step.label}</Text>
                <Text style={[styles.flowDesc, { color: c.textSecondary }]}>{step.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {bookings.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Overview</Text>
            <View style={styles.statsRow}>
              <StatCard label="Upcoming" value={counts.upcoming} accent={c.primary} />
              <StatCard label="Completed" value={counts.completed} accent={c.success} />
              <StatCard label="Cancelled" value={counts.cancelled} accent={c.textSecondary} />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Filter</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count = counts[f.key];
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[
                    bookingUi.chip,
                    active
                      ? [shadowStyles.glowSoft, { backgroundColor: c.primary }]
                      : {
                          backgroundColor: c.cardBg,
                          borderWidth: 1,
                          borderColor: c.border,
                        },
                  ]}
                >
                  <Text style={[bookingUi.chipText, { color: active ? "#fff" : c.text }]}>
                    {f.label}
                  </Text>
                  {count > 0 ? (
                    <View
                      style={[
                        bookingUi.chipCount,
                        {
                          backgroundColor: active ? "rgba(255,255,255,0.22)" : c.bg,
                          borderColor: active ? "transparent" : c.border,
                          borderWidth: active ? 0 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipCountText,
                          { color: active ? "#fff" : c.textSecondary },
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {filtered.length > 0 ? (
          <View style={styles.list}>
            <Text style={[styles.listLabel, { color: c.textSecondary }]}>
              {filtered.length} {filtered.length === 1 ? "booking" : "bookings"}
            </Text>
          </View>
        ) : null}
          </>
        }
        ListEmptyComponent={
          bookings.length === 0 ? (
            <EmptyPanel
              title="No bookings yet"
              body="Verified pros, clear pricing, live tracking — your first booking appears here in seconds."
              cta="Book your first service"
              onCta={() => openBook(router)}
              c={c}
            />
          ) : (
            <EmptyPanel
              title={`No ${filter === "all" ? "" : filter} bookings`}
              body="Try another filter or start a fresh booking."
              cta="Book a service"
              onCta={() => openBook(router)}
              c={c}
            />
          )
        }
      />

      <BookingDetailSheet
        visible={!!selected}
        booking={selected}
        onClose={() => setSelected(null)}
      />
    </SafeAreaView>
    </AuthGuard>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: c.cardBg,
          borderColor: "rgba(148, 163, 184, 0.22)",
        },
        shadowStyles.sm,
      ]}
    >
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.textSecondary }]}>{label}</Text>
    </View>
  );
}

function EmptyPanel({
  title,
  body,
  cta,
  onCta,
  c,
}: {
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
  c: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={styles.empty}>
      <View
        style={[
          styles.emptyIcon,
          {
            borderColor: "rgba(148, 163, 184, 0.3)",
            backgroundColor: c.cardBg,
          },
          shadowStyles.md,
        ]}
      >
        <LinearGradient colors={gradients.hero} style={styles.emptyIconGrad}>
          <CalendarDays size={32} color="#fff" strokeWidth={1.8} />
        </LinearGradient>
      </View>
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.emptySub, { color: c.textSecondary }]}>{body}</Text>
      <Pressable onPress={onCta} style={[styles.emptyCta, shadowStyles.glowPrimary]}>
        <LinearGradient colors={gradients.hero} style={styles.emptyCtaGrad}>
          <Text style={styles.emptyCtaText}>{cta}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollBody: { paddingBottom: 120 },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing["2xl"],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    zIndex: 1,
  },
  headerMain: { flex: 1 },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  overline: { ...type.overline, letterSpacing: 1.4, marginBottom: 2 },
  title: {
    ...type.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -1,
    marginTop: spacing.xs,
  },
  sub: {
    ...type.body,
    marginTop: spacing.md,
    lineHeight: 23,
    maxWidth: 300,
    letterSpacing: -0.1,
  },
  addBtn: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  addGrad: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },

  section: {
    paddingHorizontal: screenPadding,
    marginTop: spacing["2xl"],
  },
  sectionLabel: {
    ...type.overline,
    marginBottom: spacing.md,
    letterSpacing: 1.1,
    fontSize: 10,
  },

  flowRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  flowCard: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    overflow: "hidden",
    minHeight: 112,
    position: "relative",
  },
  flowNum: { ...type.mono, fontSize: 11, marginBottom: spacing.xs, zIndex: 1 },
  flowTitle: { ...type.bodyBold, fontSize: 14, zIndex: 1 },
  flowDesc: { ...type.caption, marginTop: 4, textAlign: "center", zIndex: 1 },

  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
  },
  statValue: { ...type.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.8 },
  statLabel: { ...type.caption, marginTop: 6, fontWeight: "600" },

  filterScroll: {
    gap: spacing.sm,
    paddingRight: screenPadding,
  },
  chipCountText: { ...type.caption, fontWeight: "800", fontSize: 10 },

  list: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
  },
  rowInset: { paddingHorizontal: screenPadding },
  listLabel: {
    ...type.overline,
    marginBottom: spacing.md,
    letterSpacing: 0.8,
    fontSize: 10,
    textTransform: "none",
    fontWeight: "600",
  },

  empty: {
    alignItems: "center",
    paddingHorizontal: screenPadding,
    paddingTop: spacing["3xl"],
    paddingBottom: spacing["4xl"],
  },
  emptyIcon: {
    width: 92,
    height: 92,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
    overflow: "hidden",
  },
  emptyIconGrad: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...type.title,
    fontSize: 22,
    textAlign: "center",
    marginBottom: spacing.sm,
    letterSpacing: -0.4,
  },
  emptySub: {
    ...type.body,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: spacing["2xl"],
    maxWidth: 300,
  },
  emptyCta: {
    borderRadius: radius.pill,
    overflow: "hidden",
    alignSelf: "stretch",
    maxWidth: 320,
    width: "100%",
  },
  emptyCtaGrad: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  emptyCtaText: {
    ...type.bodyBold,
    color: "#fff",
    fontSize: 15,
    letterSpacing: 0.2,
  },
});

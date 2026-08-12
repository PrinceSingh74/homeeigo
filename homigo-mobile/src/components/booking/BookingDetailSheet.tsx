import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  X,
  MapPin,
  Calendar,
  User,
  MessageSquare,
  Navigation,
  XCircle,
  CheckCircle2,
  RotateCcw,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { spacing, type, screenPadding, radius } from "@/lib/typography";
import { sheetHandle } from "@/lib/booking-ui";
import type { SavedBooking } from "@/lib/store";
import { useAppStore } from "@/lib/store";
import { useCancelBookingMutation, useCancellationQuoteQuery } from "@/hooks/use-core-data";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingTimeline } from "./BookingTimeline";
import { Button } from "@/components/Button";
import { openBook } from "@/lib/navigation";
import { getServiceImage } from "@/lib/service-assets";

type Props = {
  visible: boolean;
  booking: SavedBooking | null;
  onClose: () => void;
};

export function BookingDetailSheet({ visible, booking, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const cancelMutation = useCancelBookingMutation();
  // Confirm step drives the quote fetch — the customer must see the real refund first.
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const quoteQuery = useCancellationQuoteQuery(booking?.id ?? null, cancelOpen);
  const quote = quoteQuery.data?.quote;

  React.useEffect(() => {
    if (!visible) setCancelOpen(false);
  }, [visible]);

  if (!booking) return null;

  const cfg = STATUS_CONFIG[booking.status];
  const img = getServiceImage(booking.imageKey);
  const canTrack =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canRate = booking.status === "completed";
  const canCancel =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canRebook =
    booking.status === "cancelled" || booking.status === "completed";

  function goTrackLive() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push(`/track/${booking!.id}`); // live map tracking screen
  }

  function goRateService() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    router.push(`/rate/${booking!.id}`);
  }

  function doCancel() {
    cancelMutation.mutate(booking!.id, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setCancelOpen(false);
        onClose();
      },
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close booking details"
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: c.cardBg,
              marginTop: insets.top + spacing.sm,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            },
          ]}
        >
          {/* Sticky sheet chrome — always visible, not clipped by scroll */}
          <View style={[styles.sheetTop, { borderBottomColor: c.border }]}>
            <View style={sheetHandle} />
            <View style={styles.sheetNav}>
              <View style={styles.sheetNavText}>
                <Text style={[styles.sheetTitle, { color: c.text }]}>
                  Booking details
                </Text>
                <Text style={[styles.sheetSub, { color: c.textSecondary }]}>
                  {booking.id}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={[styles.closeBtn, { backgroundColor: c.bg, borderColor: c.border }]}
                accessibilityLabel="Close"
              >
                <X size={20} color={c.text} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces
            contentContainerStyle={styles.scrollContent}
          >
            <LinearGradient
              colors={[...cfg.gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, shadowStyles.glowPrimary]}
            >
              <View style={styles.heroContent}>
                {img ? (
                  <View style={styles.heroImgWrap}>
                    <Image source={img} style={styles.heroImg} resizeMode="contain" />
                  </View>
                ) : null}
                <View style={styles.heroText}>
                  <BookingStatusBadge status={booking.status} live />
                  <Text style={styles.heroTitle}>{booking.serviceTitle}</Text>
                  <Text style={styles.heroSub}>{cfg.description}</Text>
                </View>
              </View>
            </LinearGradient>

            <View style={styles.priceBlock}>
              <Text style={[styles.mono, { color: c.primary }]}>{booking.id}</Text>
              <Text style={[styles.amount, { color: c.text }]}>
                ₹{booking.total}
                <Text style={[styles.amountSub, { color: c.textSecondary }]}> total</Text>
              </Text>
            </View>

            <View style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]}>
              <DetailRow
                icon={Calendar}
                label="Schedule"
                value={`${booking.dateLabel} · ${booking.timeLabel}`}
              />
              <DetailRow icon={MapPin} label="Address" value={booking.address} />
              <DetailRow icon={User} label="Professional" value={booking.proName} />
              <DetailRow
                icon={MessageSquare}
                label="Package"
                value={`${booking.packageName} Package`}
              />
              {booking.addons?.length ? (
                <DetailRow
                  icon={MessageSquare}
                  label="Add-ons"
                  value={booking.addons.map((a) => `${a.name} (+₹${a.price})`).join(" · ")}
                />
              ) : null}
              {booking.instructions ? (
                <DetailRow icon={MessageSquare} label="Notes" value={booking.instructions} />
              ) : null}
            </View>

            <Text style={[styles.sectionTitle, { color: c.text }]}>Status timeline</Text>
            <View
              style={[
                styles.block,
                styles.timelineBlock,
                { backgroundColor: c.bg, borderColor: c.border },
              ]}
            >
              <BookingTimeline events={booking.timeline} />
            </View>

            <View style={styles.actions}>
              {canTrack && (
                <Button
                  title="Track live"
                  onPress={goTrackLive}
                  icon={<Navigation size={18} color="#fff" />}
                />
              )}
              {canRate && (
                <Button
                  title="Rate service"
                  variant="secondary"
                  onPress={goRateService}
                  icon={<CheckCircle2 size={18} color={c.primary} />}
                />
              )}
              {canCancel && !cancelOpen && (
                <Pressable style={styles.cancelBtn} onPress={() => setCancelOpen(true)}>
                  <XCircle size={18} color={c.error} />
                  <Text style={[styles.cancelText, { color: c.error }]}>
                    Cancel booking
                  </Text>
                </Pressable>
              )}

              {/* Cancellation confirm — shows the REAL refund from the live policy
                  before the customer commits. Never claims "free" on its own. */}
              {canCancel && cancelOpen && (
                <View style={[styles.cancelPanel, { borderColor: c.border, backgroundColor: c.cardBg }]}>
                  <Text style={[styles.cancelPanelTitle, { color: c.text }]}>Cancel this booking?</Text>

                  {quoteQuery.isLoading ? (
                    <Text style={[styles.cancelPanelBody, { color: c.textSecondary }]}>
                      Calculating your refund…
                    </Text>
                  ) : quote ? (
                    <>
                      <Text style={[styles.cancelPanelBody, { color: c.textSecondary }]}>
                        {quote.message}
                      </Text>
                      <View style={[styles.refundRow, { borderTopColor: c.border }]}>
                        <Text style={[styles.refundLabel, { color: c.textSecondary }]}>Paid</Text>
                        <Text style={[styles.refundValue, { color: c.text }]}>₹{quote.paidAmount}</Text>
                      </View>
                      {quote.feeAmount > 0 && (
                        <View style={styles.refundRow}>
                          <Text style={[styles.refundLabel, { color: c.textSecondary }]}>
                            Cancellation fee ({quote.feePercent}%)
                          </Text>
                          <Text style={[styles.refundValue, { color: c.error }]}>
                            −₹{quote.feeAmount}
                          </Text>
                        </View>
                      )}
                      <View style={styles.refundRow}>
                        <Text style={[styles.refundLabel, { color: c.text, fontWeight: "700" }]}>
                          You get back
                        </Text>
                        <Text style={[styles.refundTotal, { color: c.primary }]}>
                          ₹{quote.refundAmount}
                        </Text>
                      </View>
                      <Text style={[styles.refundHint, { color: c.textSecondary }]}>
                        {quote.refundMethodHint === "wallet_instant"
                          ? "Refunded instantly to your Homeeigo wallet."
                          : "Card/UPI refunds usually arrive in 5–7 business days."}
                      </Text>
                    </>
                  ) : (
                    <Text style={[styles.cancelPanelBody, { color: c.textSecondary }]}>
                      Couldn&apos;t load the refund amount. You can still cancel — the refund
                      follows our cancellation policy.
                    </Text>
                  )}

                  <View style={styles.cancelActions}>
                    <Pressable
                      style={[styles.keepBtn, { borderColor: c.border }]}
                      onPress={() => setCancelOpen(false)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.keepText, { color: c.text }]}>Keep booking</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.confirmCancelBtn, { backgroundColor: c.error }]}
                      onPress={doCancel}
                      disabled={cancelMutation.isPending}
                      accessibilityRole="button"
                    >
                      <Text style={styles.confirmCancelText}>
                        {cancelMutation.isPending ? "Cancelling…" : "Confirm cancel"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {canRebook && (
                <Button
                  title="Book again"
                  variant="premium"
                  onPress={() => {
                    onClose();
                    openBook(router, { service: booking.serviceId });
                  }}
                  icon={<RotateCcw size={18} color="#fff" />}
                />
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.detailRow}>
      <View style={[styles.detailIcon, { backgroundColor: c.primary + "12" }]}>
        <Icon size={16} color={c.primary} />
      </View>
      <View style={styles.detailBody}>
        <Text style={[styles.detailLabel, { color: c.textSecondary }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: c.text }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.52)",
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    overflow: "hidden",
    maxHeight: "94%",
  },
  sheetTop: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sheetNavText: { flex: 1, paddingRight: spacing.md },
  sheetTitle: { ...type.title, fontSize: 20 },
  sheetSub: { ...type.mono, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingTop: spacing.lg,
    paddingHorizontal: screenPadding,
    paddingBottom: spacing["3xl"],
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    minHeight: 152,
    overflow: "hidden",
  },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  heroImgWrap: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  heroImg: { width: 72, height: 72 },
  heroText: { flex: 1, gap: spacing.sm },
  heroTitle: { color: "#fff", ...type.title, fontSize: 22 },
  heroSub: { color: "rgba(255,255,255,0.88)", ...type.small, lineHeight: 20 },
  priceBlock: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  mono: { ...type.mono, marginBottom: spacing.xs },
  amount: { ...type.priceLg, fontSize: 32 },
  amountSub: { ...type.small, fontWeight: "500" },
  block: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  timelineBlock: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.section,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  detailBody: { flex: 1 },
  detailLabel: { ...type.overline },
  detailValue: { ...type.body, marginTop: 4 },
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  cancelText: { ...type.bodyBold },

  cancelPanel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 6,
  },
  cancelPanelTitle: { ...type.bodyBold, fontSize: 15 },
  cancelPanelBody: { ...type.caption, lineHeight: 18 },
  refundRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 6,
  },
  refundLabel: { ...type.caption },
  refundValue: { ...type.caption, fontWeight: "700" },
  refundTotal: { ...type.bodyBold, fontSize: 17 },
  refundHint: { ...type.caption, fontSize: 11, marginTop: 2 },
  cancelActions: { flexDirection: "row", gap: 10, marginTop: spacing.sm },
  keepBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  keepText: { ...type.bodyBold, fontSize: 14 },
  confirmCancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: radius.md,
  },
  confirmCancelText: { ...type.bodyBold, fontSize: 14, color: "#fff" },
});

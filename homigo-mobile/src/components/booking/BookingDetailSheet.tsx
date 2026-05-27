import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
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
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);

  if (!booking) return null;

  const cfg = STATUS_CONFIG[booking.status];
  const img = getServiceImage(booking.imageKey);
  const canTrack = booking.status === "confirmed";
  const canComplete =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canCancel =
    booking.status === "confirmed" || booking.status === "in_progress";
  const canRebook =
    booking.status === "cancelled" || booking.status === "completed";

  function setStatus(status: SavedBooking["status"], message: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateBookingStatus(booking!.id, status);
    showToast(message);
    onClose();
  }

  function confirmCancel() {
    Alert.alert(
      "Cancel booking?",
      "You won't be charged. You can book again anytime.",
      [
        { text: "Keep booking", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: () =>
            setStatus("cancelled", "Booking cancelled successfully"),
        },
      ],
    );
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
              style={[styles.hero, shadowStyles.glowBlue]}
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
                  onPress={() => setStatus("in_progress", "Pro is on the way!")}
                  icon={<Navigation size={18} color="#fff" />}
                />
              )}
              {canComplete && (
                <Button
                  title="Mark as completed"
                  variant="secondary"
                  onPress={() =>
                    setStatus("completed", "Thanks! Service marked complete")
                  }
                  icon={<CheckCircle2 size={18} color={c.primary} />}
                />
              )}
              {canCancel && (
                <Pressable style={styles.cancelBtn} onPress={confirmCancel}>
                  <XCircle size={18} color={c.error} />
                  <Text style={[styles.cancelText, { color: c.error }]}>
                    Cancel booking
                  </Text>
                </Pressable>
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
});

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
  TextInput,
  useWindowDimensions,
  Platform,
  Modal,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  Bell,
  MapPin,
  ChevronDown,
  Check,
  Star,
  Sparkles,
  Lock,
  Flame,
  Scissors,
  Calendar,
  Clock,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";
import {
  ADDONS,
  BOOKING_TIMES,
  popularPackageIndex,
  getLocation,
} from "@/lib/services";
import { useCatalogServices, getServiceIndexFromCatalog } from "@/hooks/use-catalog";
import {
  useAddressesQuery,
  useCreateBookingMutation,
  useCreateAddressMutation,
  mapBackendBookingToSaved,
} from "@/hooks/use-core-data";
import { useBookingPayment, type BookingPaymentState } from "@/hooks/use-booking-payment";
import { preloadRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { buildAddressCreatePayload } from "@/lib/addresses";
import { AuthGuard } from "@/components/auth/AuthGuard";
import {
  defaultScheduledSlot,
  formatDateLabel,
  formatTimeLabel,
  toYmdLocal,
  toHm24Local,
  parseYmdLocal,
  parseHm24OnDate,
  apply12hTimeOnDate,
  applyDatePart,
  applyTimePart,
  sameCalendarDay,
} from "@/lib/booking-datetime";
import { getErrorMessage, AuthApiError } from "@/lib/auth/errors";
import { calculateTotal } from "@/lib/booking";
import { getServiceImage } from "@/lib/service-assets";
import { useAppStore } from "@/lib/store";
import { createBookStyles } from "@/lib/book-styles";
import { radius, type as typo } from "@/lib/typography";
import { Button } from "@/components/Button";
import { LocationSheet } from "@/components/booking/LocationSheet";
import { BookingSuccessModal } from "@/components/booking/BookingSuccessModal";
import { BookingSectionHeader } from "@/components/booking/BookingSectionHeader";

const STEPS = ["Service", "Package", "Schedule", "Confirm"];

/** Stages of the confirm → pay → verify sequence, in the order they occur. */
type CheckoutStage = "idle" | "booking" | "order" | "checkout" | "verifying";

const CHECKOUT_STAGE_LABEL: Record<Exclude<CheckoutStage, "idle">, string> = {
  booking: "Creating booking…",
  order: "Preparing payment…",
  checkout: "Waiting for payment…",
  verifying: "Confirming payment…",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function quickDayTitle(d: Date): string {
  const today = startOfDay(new Date());
  const dd = startOfDay(d);
  if (dd.getTime() === today.getTime()) return "Today";
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function quickDaySubtitle(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function BookScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createBookStyles(width), [width]);

  const params = useLocalSearchParams<{
    service?: string;
    package?: string;
    promo?: string;
    providerId?: string;
  }>();
  const { colors: c, isDark } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const scheduleY = useRef(0);
  const summaryY = useRef(0);

  const locationId = useAppStore((s) => s.locationId);
  const activePromo = useAppStore((s) => s.activePromo);
  const setActivePromo = useAppStore((s) => s.setActivePromo);
  const showToast = useAppStore((s) => s.showToast);
  const { services: catalogServices } = useCatalogServices();
  const { data: addressData } = useAddressesQuery();
  const createBooking = useCreateBookingMutation();
  const { payForBooking } = useBookingPayment();
  const createAddress = useCreateAddressMutation();

  const initialIdx = params.service
    ? getServiceIndexFromCatalog(catalogServices, String(params.service))
    : 0;
  const initialPkg = params.package
    ? Number(params.package)
    : popularPackageIndex(catalogServices[initialIdx] ?? catalogServices[0]!);

  const [serviceIdx, setServiceIdx] = useState(initialIdx);
  const [pkgIdx, setPkgIdx] = useState(initialPkg);
  const [scheduledAt, setScheduledAt] = useState(() => defaultScheduledSlot());
  const [manualDateStr, setManualDateStr] = useState(() =>
    toYmdLocal(defaultScheduledSlot()),
  );
  const [manualTimeStr, setManualTimeStr] = useState(() =>
    toHm24Local(defaultScheduledSlot()),
  );
  const [androidPicker, setAndroidPicker] = useState<"date" | "time" | null>(null);
  const [iosPicker, setIosPicker] = useState<"date" | "time" | null>(null);
  const [iosDraft, setIosDraft] = useState(() => defaultScheduledSlot());
  const [addons, setAddons] = useState<Set<number>>(new Set());
  const [instructions, setInstructions] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [flowStep, setFlowStep] = useState(1);
  // Narrates the confirm → pay → verify sequence on the footer button so the user is
  // never left staring at one opaque spinner while Razorpay is being prepared.
  const [checkoutStage, setCheckoutStage] = useState<CheckoutStage>("idle");
  const [paymentState, setPaymentState] = useState<BookingPaymentState>("pending");
  const [successBooking, setSuccessBooking] = useState<
    import("@/lib/store").SavedBooking | null
  >(null);

  const svc = catalogServices[serviceIdx] ?? catalogServices[0]!;
  const selected = svc.packages[pkgIdx] ?? svc.packages[0];
  const loc = getLocation(locationId);

  const quickDays = useMemo(() => {
    const arr: Date[] = [];
    const today = startOfDay(new Date());
    for (let i = 0; i < 6; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);

  // Payment follows booking — warm the Razorpay module now so the pay tap
  // doesn't stall on an on-demand bundle load.
  useEffect(() => {
    preloadRazorpayCheckout();
  }, []);

  useEffect(() => {
    setManualDateStr(toYmdLocal(scheduledAt));
    setManualTimeStr(toHm24Local(scheduledAt));
  }, [scheduledAt]);

  useEffect(() => {
    if (params.promo) {
      setActivePromo(String(params.promo));
      showToast(`Promo ${params.promo} applied`);
    }
  }, [params.promo]);

  const addonTotal = useMemo(
    () => [...addons].reduce((s, i) => s + ADDONS[i].price, 0),
    [addons],
  );
  // Match the server price exactly: baseAmount = selected package price + add-ons.
  // (Was calculateTotal(svc.priceFrom) — ignored both the tier AND add-ons, so the
  // summary under-charged vs what the backend actually bills.)
  const pricing = useMemo(
    () => calculateTotal(selected.price + addonTotal),
    [selected.price, addonTotal],
  );

  const currentStep = successBooking || confirming ? 3 : flowStep;

  const scrollToY = (y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  };

  const selectService = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setServiceIdx(i);
    setPkgIdx(popularPackageIndex(catalogServices[i]!));
    setAddons(new Set());
    setFlowStep(1);
    showToast(`${catalogServices[i]!.title} selected`);
  };

  const selectPackage = (i: number) => {
    Haptics.selectionAsync();
    setPkgIdx(i);
    setFlowStep(2);
    scrollToY(scheduleY.current);
  };

  const selectQuickDay = (d: Date) => {
    Haptics.selectionAsync();
    let next = applyDatePart(scheduledAt, d);
    // Keeping the old time part can land in the past when switching to today —
    // bump to the first future quick slot so the summary is always bookable.
    if (next.getTime() <= Date.now()) {
      const future = BOOKING_TIMES.map((t) => apply12hTimeOnDate(next, t)).find(
        (x): x is Date => !!x && x.getTime() > Date.now(),
      );
      if (future) next = future;
    }
    setScheduledAt(next);
    setFlowStep(2);
  };

  const selectQuickTime = (label: string) => {
    Haptics.selectionAsync();
    const next = apply12hTimeOnDate(scheduledAt, label);
    if (next) {
      setScheduledAt(next);
      setFlowStep(3);
      scrollToY(summaryY.current);
    }
  };

  const openNativeDatePicker = () => {
    Haptics.selectionAsync();
    if (Platform.OS === "android") setAndroidPicker("date");
    else {
      setIosDraft(scheduledAt);
      setIosPicker("date");
    }
  };

  const openNativeTimePicker = () => {
    Haptics.selectionAsync();
    if (Platform.OS === "android") setAndroidPicker("time");
    else {
      setIosDraft(scheduledAt);
      setIosPicker("time");
    }
  };

  const applyManualDate = () => {
    const day = parseYmdLocal(manualDateStr);
    if (!day) {
      showToast("Invalid date — use YYYY-MM-DD");
      setManualDateStr(toYmdLocal(scheduledAt));
      return;
    }
    setScheduledAt(applyDatePart(scheduledAt, day));
  };

  const applyManualTime = () => {
    const t = parseHm24OnDate(manualTimeStr, scheduledAt);
    if (!t) {
      showToast("Invalid time — use HH:MM (24h)");
      setManualTimeStr(toHm24Local(scheduledAt));
      return;
    }
    setScheduledAt(t);
  };

  const confirmIosPicker = () => {
    if (!iosPicker) return;
    setScheduledAt((prev) =>
      iosPicker === "date" ? applyDatePart(prev, iosDraft) : applyTimePart(prev, iosDraft),
    );
    setIosPicker(null);
  };
  const toggleAddon = (i: number) => {
    Haptics.selectionAsync();
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const applyAiPackage = () => {
    const rec = popularPackageIndex(svc);
    selectPackage(rec);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast("AI picked Standard — best for 2BHK");
  };

  /**
   * Opens Razorpay for an already-created booking and reports whether money actually
   * moved. Never throws: an unpaid booking is a state the UI has to show, not a crash.
   */
  async function runCheckout(bookingId: string): Promise<BookingPaymentState> {
    try {
      const outcome = await payForBooking({
        bookingId,
        amount: pricing.total,
        description: `${svc.title} booking`,
        onPhase: (phase) =>
          setCheckoutStage(phase === "creating-order" ? "order" : phase),
        onVerified: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      });
      if (outcome.status === "paid") return "paid";
      showToast(
        outcome.status === "dismissed"
          ? "Payment cancelled — your slot is held, pay anytime."
          : outcome.message,
      );
    } catch (error) {
      showToast(getErrorMessage(error, "Could not start payment. You can pay later."));
    }
    return "pending";
  }

  /** "Pay now" from the success sheet — same checkout, for a booking already made. */
  async function retryPayment() {
    if (!successBooking || confirming) return;
    setConfirming(true);
    try {
      const state = await runCheckout(successBooking.id);
      setPaymentState(state);
      if (state === "paid") showToast("Payment confirmed");
    } finally {
      setConfirming(false);
      setCheckoutStage("idle");
    }
  }

  async function confirmBooking() {
    if (confirming) return;
    // Backend rejects past slots ("Booking date must be in the future") — catch it here
    // with a clear message instead of a failed request.
    if (scheduledAt.getTime() <= Date.now()) {
      showToast("That time has already passed — please pick a future slot.");
      return;
    }
    setConfirming(true);
    setCheckoutStage("booking");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      let addressId = addressData?.addresses?.find((a) => a.isDefault)?.id
        ?? addressData?.addresses?.[0]?.id;

      if (!addressId) {
        const created = await createAddress.mutateAsync(
          buildAddressCreatePayload({
            line1: loc.label,
            line2: `${loc.city}, ${loc.pin}`,
            label: "Home",
            latitude: 28.4595,
            longitude: 77.0266,
          }),
        );
        if (created.queued) {
          showToast("You're offline — booking saved and will sync when connected");
          return;
        }
        addressId = created.address.id;
      }

      const result = await createBooking.mutateAsync({
        serviceId: svc.id,
        addressId,
        scheduledDate: scheduledAt.toISOString(),
        description: instructions.trim() || undefined,
        paymentMethod: "razorpay",
        // Server re-prices from its own catalog — these are selections, not amounts.
        packagePrice: selected.price,
        addonIds: [...addons].map((i) => ADDONS[i]!.id),
        ...(params.providerId ? { providerId: String(params.providerId) } : {}),
      });

      if (result.queued) {
        showToast("Booking saved — will confirm when you're back online");
        return;
      }

      if (result.booking) {
        const saved = mapBackendBookingToSaved(result.booking);
        saved.address = `${loc.label}, ${loc.pin}`;
        saved.total = pricing.total;
        saved.packageName = selected.name;

        // Payment runs BEFORE the success sheet: showing "You're all set" while
        // Razorpay is still open (or was cancelled) tells the user a lie, and on
        // Android the sheet also races the native checkout activity for the screen.
        if (Platform.OS === "web") {
          setPaymentState("pending");
        } else {
          setPaymentState(await runCheckout(result.booking.id));
        }
        setSuccessBooking(saved);
      }
    } catch (error) {
      // Surface the real backend reason (past slot, overlap, validation…) — a generic
      // "check you are signed in" hides the actual fix from the user.
      const expired = error instanceof AuthApiError && error.status === 401;
      showToast(
        expired
          ? "Your session expired — please sign out and sign in again."
          : getErrorMessage(error, "Could not create booking. Please try again."),
      );
    } finally {
      setConfirming(false);
      setCheckoutStage("idle");
    }
  }

  const imgSource = getServiceImage(svc.imageKey);

  return (
    <AuthGuard title="Sign in to book a service">
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={c.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: c.text }]}>
            Book a <Text style={{ color: c.primary }}>Service</Text>
          </Text>
          <View style={styles.steps}>
            {STEPS.map((label, i) => (
              <View key={label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    i <= currentStep
                      ? { backgroundColor: c.primary }
                      : { backgroundColor: c.border },
                  ]}
                >
                  {i < currentStep ? (
                    <Check size={12} color="#fff" strokeWidth={3} />
                  ) : (
                    <Text
                      style={[
                        styles.stepNum,
                        { color: i <= currentStep ? "#fff" : c.textSecondary },
                      ]}
                    >
                      {i + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    { color: i === currentStep ? c.primary : c.textSecondary },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <Pressable
          style={[styles.iconBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
          accessibilityLabel="Notifications"
        >
          <Bell size={18} color={c.text} />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>3</Text>
          </View>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Pressable
          onPress={() => setLocationOpen(true)}
          style={[styles.locBtn, { backgroundColor: c.cardBg, borderColor: c.border }]}
        >
          <MapPin size={18} color={c.primary} />
          <Text style={[styles.locText, { color: c.text }]} numberOfLines={1}>
            {loc.label}
          </Text>
          <ChevronDown size={16} color={c.textSecondary} />
        </Pressable>

        <BookingSectionHeader
          step={1}
          title="Pick a service"
          subtitle="Tap a category — prices update instantly"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.svcStrip}
        >
          {catalogServices.map((s, i) => {
            const active = i === serviceIdx;
            const src = getServiceImage(s.imageKey);
            return (
              <Pressable
                key={s.id}
                onPress={() => selectService(i)}
                style={[
                  styles.svcCard,
                  active
                    ? [shadowStyles.glowTeal]
                    : [{ backgroundColor: c.cardBg, borderColor: c.border }],
                ]}
              >
                {active ? (
                  <LinearGradient
                    colors={["#10b981", "#0d9488", "#0f766e"]}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  />
                ) : (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { borderRadius: radius.xl, borderWidth: 1, borderColor: c.border },
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.svcIcon,
                    { backgroundColor: active ? "rgba(255,255,255,0.15)" : s.color + "18" },
                  ]}
                >
                  {src ? (
                    <Image source={src} style={styles.svcImg} resizeMode="contain" />
                  ) : (
                    <Scissors size={28} color={active ? "#fff" : s.color} />
                  )}
                </View>
                <Text style={[styles.svcName, { color: active ? "#fff" : c.text }]}>
                  {s.name}
                </Text>
                <Text style={[styles.svcPrice, { color: active ? "rgba(255,255,255,0.85)" : c.textSecondary }]}>
                  From {s.price}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <LinearGradient
          colors={gradients.lightSpeed}
          style={[styles.hero, shadowStyles.glowTeal]}
        >
          {imgSource && (
            <Image source={imgSource} style={styles.heroImg} resizeMode="contain" />
          )}
          <View style={styles.heroText}>
            <View style={styles.bestSeller}>
              <Text style={styles.bestSellerText}>Best Seller</Text>
            </View>
            <Text style={styles.heroTitle}>{svc.title}</Text>
            <Text style={styles.heroSub}>{svc.tagline}</Text>
            <View style={styles.ratingRow}>
              <Star size={14} color="#D4AF37" fill="#D4AF37" />
              <Text style={styles.ratingText}>
                {svc.rating} ({svc.reviews})
              </Text>
            </View>
          </View>
        </LinearGradient>

        <BookingSectionHeader
          step={2}
          title="Choose your package"
          subtitle="Includes verified pro, tools & satisfaction guarantee"
        />
        {svc.packages.map((p, i) => {
          const active = i === pkgIdx;
          return (
            <Pressable
              key={p.name}
              onPress={() => selectPackage(i)}
              style={[
                styles.pkgCard,
                {
                  backgroundColor: c.cardBg,
                  borderColor: active ? c.primary : c.border,
                  borderWidth: active ? 2 : 1,
                },
                active && shadowStyles.glowSoft,
              ]}
            >
              {p.popular && (
                <LinearGradient colors={gradients.premium} style={styles.popularBadge}>
                  <Text style={styles.popularText}>Most Popular</Text>
                </LinearGradient>
              )}
              <Text style={[styles.pkgName, { color: c.text }]}>{p.name}</Text>
              <Text style={[styles.pkgTag, { color: c.textSecondary }]}>{p.tag}</Text>
              <Text style={[styles.pkgPrice, { color: c.text }]}>₹{p.price}</Text>
              {p.items.slice(0, 4).map((it) => (
                <View key={it} style={styles.pkgItem}>
                  <Check size={14} color={c.success} strokeWidth={3} />
                  <Text style={[styles.pkgItemText, { color: c.text }]}>{it}</Text>
                </View>
              ))}
              <View
                style={[
                  styles.selectPill,
                  active
                    ? { backgroundColor: c.primary }
                    : { borderWidth: 1, borderColor: c.primary },
                ]}
              >
                <Text
                  style={[
                    styles.selectPillText,
                    { color: active ? "#fff" : c.primary },
                  ]}
                >
                  {active ? "Selected ✓" : "Select"}
                </Text>
              </View>
            </Pressable>
          );
        })}

        <View onLayout={(e) => { scheduleY.current = e.nativeEvent.layout.y; }}>
          <BookingSectionHeader
            step={3}
            title="Date & time"
            subtitle="Any day & time — quick picks, calendar, or type below"
          />
          <View style={styles.scheduleActions}>
            <Pressable
              onPress={openNativeDatePicker}
              style={[
                styles.scheduleActionBtn,
                { backgroundColor: c.cardBg, borderColor: c.border },
              ]}
            >
              <Calendar size={18} color={c.primary} />
              <Text style={[typo.small, { color: c.text, fontWeight: "700" }]}>
                {formatDateLabel(scheduledAt)}
              </Text>
            </Pressable>
            <Pressable
              onPress={openNativeTimePicker}
              style={[
                styles.scheduleActionBtn,
                { backgroundColor: c.cardBg, borderColor: c.border },
              ]}
            >
              <Clock size={18} color={c.primary} />
              <Text style={[typo.small, { color: c.text, fontWeight: "700" }]}>
                {formatTimeLabel(scheduledAt)}
              </Text>
            </Pressable>
          </View>
          <View style={styles.manualRow}>
            <View style={styles.manualField}>
              <Text style={[styles.manualLabel, { color: c.textSecondary }]}>Date (YYYY-MM-DD)</Text>
              <TextInput
                value={manualDateStr}
                onChangeText={setManualDateStr}
                onBlur={applyManualDate}
                placeholder="2026-05-22"
                placeholderTextColor={c.textSecondary}
                keyboardType="numbers-and-punctuation"
                style={[
                  styles.manualInput,
                  { color: c.text, backgroundColor: c.cardBg, borderColor: c.border },
                ]}
              />
            </View>
            <View style={styles.manualField}>
              <Text style={[styles.manualLabel, { color: c.textSecondary }]}>Time (24h)</Text>
              <TextInput
                value={manualTimeStr}
                onChangeText={setManualTimeStr}
                onBlur={applyManualTime}
                placeholder="14:30"
                placeholderTextColor={c.textSecondary}
                keyboardType="numbers-and-punctuation"
                style={[
                  styles.manualInput,
                  { color: c.text, backgroundColor: c.cardBg, borderColor: c.border },
                ]}
              />
            </View>
          </View>
          <View style={styles.chipRow}>
            {quickDays.map((d) => {
              const active = sameCalendarDay(scheduledAt, d);
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => selectQuickDay(d)}
                  style={[
                    styles.dateChip,
                    active
                      ? { backgroundColor: c.primary }
                      : { backgroundColor: c.cardBg, borderColor: c.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.dateChipDay, { color: active ? "#fff" : c.text }]}>
                    {quickDayTitle(d)}
                  </Text>
                  <Text
                    style={[
                      styles.dateChipDate,
                      { color: active ? "rgba(255,255,255,0.85)" : c.textSecondary },
                    ]}
                  >
                    {quickDaySubtitle(d)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.chipRow}>
            {BOOKING_TIMES.map((t) => {
              const picked = apply12hTimeOnDate(scheduledAt, t);
              const isPast = !!picked && picked.getTime() <= Date.now();
              const active =
                !!picked &&
                !isPast &&
                picked.getHours() === scheduledAt.getHours() &&
                picked.getMinutes() === scheduledAt.getMinutes();
              return (
                <Pressable
                  key={t}
                  disabled={isPast}
                  onPress={() => selectQuickTime(t)}
                  style={[
                    styles.timeChip,
                    active
                      ? { backgroundColor: c.primary }
                      : { backgroundColor: c.cardBg, borderColor: c.border, borderWidth: 1 },
                    isPast && { opacity: 0.35 },
                  ]}
                >
                  <Text style={[styles.timeChipText, { color: active ? "#fff" : c.text }]}>
                    {t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.slotBanner, { backgroundColor: c.success + "18" }]}>
            <Check size={16} color={c.success} />
            <Text style={[styles.slotBannerText, { color: c.success }]}>
              Great! Fastest available slot secured.
            </Text>
            <Flame size={14} color={c.warning} />
          </View>
        </View>

        <LinearGradient
          colors={isDark ? ["#06140e", "#0a2018"] : ["#ECFDF5", "#F0FDFA"]}
          style={styles.aiCard}
        >
          <View style={styles.aiHeader}>
            <Sparkles size={18} color={c.teal} />
            <Text style={[styles.aiTitle, { color: c.text }]}>AI Recommendation</Text>
          </View>
          <Text style={[styles.aiBody, { color: c.textSecondary }]}>
            Best for 2BHK — Standard deep cleaning
          </Text>
          <Pressable
            onPress={applyAiPackage}
            style={[styles.aiBtn, { backgroundColor: c.cardBg }]}
          >
            <Text style={[styles.aiBtnText, { color: c.text }]}>Looks good 👍</Text>
          </Pressable>
        </LinearGradient>

        <BookingSectionHeader
          title="Add-ons (optional)"
          subtitle="Boost your service with extras"
        />
        {ADDONS.map((a, i) => {
          const on = addons.has(i);
          return (
            <Pressable
              key={a.name}
              onPress={() => toggleAddon(i)}
              style={[styles.addonRow, { backgroundColor: c.cardBg, borderColor: c.border }]}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: on ? c.primary : c.border,
                    backgroundColor: on ? c.primary : "transparent",
                  },
                ]}
              >
                {on && <Check size={12} color="#fff" strokeWidth={3} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addonTitle, { color: c.text }]}>{a.name}</Text>
                <Text style={[styles.addonDesc, { color: c.textSecondary }]}>{a.desc}</Text>
              </View>
              <Text style={[styles.addonPrice, { color: c.primary }]}>+₹{a.price}</Text>
            </Pressable>
          );
        })}

        <BookingSectionHeader title="Special instructions" subtitle="Gate code, parking, pets…" />
        <TextInput
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Any notes for your professional…"
          placeholderTextColor={c.textSecondary}
          multiline
          maxLength={250}
          style={[
            styles.input,
            { color: c.text, backgroundColor: c.cardBg, borderColor: c.border },
          ]}
        />

        <View
          onLayout={(e) => {
            summaryY.current = e.nativeEvent.layout.y;
          }}
        >
          <BookingSectionHeader
            step={4}
            title="Review & confirm"
            subtitle="No charge until service is complete"
          />
          <View style={[styles.summary, { backgroundColor: c.cardBg, borderColor: c.border }]}>
            <SummaryRow label="Service price" value={`₹${selected.price}`} c={c} />
            {addonTotal > 0 ? (
              <SummaryRow label={`Add-ons (${addons.size})`} value={`+₹${addonTotal}`} c={c} />
            ) : null}
            <SummaryRow label="Taxes (10%)" value={`₹${pricing.taxes}`} c={c} />
            <View style={[styles.totalRow, { borderTopColor: c.border }]}>
              <Text style={[styles.totalLabel, { color: c.text }]}>Total Payable</Text>
              <Text style={[styles.totalValue, { color: c.teal }]}>₹{pricing.total}</Text>
            </View>
            <View style={styles.secure}>
              <Lock size={14} color={c.success} />
              <Text style={[styles.secureText, { color: c.textSecondary }]}>
                Secure payment · Razorpay opens after you confirm
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.scrollSpacer} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.cardBg, borderTopColor: c.border }]}>
        <View>
          <Text style={[styles.footerLabel, { color: c.textSecondary }]}>Total</Text>
          <Text style={[styles.footerTotal, { color: c.teal }]}>₹{pricing.total}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Button
            title={
              checkoutStage === "idle"
                ? "Confirm Booking"
                : CHECKOUT_STAGE_LABEL[checkoutStage]
            }
            onPress={confirmBooking}
            loading={confirming}
            size="md"
            icon={confirming ? undefined : <Lock size={16} color="#fff" />}
          />
        </View>
      </View>

      {androidPicker && (
        <DateTimePicker
          value={scheduledAt}
          mode={androidPicker}
          display="default"
          onChange={(event, date) => {
            const mode = androidPicker;
            setAndroidPicker(null);
            if (event.type === "dismissed" || !date || !mode) return;
            if (mode === "date") setScheduledAt((prev) => applyDatePart(prev, date));
            else setScheduledAt((prev) => applyTimePart(prev, date));
          }}
        />
      )}

      {Platform.OS === "ios" && (
        <Modal visible={!!iosPicker} transparent animationType="slide">
          <Pressable
            style={styles.iosModalOverlay}
            onPress={() => setIosPicker(null)}
          >
            <Pressable
              style={[styles.iosModalSheet, { backgroundColor: c.cardBg }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.iosModalHeader, { borderBottomColor: c.border }]}>
                <Pressable onPress={() => setIosPicker(null)} style={styles.iosModalBtn}>
                  <Text style={{ color: c.textSecondary, fontWeight: "600" }}>Cancel</Text>
                </Pressable>
                <Text style={[typo.bodyBold, { color: c.text }]}>
                  {iosPicker === "date" ? "Pick date" : "Pick time"}
                </Text>
                <Pressable onPress={confirmIosPicker} style={styles.iosModalBtn}>
                  <Text style={{ color: c.primary, fontWeight: "700" }}>Done</Text>
                </Pressable>
              </View>
              {iosPicker && (
                <DateTimePicker
                  value={iosDraft}
                  mode={iosPicker}
                  display="spinner"
                  themeVariant={isDark ? "dark" : "light"}
                  onChange={(_, d) => {
                    if (d) setIosDraft(d);
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <LocationSheet visible={locationOpen} onClose={() => setLocationOpen(false)} />
      <BookingSuccessModal
        visible={!!successBooking}
        booking={successBooking}
        paymentState={paymentState}
        paying={confirming}
        onPayNow={retryPayment}
        onClose={() => {
          setSuccessBooking(null);
          router.back();
        }}
        onViewBookings={() => {
          setSuccessBooking(null);
          router.replace("/(tabs)/bookings");
        }}
      />
    </SafeAreaView>
    </AuthGuard>
  );
}

function SummaryRow({
  label,
  value,
  c,
  success,
}: {
  label: string;
  value: string;
  c: ReturnType<typeof useTheme>["colors"];
  success?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
      <Text style={{ ...typo.small, color: c.textSecondary }}>{label}</Text>
      <Text style={{ ...typo.bodyBold, color: success ? c.success : c.text }}>{value}</Text>
    </View>
  );
}

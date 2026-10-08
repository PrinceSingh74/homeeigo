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
  MapPin,
  ChevronDown,
  Check,
  Star,
  Lock,
  Scissors,
  Calendar,
  Clock,
  Tag,
  Wallet,
  AlertTriangle,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";
import { popularPackageIndex } from "@/lib/services";
import { useBookableServices } from "@/hooks/use-catalog";
import { findServiceIndex } from "@/lib/requested-service";
import {
  useAddressesQuery,
  useAvailabilityQuery,
  useCreateBookingMutation,
  useWalletBalanceQuery,
  mapBackendBookingToSaved,
} from "@/hooks/use-core-data";
import {
  useBookingPayment,
  type BookingPaymentResult,
  type BookingPaymentState,
} from "@/hooks/use-booking-payment";
import { preloadRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { useBookingPriceQuote, useServiceability } from "@/hooks/use-booking-quote";
import {
  buildBookingSelection,
  couponErrorMessage,
  formatInr,
  quoteErrorMessage,
  quoteLines,
  selectionKey,
  selectionToBookingFields,
} from "@/lib/booking-quote";
import { useAddressPickStore } from "@/lib/address-pick-store";
import { AuthGuard } from "@/components/auth/AuthGuard";
import {
  defaultScheduledSlot,
  formatDateLabel,
  formatTimeLabel,
  toYmdLocal,
  toHm24Local,
  parseYmdLocal,
  parseHm24OnDate,
  applyDatePart,
  applyTimePart,
  sameCalendarDay,
} from "@/lib/booking-datetime";

function businessDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
import { getErrorMessage, AuthApiError } from "@/lib/auth/errors";
import { getServiceImage } from "@/lib/service-assets";
import { useAppStore } from "@/lib/store";
import { createBookStyles } from "@/lib/book-styles";
import { radius, spacing, type as typo } from "@/lib/typography";
import { Button } from "@/components/Button";
import {
  BookingAddressSheet,
  ServiceabilityLine,
  toSelectedAddress,
  type AddressSeed,
  type SelectedAddress,
} from "@/components/booking/BookingAddressSheet";
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

  const setActivePromo = useAppStore((s) => s.setActivePromo);
  const showToast = useAppStore((s) => s.showToast);
  const requestedService = params.service ? String(params.service) : null;
  const {
    services: catalogServices,
    isLoading: catalogLoading,
    requestedMissing,
  } = useBookableServices(requestedService);
  const addressesQuery = useAddressesQuery();
  const addressData = addressesQuery.data;
  const createBooking = useCreateBookingMutation();
  const { payForBooking, payWithWallet } = useBookingPayment();
  const walletQuery = useWalletBalanceQuery();
  const picked = useAddressPickStore((s) => s.picked);
  const setPicked = useAddressPickStore((s) => s.setPicked);

  const initialIdx = requestedService ? Math.max(0, findServiceIndex(catalogServices, requestedService)) : 0;
  // On a cold start (deep link, notification) the catalogue is still empty on the first render.
  const initialService = catalogServices[initialIdx] ?? catalogServices[0];
  const initialPkg = params.package ? Number(params.package) : initialService ? popularPackageIndex(initialService) : 0;

  const [serviceIdx, setServiceIdx] = useState(initialIdx);
  /** Phase 06: blocking requirements the customer confirmed (the server refuses the booking without them). */
  const [attested, setAttested] = useState<string[]>([]);
  const [pkgIdx, setPkgIdx] = useState(initialPkg);

  // The catalogue — and the requested service, when it is not in the first page and is fetched on
  // its own — can arrive after the first render. Settle the selection once, when it does; after that
  // (or once the customer picks) nothing here changes it again.
  const selectionSettled = useRef(false);
  useEffect(() => {
    if (selectionSettled.current || catalogServices.length === 0) return;
    const i = requestedService ? findServiceIndex(catalogServices, requestedService) : 0;
    if (i < 0) return;
    selectionSettled.current = true;
    setServiceIdx(i);
    setPkgIdx(params.package ? Number(params.package) : popularPackageIndex(catalogServices[i]!));
  }, [catalogServices, requestedService]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (requestedMissing) showToast("That service isn't available to book right now. Please pick one below.");
  }, [requestedMissing]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [addons, setAddons] = useState<Set<string>>(new Set());
  const [audience, setAudience] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [instructions, setInstructions] = useState("");
  const [couponInput, setCouponInput] = useState(() => (params.promo ? String(params.promo) : ""));
  const [appliedCoupon, setAppliedCoupon] = useState(() => (params.promo ? String(params.promo).trim() : ""));
  const [useWallet, setUseWallet] = useState(false);
  // The service address: chosen by the customer, never invented (no default city / coordinates).
  const [address, setAddress] = useState<SelectedAddress | null>(null);
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);
  const [pickedSeed, setPickedSeed] = useState<AddressSeed | null>(null);
  const awaitingPick = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [flowStep, setFlowStep] = useState(1);
  // Narrates the confirm → pay → verify sequence on the footer button so the user is
  // never left staring at one opaque spinner while Razorpay is being prepared.
  const [checkoutStage, setCheckoutStage] = useState<CheckoutStage>("idle");
  const [paymentState, setPaymentState] = useState<BookingPaymentState>("pending");
  const [paymentNote, setPaymentNote] = useState<string | null>(null);
  const [canPay, setCanPay] = useState(true);
  const [paidVia, setPaidVia] = useState("Razorpay");
  const [successBooking, setSuccessBooking] = useState<
    import("@/lib/store").SavedBooking | null
  >(null);

  const svc = catalogServices[serviceIdx] ?? catalogServices[0];
  const availability = useAvailabilityQuery({ serviceId: svc?.id, date: svc ? businessDate(scheduledAt) : null });
  const serverSlots = availability.data?.slots;
  const selected = svc?.packages[pkgIdx] ?? svc?.packages[0];
  const addonCatalog = svc?.addons ?? [];
  const variantCatalog = (svc?.variants ?? []).filter((v) =>
    audience && v.audiences?.length ? v.audiences.includes(audience) : true,
  );

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
    // A promo link only pre-fills the coupon; whether it applies is the server quote's answer.
    if (params.promo) setActivePromo(String(params.promo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.promo]);

  // Default to the customer's default (or first) saved address that has real coordinates.
  useEffect(() => {
    if (address || !addressData?.addresses?.length) return;
    const list = addressData.addresses;
    const def = list.find((a) => a.isDefault);
    const pick = [def, ...list]
      .map((a) => (a ? toSelectedAddress(a) : null))
      .find((a): a is SelectedAddress => a != null);
    if (pick) setAddress(pick);
  }, [address, addressData?.addresses]);

  // A result from the map/autocomplete picker comes back through the pick store.
  useEffect(() => {
    if (!picked || !awaitingPick.current) return;
    awaitingPick.current = false;
    setPickedSeed({
      latitude: picked.latitude,
      longitude: picked.longitude,
      formattedAddress: picked.formattedAddress,
      city: picked.city,
      state: picked.state,
      postalCode: picked.postalCode,
    });
    setPicked(null);
    setAddressSheetOpen(true);
  }, [picked, setPicked]);

  // Drop add-ons the newly selected service doesn't offer.
  useEffect(() => {
    const known = new Set(addonCatalog.map((a) => a.id));
    setAddons((prev) => {
      const next = new Set([...prev].filter((id) => known.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [addonCatalog]);

  const addressCoords = useMemo(
    () => (address ? { latitude: address.latitude, longitude: address.longitude } : null),
    [address],
  );
  const serviceability = useServiceability(addressCoords, svc?.category);

  // Selection → server quote. The quote is priced at the chosen address (weather surge), exactly
  // as POST /api/bookings prices it from that address.
  const selection = useMemo(
    () =>
      svc && (selected || svc.quantityRule || variantId)
        ? buildBookingSelection({
            serviceId: svc.id,
            quantityRule: svc.quantityRule,
            quantity: quantity ?? undefined,
            packagePrice: selected?.price,
            variantId,
            audience,
            addonIds: [...addons],
            couponCode: appliedCoupon,
            addressId: address?.id ?? null,
            coords: addressCoords,
          })
        : null,
    [svc, selected, addons, appliedCoupon, address?.id, addressCoords, quantity, variantId, audience],
  );
  const priceQuote = useBookingPriceQuote(selection);
  const quote = priceQuote.quote;
  const couponProblem = appliedCoupon && quote?.couponError ? couponErrorMessage(quote.couponError) : null;
  const walletBalance = walletQuery.data?.balance ?? 0;

  /** Why the confirm button is disabled, in the customer's words (null = can confirm). */
  const blocker: string | null = !svc
    ? "Loading services…"
    : svc.audiences?.length && !audience
      ? "Choose who this service is for."
    : svc.variants?.length && !variantId
      ? "This option is unavailable for this service."
    : !selected && !svc.quantityRule && !svc.variants?.length
      ? "This service has no bookable package right now."
    : svc.comingSoon
      ? "This service is coming soon — it can't be booked yet."
      : !address
        ? "Choose the address for this service."
        : serviceability.state === "unserviceable"
          ? "We don't serve this address yet."
          : serviceability.state === "checking"
            ? "Checking your address…"
            : priceQuote.error
              ? quoteErrorMessage(priceQuote.error)
              : !priceQuote.ready
                ? "Calculating your price…"
                : couponProblem
                  ? `${couponProblem} Remove it to continue.`
                  : null;

  const currentStep = successBooking || confirming ? 3 : flowStep;

  const scrollToY = (y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  };

  const selectService = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    selectionSettled.current = true;
    setServiceIdx(i);
    setPkgIdx(popularPackageIndex(catalogServices[i]!));
    setAddons(new Set<string>());
    setAudience(null);
    setVariantId(null);
    setQuantity(null);
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
    const next = applyDatePart(scheduledAt, d);
    setScheduledAt(next);
    setFlowStep(2);
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
  const toggleAddon = (id: string) => {
    Haptics.selectionAsync();
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyCoupon = () => {
    const code = couponInput.trim();
    Haptics.selectionAsync();
    setAppliedCoupon(code);
    if (code) setActivePromo(code);
  };

  const removeCoupon = () => {
    setAppliedCoupon("");
    setCouponInput("");
    setActivePromo(null);
  };

  const openAddressSearch = (notice?: string) => {
    if (notice) showToast(notice);
    setAddressSheetOpen(false);
    awaitingPick.current = true;
    router.push("/address/picker");
  };

  /**
   * Opens Razorpay for an already-created booking and reports whether money actually
   * moved. Never throws: an unpaid booking is a state the UI has to show, not a crash.
   */
  async function runCheckout(bookingId: string, title: string): Promise<BookingPaymentState> {
    let outcome: BookingPaymentResult;
    const payViaWallet = useWallet && walletBalance > 0;
    try {
      const opts = {
        bookingId,
        description: `${title} booking`,
        onPhase: (phase: "creating-order" | "checkout" | "verifying") =>
          setCheckoutStage(phase === "creating-order" ? "order" : phase),
      };
      outcome = payViaWallet ? await payWithWallet(opts) : await payForBooking(opts);
    } catch (error) {
      outcome = { status: "failed", message: getErrorMessage(error, "Could not start payment. You can pay later.") };
    }
    if (outcome.status === "paid") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPaidVia(payViaWallet ? "Wallet" : "Razorpay");
      setPaymentNote(outcome.note ?? null);
      return "paid";
    }
    if (outcome.status === "dismissed") {
      setPaymentNote("Payment cancelled — nothing was charged. Your booking is saved; pay anytime from My Bookings.");
    } else {
      setPaymentNote(outcome.message);
      if (outcome.code === "BOOKING_NOT_PAYABLE") setCanPay(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    return "pending";
  }

  /** "Pay now" from the success sheet — same checkout, for a booking already made. */
  async function retryPayment() {
    if (!successBooking || confirming) return;
    setConfirming(true);
    try {
      const state = await runCheckout(successBooking.id, successBooking.serviceTitle);
      setPaymentState(state);
      if (state === "paid") showToast("Payment confirmed");
    } finally {
      setConfirming(false);
      setCheckoutStage("idle");
    }
  }

  async function confirmBooking() {
    if (confirming) return;
    if (blocker || !svc || !address || !selection || !quote) {
      if (blocker) showToast(blocker);
      return;
    }
    // Only the quote priced for exactly this selection may be confirmed.
    if (priceQuote.key !== selectionKey(selection)) {
      showToast("Your price is being updated — please wait a moment.");
      return;
    }
    // Backend rejects past slots ("Booking date must be in the future") — catch it here
    // with a clear message instead of a failed request.
    if (scheduledAt.getTime() <= Date.now()) {
      showToast("That time has already passed — please pick a future slot.");
      return;
    }
    const offered = serverSlots ?? [];
    if (availability.isLoading || (offered.length === 0 && availability.isFetching)) {
      showToast("Checking available times…");
      return;
    }
    if (!offered.some((s) => s.available && new Date(s.start).getTime() === scheduledAt.getTime())) {
      showToast("That time isn't available. Pick another slot.");
      return;
    }
    const mustConfirm = quote.requirements?.beforeBooking ?? [];
    const unconfirmed = mustConfirm.filter((r) => !attested.includes(r.code));
    if (unconfirmed.length) {
      showToast(`Please confirm: ${unconfirmed.map((r) => r.label).join(", ")}`);
      return;
    }
    const quotedTotal = quote.finalAmount;
    setConfirming(true);
    setCheckoutStage("booking");
    setPaymentNote(null);
    setCanPay(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const result = await createBooking.mutateAsync({
        // The same selection ids that were quoted — never an amount. The server re-prices it.
        ...selectionToBookingFields(selection),
        addressId: address.id,
        scheduledDate: scheduledAt.toISOString(),
        description: instructions.trim() || undefined,
        paymentMethod: "razorpay",
        ...(params.providerId ? { providerId: String(params.providerId) } : {}),
        // The signed quote: if the price moved, the server refuses (PRICE_CHANGED) instead of
        // charging a total the customer did not see.
        ...(quote.quoteToken ? { quoteToken: quote.quoteToken } : {}),
        ...(mustConfirm.length ? { requirementAttestations: mustConfirm.map((r) => r.code).filter((code) => attested.includes(code)) } : {}),
      });

      if (result.queued) {
        showToast("Booking saved — will confirm when you're back online");
        return;
      }

      if (result.booking) {
        const saved = mapBackendBookingToSaved(result.booking);
        saved.address = address.text;
        // The create response nests the name under service.name; use the catalogue entry booked.
        saved.serviceId = svc.id;
        saved.serviceTitle = svc.title;
        saved.serviceName = svc.name;
        saved.packageName = selected?.name ?? saved.packageName;
        // saved.total is the server's booking amount. If it moved since the quote (e.g. a
        // membership benefit was used elsewhere in between), say so instead of hiding it.
        if (!saved.total) saved.total = quotedTotal; // response without an amount: the server quote
        else if (Math.abs(saved.total - quotedTotal) >= 0.01) {
          showToast(`Final price updated to ${formatInr(saved.total)} by the server.`);
          void priceQuote.refetch();
        }

        // Payment runs BEFORE the success sheet: showing "You're all set" while
        // Razorpay is still open (or was cancelled) tells the user a lie, and on
        // Android the sheet also races the native checkout activity for the screen.
        if (Platform.OS === "web") {
          setPaymentState("pending");
        } else {
          setPaymentState(await runCheckout(result.booking.id, svc.title));
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
          : quoteErrorMessage(error),
      );
      // The server refused this selection — re-quote so the screen shows what it will accept.
      void priceQuote.refetch();
    } finally {
      setConfirming(false);
      setCheckoutStage("idle");
    }
  }

  // While the requested service is still being resolved, show the loading state rather than
  // briefly offering whichever service happens to be first.
  if (!svc || catalogLoading) {
    return (
      <AuthGuard title="Sign in to book a service">
        <SafeAreaView style={[styles.root, { backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 }]}>
          <Text style={[typo.body, { color: c.textSecondary, textAlign: "center" }]}>
            {catalogLoading ? "Loading services…" : "Services couldn't be loaded. Check your connection and try again."}
          </Text>
          {!catalogLoading ? (
            <Pressable onPress={() => router.back()} style={{ marginTop: spacing.lg }} accessibilityRole="button">
              <Text style={{ color: c.primary, fontWeight: "700" }}>Go back</Text>
            </Pressable>
          ) : null}
        </SafeAreaView>
      </AuthGuard>
    );
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
        <View style={localStyles.iconBtnSpacer} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Pressable
          onPress={() => setAddressSheetOpen(true)}
          style={[
            styles.locBtn,
            { backgroundColor: c.cardBg, borderColor: address ? c.border : c.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={address ? `Service address: ${address.text}. Change` : "Choose service address"}
        >
          <MapPin size={18} color={c.primary} />
          <Text style={[styles.locText, { color: address ? c.text : c.primary }]} numberOfLines={1}>
            {address
              ? `${address.label} · ${address.text}`
              : addressesQuery.isLoading
                ? "Loading your addresses…"
                : "Choose where you need the service"}
          </Text>
          <ChevronDown size={16} color={c.textSecondary} />
        </Pressable>
        {address ? (
          <View style={localStyles.gapBelow}>
            <ServiceabilityLine state={serviceability} c={c} />
          </View>
        ) : null}

        <BookingSectionHeader
          step={1}
          title="Pick a service"
          subtitle="Tap a category — prices update instantly"
        />
        <ScrollView keyboardShouldPersistTaps="handled"
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
            <Text style={styles.heroTitle}>{svc.title}</Text>
            <Text style={styles.heroSub}>{svc.tagline}</Text>
            <View style={styles.ratingRow}>
              <Star size={14} color="#D4AF37" fill="#D4AF37" />
              <Text style={styles.ratingText}>
                {svc.rating === "New" ? "New" : `${svc.rating} (${svc.reviews})`}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <BookingSectionHeader
          step={2}
          title="Choose your package"
          subtitle="Your total is confirmed before you pay"
        />
        {svc.audiences?.length ? (
          <View style={{ gap: 8, marginBottom: 12 }}>
            <Text style={[styles.pkgName, { color: c.text }]}>Who is this for?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {svc.audiences.map((item) => {
                const active = audience === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setAudience(item);
                      setVariantId(null);
                    }}
                    style={[
                      styles.selectPill,
                      active ? { backgroundColor: c.primary } : { borderWidth: 1, borderColor: c.primary },
                    ]}
                  >
                    <Text style={[styles.selectPillText, { color: active ? "#fff" : c.primary }]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {svc.variants?.length ? (
          variantCatalog.length ? (
            variantCatalog.map((v) => {
              const active = variantId === v.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setVariantId(v.id)}
                  style={[
                    styles.pkgCard,
                    {
                      backgroundColor: c.cardBg,
                      borderColor: active ? c.primary : c.border,
                      borderWidth: active ? 2 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.pkgName, { color: c.text }]}>{v.name}</Text>
                  <Text style={[styles.pkgPrice, { color: c.text }]}>₹{v.price}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={[styles.pkgTag, { color: c.textSecondary }]}>
              This option is unavailable for this service.
            </Text>
          )
        ) : null}
        {svc.quantityRule ? (
          <View style={[styles.pkgCard, { backgroundColor: c.cardBg, borderColor: c.border, borderWidth: 1 }]}>
            <Text style={[styles.pkgName, { color: c.text }]}>
              {quantity ?? quote?.selection?.quantity ?? svc.quantityRule.default ?? svc.quantityRule.min}{" "}
              {quote?.selection?.unitLabel ?? svc.quantityRule.unitLabel ?? "unit(s)"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
              <Pressable
                onPress={() => {
                  const min = svc.quantityRule!.min;
                  const step = svc.quantityRule!.step && svc.quantityRule!.step > 0 ? svc.quantityRule!.step : 1;
                  const current = quantity ?? svc.quantityRule!.default ?? min;
                  setQuantity(Math.max(min, current - step));
                }}
                style={[styles.selectPill, { borderWidth: 1, borderColor: c.primary }]}
              >
                <Text style={[styles.selectPillText, { color: c.primary }]}>-</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const min = svc.quantityRule!.min;
                  const max = svc.quantityRule!.max ?? 99;
                  const step = svc.quantityRule!.step && svc.quantityRule!.step > 0 ? svc.quantityRule!.step : 1;
                  const current = quantity ?? svc.quantityRule!.default ?? min;
                  setQuantity(Math.min(max, current + step));
                }}
                style={[styles.selectPill, { backgroundColor: c.primary }]}
              >
                <Text style={[styles.selectPillText, { color: "#fff" }]}>+</Text>
              </Pressable>
            </View>
            <Text style={[styles.pkgTag, { color: c.textSecondary }]}>
              Priced by quantity — the exact amount is in your price summary below.
            </Text>
          </View>
        ) : null}
        {!svc.quantityRule && !svc.variants?.length && svc.packages.map((p, i) => {
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
            {(serverSlots ?? []).length > 0 ? serverSlots!.map((slot) => {
              const picked = new Date(slot.start);
              const active = picked.getTime() === scheduledAt.getTime();
              const label = picked.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
              return (
                <Pressable
                  key={slot.start}
                  disabled={!slot.available}
                  onPress={() => {
                    setScheduledAt(picked);
                    setFlowStep(3);
                  }}
                  style={[
                    styles.timeChip,
                    active
                      ? { backgroundColor: c.primary }
                      : { backgroundColor: c.cardBg, borderColor: c.border, borderWidth: 1 },
                    !slot.available && { opacity: 0.35 },
                  ]}
                >
                  <Text style={[styles.timeChipText, { color: active ? "#fff" : c.text }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            }) : (
              <Text style={{ color: c.textSecondary, fontSize: 13 }}>
                {availability.isLoading ? "Checking which times are free…" : "No times are available for this day."}
              </Text>
            )}
          </View>
          <View style={[styles.slotBanner, { backgroundColor: c.primary + "12" }]}>
            <Clock size={16} color={c.primary} />
            <Text style={[styles.slotBannerText, { color: c.text }]}>
              {formatDateLabel(scheduledAt)} · {formatTimeLabel(scheduledAt)} — a professional is
              assigned after you book.
            </Text>
          </View>
        </View>


        <BookingSectionHeader
          title="Add-ons (optional)"
          subtitle="Boost your service with extras"
        />
        {addonCatalog.map((a) => {
          const on = addons.has(a.id);
          return (
            <Pressable
              key={a.id}
              onPress={() => toggleAddon(a.id)}
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
                {a.desc ? (
                  <Text style={[styles.addonDesc, { color: c.textSecondary }]}>{a.desc}</Text>
                ) : null}
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
            subtitle="Price confirmed by our server — you pay after you confirm"
          />
          <View style={[styles.summary, { backgroundColor: c.cardBg, borderColor: c.border }]}>
            {/* Coupon — validated and priced only by the server quote. */}
            <View style={localStyles.couponRow}>
              <Tag size={16} color={c.primary} />
              <TextInput
                value={couponInput}
                onChangeText={(t) => setCouponInput(t.toUpperCase())}
                placeholder="Coupon code"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={40}
                editable={!appliedCoupon}
                style={[localStyles.couponInput, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
              />
              {appliedCoupon ? (
                <Pressable onPress={removeCoupon} style={localStyles.couponBtn} accessibilityRole="button">
                  <Text style={[localStyles.couponBtnText, { color: c.error }]}>Remove</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={applyCoupon}
                  disabled={!couponInput.trim()}
                  style={[localStyles.couponBtn, { opacity: couponInput.trim() ? 1 : 0.4 }]}
                  accessibilityRole="button"
                >
                  <Text style={[localStyles.couponBtnText, { color: c.primary }]}>Apply</Text>
                </Pressable>
              )}
            </View>
            {appliedCoupon && quote && priceQuote.ready ? (
              couponProblem ? (
                <Text style={[localStyles.couponMsg, { color: c.error }]}>{couponProblem}</Text>
              ) : quote.campaignDiscount > 0 ? (
                <Text style={[localStyles.couponMsg, { color: c.success }]}>
                  {quote.couponCode ?? appliedCoupon} applied — {formatInr(quote.campaignDiscount)} off
                </Text>
              ) : null
            ) : null}

            {priceQuote.error ? (
              <View style={localStyles.quoteError}>
                <AlertTriangle size={16} color={c.error} />
                <Text style={[localStyles.quoteErrorText, { color: c.text }]}>
                  {quoteErrorMessage(priceQuote.error)}
                </Text>
                <Pressable onPress={() => void priceQuote.refetch()} accessibilityRole="button">
                  <Text style={[localStyles.couponBtnText, { color: c.primary }]}>Retry</Text>
                </Pressable>
              </View>
            ) : quote ? (
              <View style={{ opacity: priceQuote.ready ? 1 : 0.5 }}>
                {quoteLines(quote).map((l) => (
                  <SummaryRow
                    key={l.key}
                    label={l.label}
                    value={`${l.kind === "discount" ? "−" : ""}${formatInr(l.amount)}`}
                    c={c}
                    success={l.kind === "discount"}
                  />
                ))}
              </View>
            ) : (
              <Text style={[typo.small, localStyles.gapBelow, { color: c.textSecondary }]}>
                Calculating your price…
              </Text>
            )}
            {!address && quote ? (
              <Text style={[typo.caption, localStyles.gapBelow, { color: c.textSecondary }]}>
                Final price is confirmed for your address once you choose it.
              </Text>
            ) : null}
            {quote?.requirements && !quote.requirements.empty && priceQuote.ready ? (
              <View testID="booking-preparation" style={[localStyles.gapBelow, { borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.md }]}>
                <Text style={[typo.body, { color: c.text, fontWeight: "600" }]}>Before we arrive</Text>
                {quote.requirements.beforeBooking.map((r) => {
                  const on = attested.includes(r.code);
                  return (
                    <Pressable
                      key={r.code}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${r.label}. Please confirm before booking`}
                      onPress={() => setAttested((prev) => (on ? prev.filter((x) => x !== r.code) : [...prev, r.code]))}
                      style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}
                    >
                      <Text style={{ color: on ? c.teal : c.textSecondary, fontSize: 18 }}>{on ? "\u2611" : "\u2610"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[typo.caption, { color: c.text, fontWeight: "600" }]}>{r.label}</Text>
                        <Text style={[typo.caption, { color: c.textSecondary }]}>Please confirm before booking</Text>
                        {r.note ? <Text style={[typo.caption, { color: c.textSecondary }]}>{r.note}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
                {([
                  ["Have this ready", quote.requirements.beforeArrival],
                  ["You'll provide", quote.requirements.youProvide],
                  ["Shared", quote.requirements.shared],
                  ["We'll bring", quote.requirements.weBring],
                  ["Optional", quote.requirements.optional],
                ] as const).map(([title, items]) =>
                  items.length ? (
                    <View key={title} style={{ marginTop: spacing.sm }}>
                      <Text style={[typo.caption, { color: c.textSecondary, fontWeight: "600" }]}>{title}</Text>
                      {items.map((r) => (
                        <Text key={r.code} style={[typo.caption, { color: c.text }]}>
                          {"\u2022 "}
                          {r.label}
                          {[r.quantity, r.chargeText, r.timingText].filter(Boolean).length ? ` \u00b7 ${[r.quantity, r.chargeText, r.timingText].filter(Boolean).join(" \u00b7 ")}` : ""}
                        </Text>
                      ))}
                    </View>
                  ) : null,
                )}
              </View>
            ) : null}
            <View style={[styles.totalRow, { borderTopColor: c.border }]}>
              <Text style={[styles.totalLabel, { color: c.text }]}>Total Payable</Text>
              <Text style={[styles.totalValue, { color: c.teal }]}>
                {quote && priceQuote.ready ? formatInr(quote.finalAmount) : "—"}
              </Text>
            </View>

            {walletBalance > 0 ? (
              <Pressable
                onPress={() => setUseWallet((v) => !v)}
                style={[localStyles.walletRow, { borderColor: useWallet ? c.primary : c.border }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: useWallet }}
              >
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: useWallet ? c.primary : c.border, backgroundColor: useWallet ? c.primary : "transparent" },
                  ]}
                >
                  {useWallet && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
                <Wallet size={16} color={c.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[typo.small, { color: c.text, fontWeight: "700" }]}>Use wallet balance</Text>
                  <Text style={[typo.caption, { color: c.textSecondary }]}>
                    {formatInr(walletBalance)} available · any remainder is paid by card/UPI
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.secure}>
              <Lock size={14} color={c.success} />
              <Text style={[styles.secureText, { color: c.textSecondary }]}>
                {useWallet && walletBalance > 0
                  ? "Wallet is applied first · Razorpay opens only for any remainder"
                  : "Secure payment · Razorpay opens after you confirm"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.scrollSpacer} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.cardBg, borderTopColor: c.border }]}>
        <View>
          <Text style={[styles.footerLabel, { color: c.textSecondary }]}>Total</Text>
          <Text style={[styles.footerTotal, { color: c.teal }]}>
            {quote && priceQuote.ready ? formatInr(quote.finalAmount) : "—"}
          </Text>
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
            disabled={!!blocker && !confirming}
            size="md"
            icon={confirming ? undefined : <Lock size={16} color="#fff" />}
          />
        </View>
      </View>
      {blocker && !confirming ? (
        <View style={[localStyles.blockerBar, { backgroundColor: c.cardBg }]}>
          <Text style={[typo.caption, { color: c.textSecondary, textAlign: "center" }]}>{blocker}</Text>
        </View>
      ) : null}

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

      <BookingAddressSheet
        visible={addressSheetOpen}
        onClose={() => setAddressSheetOpen(false)}
        addresses={addressData?.addresses ?? []}
        loading={addressesQuery.isLoading}
        selectedId={address?.id ?? null}
        onSelect={(a) => setAddress(a)}
        onRequestSearch={openAddressSearch}
        pickedSeed={pickedSeed}
        onSeedConsumed={() => setPickedSeed(null)}
        serviceCategory={svc.category}
      />
      <BookingSuccessModal
        visible={!!successBooking}
        booking={successBooking}
        paymentState={paymentState}
        paying={confirming}
        paymentNote={paymentNote}
        canPay={canPay}
        paidVia={paidVia}
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

const localStyles = StyleSheet.create({
  couponRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  couponInput: {
    ...typo.small,
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  couponBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  couponBtnText: { ...typo.small, fontWeight: "700" },
  couponMsg: { ...typo.caption, marginBottom: spacing.sm },
  quoteError: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  quoteErrorText: { ...typo.small, flex: 1 },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  blockerBar: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  gapBelow: { marginBottom: spacing.sm },
  iconBtnSpacer: { width: 40, height: 40 },
});

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

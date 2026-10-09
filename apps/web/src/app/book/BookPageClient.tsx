"use client";

import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { m as motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Star,
  ShieldCheck,
  BadgeCheck,
  Clock,
  Lock,
  UserCheck,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
/** Services-page style ambient canvas — soft emerald/teal orbs on the mint gradient. */
function BookAmbientBackground() {
  return (
    <div className="mesh-bg" aria-hidden>
      <div className="absolute -right-24 -top-24 size-[38rem] rounded-full bg-emerald-100/40 blur-3xl dark:bg-emerald-500/10" />
      <div className="absolute -left-28 top-1/3 size-[34rem] rounded-full bg-teal-100/30 blur-3xl dark:bg-teal-500/10" />
      <div className="absolute bottom-[-10%] right-1/4 size-[30rem] rounded-full bg-emerald-100/25 blur-3xl dark:bg-emerald-500/8" />
    </div>
  );
}
import { ServiceSearchInput } from "@/components/ServiceSearchInput";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { LocationButton } from "@/components/LocationButton";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { MotionImage } from "@/components/ui/MotionImage";
import { BookingSuccessModal } from "@/components/overlays/BookingSuccessModal";
import { BookingScheduleSection } from "@/components/booking/BookingScheduleSection";
import { ProviderETA } from "@/components/geo/ProviderETA";
import { BookPageHeader } from "@/components/booking/BookPageHeader";
import { BookStickyCheckout } from "@/components/booking/BookStickyCheckout";
import { CancellationPolicyCard } from "@/components/booking/CancellationPolicyCard";
import {
  bookHeroTitle,
  bookMain,
  bookPackageGrid,
  bookPageRoot,
  bookSectionCard,
  bookSectionTitle,
  bookServiceCard,
  bookServiceRail,
  bookSplitGrid,
} from "@/components/booking/book-page-layout";
import {
  SERVICES,
  packagePositionForTier,
  getLocation,
  type Service,
} from "@/lib/services";
import { bookUrl, parseBookParams } from "@/lib/booking-url";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { bookingSummaryLine } from "@/lib/booking-summary";
import { NEUTRAL_PRESENTATION, toUiService, type ServicePresentation } from "@/lib/book-services";
import { SERVICE_IMAGES, type SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  mapBackendBookingToSaved,
  useAddressesQuery,
  useAvailabilityQuery,
  useBookingPriceQuoteQuery,
  useServiceabilityQuery,
  useCreateBookingMutation,
  useServicesQuery,
} from "@/hooks/use-core-data";
import { useBookingPayment } from "@/hooks/use-booking-payment";
import {
  defaultScheduledSlot,
  formatDateLabel,
  formatTimeLabel,
  toYmdLocal,
} from "@/lib/booking-datetime";
import type { BackendService, ServiceSelectionSnapshot } from "@/types/backend";
import { bookQuantityBounds, bookQuantityRule, bookVariants, clampQuantity, urlServiceState } from "@/lib/book-selection";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessage } from "@/lib/auth/errors";
import { coreApi } from "@/services/core/api";
import { attemptFingerprint, attemptKeyFor, keepAttemptAfter, releaseAttempt, sessionAttemptStore } from "@/lib/booking-attempt";

// Opens from "Add address". Same props. Search and GPS stay inside the modal.
const AddAddressModal = dynamic(() =>
  import("@/components/profile/AddAddressModal").then((mod) => mod.AddAddressModal),
);

/* ----------------------------- data ----------------------------- */

// Only claims the product can back: partner approval, itemised server pricing,
// live arrival tracking and gateway payments. (No guarantees or material claims.)
// "Approved", not "Verified": every dispatchable partner is admin-approved, active and unrestricted
// (backend DISPATCHABLE_PROVIDER_WHERE), but identity verification (KYC) is a gate only on services
// whose configuration requires it — so "verified" is not true of every booking.
const HERO_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Approved\nProfessionals" },
  { icon: BadgeCheck, label: "Itemised\nPricing" },
  { icon: Clock, label: "Live Arrival\nTracking" },
  { icon: CreditCard, label: "Secure\nPayments" },
];

const TRUST = [
  { icon: ShieldCheck, label: "Approved\nProfessionals" },
  { icon: UserCheck, label: "Your slot\nyou choose" },
  { icon: Clock, label: "Live\nTracking" },
  { icon: BadgeCheck, label: "Cancellation Terms\nShown Upfront" },
  { icon: CreditCard, label: "Secure\nPayments" },
];

/**
 * What `svc` holds until the catalogue has loaded. It is never rendered as a service: the booking
 * body appears only once `catalogueReady`, and until then the page says it is loading or that
 * services are unavailable. It carries no price, tier, rating or copy on purpose.
 */
const PLACEHOLDER_SERVICE: Service = {
  id: "service-unavailable",
  name: "",
  price: "",
  priceFrom: 0,
  color: NEUTRAL_PRESENTATION.color,
  title: "",
  tagline: "",
  rating: "",
  reviews: "",
  homes: "",
  packages: [],
  keywords: [],
};

/**
 * The tier a service opens on when the URL names none: the base price (tier index 1).
 * A starting point for the picker only — nothing is shown or claimed about it.
 */
const DEFAULT_TIER_INDEX = 1;

/**
 * Colour, icon and picture only, borrowed from the built-in list by position (empty in production
 * builds). Nothing commercial is taken from it — see lib/book-services.
 */
function presentationFor(index: number): ServicePresentation {
  const entry = SERVICES[index % Math.max(SERVICES.length, 1)];
  return entry ? { color: entry.color, icon: entry.icon, img: entry.img } : NEUTRAL_PRESENTATION;
}

/* ----------------------------- helpers ----------------------------- */

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(bookSectionCard, className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-20 sheen"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/* ----------------------------- page ----------------------------- */

export default function BookPageClient() {
  return (
    <Suspense fallback={<BookPageFallback />}>
      <BookPageContent />
    </Suspense>
  );
}

function BookPageFallback() {
  return (
    <div className={bookPageRoot}>
      <BookAmbientBackground />
      <main className={cn(bookMain, "py-24 text-center text-muted")}>
        Loading booking…
      </main>
    </div>
  );
}

function BookPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationId = useAppStore((s) => s.locationId);
  const showToast = useAppStore((s) => s.showToast);
  const addBooking = useAppStore((s) => s.addBooking);
  const {
    data: servicesData,
    isLoading: servicesLoading,
    isError: servicesError,
    refetch: refetchServices,
  } = useServicesQuery();
  const createBookingMutation = useCreateBookingMutation();
  /**
   * One key per booking attempt, kept in per-tab storage with the request it belongs to: a dropped
   * response, or a refresh after one, retries the same key so the server replays instead of booking twice.
   */
  const attemptStore = useRef(sessionAttemptStore());
  /** The last confirm never got a response. The slot may already be held by that unseen booking. */
  const retryUnseenCreate = useRef(false);
  const { data: addressesData, isLoading: addressesLoading } = useAddressesQuery();
  const { payForBooking } = useBookingPayment();
  /**
   * The service the link names. When it is not in the list this page loaded (a long catalogue, or a
   * service that is not offered), the server is asked for it by id; the page then books THAT
   * service or says it is not available — it never falls back to another one.
   */
  const urlServiceId = parseBookParams(searchParams).serviceId;
  const listedServices = useMemo(() => servicesData?.services ?? [], [servicesData]);
  const listReady = !servicesLoading && !servicesError && listedServices.length > 0;
  const urlInList = !urlServiceId || listedServices.some((s) => s.id === urlServiceId || s.slug === urlServiceId);
  const urlServiceQuery = useQuery({
    queryKey: ["book", "service-by-id", urlServiceId],
    queryFn: () => coreApi.services.details(urlServiceId!),
    enabled: Boolean(urlServiceId) && listReady && !urlInList,
    retry: false,
    staleTime: 60_000,
  });
  const urlService = urlServiceState({
    urlId: urlServiceId,
    listed: listedServices,
    lookup: urlServiceQuery.data?.service ? "found" : urlServiceQuery.isError ? "failed" : urlServiceQuery.isFetching ? "loading" : "idle",
  });
  const allServices = useMemo(
    () => (urlServiceQuery.data?.service && !urlInList ? [urlServiceQuery.data.service, ...listedServices] : listedServices),
    [urlServiceQuery.data, urlInList, listedServices],
  );
  const services: Service[] = useMemo(() => {
    const incoming = allServices;
    // Never the built-in list: its prices, ratings and package contents are not the server's.
    if (!incoming.length) return [PLACEHOLDER_SERVICE];
    return incoming.map((service, index) => toUiService(service, presentationFor(index)));
  }, [allServices]);
  /** The catalogue answered with services (and the link's own service is resolved). Until then nothing about any service is shown. */
  const catalogueReady = listReady && urlService !== "loading";

  const parsed = parseBookParams(searchParams);
  const initialService = parsed.serviceId
    ? Math.max(
        0,
        services.findIndex((s) => s.id === parsed.serviceId || s.slug === parsed.serviceId),
      )
    : 0;
  const initialPkg = packagePositionForTier(services[initialService] ?? services[0]!, parsed.packageIndex ?? DEFAULT_TIER_INDEX);

  const [service, setService] = useState(initialService);
  /** The customer chose a service on this page, so the one on screen is deliberate whatever the URL says. */
  const [pickedHere, setPickedHere] = useState(false);
  const [pkg, setPkg] = useState(initialPkg);
  const [searchQuery, setSearchQuery] = useState(parsed.query);
  const [scheduledAt, setScheduledAt] = useState(() => defaultScheduledSlot());
  /** The clock starts at 11:00 so the day grid has a time to show. It is not a chosen slot. */
  const [slotChosen, setSlotChosen] = useState(false);
  const [addons, setAddons] = useState<Set<string>>(new Set());
  /** Phase 06: codes of blocking requirements the customer has ticked (the server enforces them). */
  const [attested, setAttested] = useState<Set<string>>(new Set());
  /** Variant / quantity / audience from the service page — ids only; the server prices them. */
  const [selection, setSelection] = useState<{
    variantId?: string;
    quantity?: number;
    audience?: string;
    professionalPreference?: string;
  } | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [instructions, setInstructions] = useState("");
  // The booking's address is always a SAVED address with a real pin — chosen here, or added through
  // AddAddressModal (search / GPS). Free text here used to be ignored when a default existed, and
  // without one the page saved an address at the preset area's centroid.
  const savedAddresses = useMemo(() => addressesData?.addresses ?? [], [addressesData?.addresses]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  useEffect(() => {
    if (selectedAddressId && savedAddresses.some((a) => a.id === selectedAddressId)) return;
    const def = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];
    setSelectedAddressId(def?.id ?? null);
  }, [savedAddresses, selectedAddressId]);
  const defaultAddressId = (savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0])?.id ?? null;
  // Synchronous on the first render after addresses load, so the quote is requested ONCE, already
  // at the right address (the effect above only persists the choice).
  const effectiveAddressId = selectedAddressId ?? defaultAddressId;
  const selectedAddress = savedAddresses.find((a) => a.id === effectiveAddressId) ?? null;
  const addressText = selectedAddress
    ? [selectedAddress.line1, selectedAddress.line2, selectedAddress.city, selectedAddress.pincode].filter(Boolean).join(", ")
    : "";
  const [bookingDone, setBookingDone] = useState<SavedBooking | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dateRef = useRef<HTMLDivElement>(null);
  const prepRef = useRef<HTMLDivElement>(null);
  const instrRef = useRef<HTMLTextAreaElement>(null);

  const svc = services[service] ?? services[0]!;
  const SvcIcon = svc.icon;

  useEffect(() => {
    const sid = parsed.serviceId;
    if (sid) {
      const idx = Math.max(
        0,
        services.findIndex((s) => s.id === sid || s.slug === sid),
      );
      setService(idx);
      setPkg(packagePositionForTier(services[idx] ?? services[0]!, parsed.packageIndex ?? DEFAULT_TIER_INDEX));
    }
    if (parsed.query) setSearchQuery(parsed.query);
    if (parsed.addons.length) {
      const raw = allServices.find((s) => s.id === sid || s.slug === sid);
      const known = new Set<string>(addonCatalogFor(raw).map((a) => a.id));
      setAddons(new Set(parsed.addons.filter((id) => known.has(id))));
    }
    const hasSelection = parsed.variant || parsed.quantity != null || parsed.audience || parsed.preference;
    setSelection(
      sid && hasSelection
        ? {
            variantId: parsed.variant ?? undefined,
            quantity: parsed.quantity ?? undefined,
            audience: parsed.audience ?? undefined,
            professionalPreference: parsed.preference ?? undefined,
          }
        : null,
    );
    if (parsed.notes) setInstructions((cur) => cur || parsed.notes);
    if (parsed.promo) {
      const code = parsed.promo.trim();
      useAppStore.getState().setActivePromo(code);
      setCouponInput(code);
      setAppliedCoupon(code);
      showToast(`Coupon ${code} applied automatically`, "success");
    }
  }, [searchParams, services]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return services.map((s, i) => ({ s, i }));
    const q = searchQuery.trim().toLowerCase();
    return services
      .map((s, i) => ({ s, i }))
      .filter(({ s }) =>
        `${s.name} ${s.title} ${s.tagline}`.toLowerCase().includes(q),
      );
  }, [searchQuery, services]);

  const handleSearchSelect = (serviceId: string, q: string) => {
    const idx = Math.max(
      0,
      services.findIndex((s) => s.id === serviceId),
    );
    setSearchQuery(q);
    setPickedHere(true);
    setService(idx);
    setPkg(packagePositionForTier(services[idx] ?? services[0]!, DEFAULT_TIER_INDEX));
    setAddons(new Set());
    setSelection(null);
    showToast(`${(services[idx] ?? services[0]!).title} selected`, "info");
    router.replace(
      bookUrl({ service: serviceId, q: q || undefined }),
      { scroll: false },
    );
  };

  // Where the customer actually is: the stepper used to sit on "Schedule" whatever had been done.
  const currentStep = useMemo(() => {
    if (bookingDone) return 4; // every step ticked
    if (svc.id === "service-unavailable") return 0;
    if (pkg < 0) return 1;
    return slotChosen ? 3 : 2;
  }, [bookingDone, pkg, slotChosen, svc.id]);

  const selectService = (i: number) => {
    setPickedHere(true);
    setService(i);
    setPkg(packagePositionForTier(services[i] ?? services[0]!, DEFAULT_TIER_INDEX));
    setAddons(new Set());
    setSelection(null);
    showToast(`${(services[i] ?? services[0]!).title} selected`, "info");
  };

  const toggleAttested = (code: string) =>
    setAttested((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const scrollTo = (el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Null when the API gave the service no price: there is then no tier to show or to send.
  const selected = svc.packages[pkg] ?? svc.packages[0] ?? null;
  const addonIds = Array.from(addons);
  const rawService = allServices.find((s) => s.id === svc.id);
  const addonList = addonCatalogFor(rawService);
  const rule = rawService?.catalogConfig?.quantity;
  // Quantity-priced services never use package tiers: without a carried selection
  // (e.g. picked in the list below) the server prices the rule's default quantity.
  const effectiveSelection =
    selection ?? (rule ? { quantity: rule.default ?? rule.min } : null);
  // With a selection the server prices variant × quantity; package tiers don't apply.
  const selectionPayload = effectiveSelection
    ? {
        variantId: effectiveSelection.variantId,
        quantity: effectiveSelection.quantity,
        audience: effectiveSelection.audience,
        professionalPreference: effectiveSelection.professionalPreference,
      }
    : selected
      ? { packagePrice: selected.price }
      : {};
  /**
   * Which times the SERVER will accept for the chosen day. The booking step used to offer six
   * hardcoded times nobody had agreed to; this asks.
   */
  /**
   * The service on screen is the one to ask the server about. Until the catalogue has loaded, `svc`
   * is a placeholder from the built-in list (an id the backend does not have), and for one render
   * after it loads it can still be the first service rather than the one in the URL. Asking then
   * produced a 404 for slots and a 400 for the quote on every page load.
   */
  const requestedKnown = parsed.serviceId ? services.some((s) => s.id === parsed.serviceId || s.slug === parsed.serviceId) : false;
  const serviceResolved =
    svc.id !== "service-unavailable" &&
    !servicesLoading &&
    // The link's service is still being looked up, or is not available: the first service in the
    // list is not the customer's choice, so the server is not asked about it.
    urlService !== "loading" &&
    (urlService !== "missing" || pickedHere) &&
    (!requestedKnown || pickedHere || svc.id === parsed.serviceId || svc.slug === parsed.serviceId);

  // Asked when the address is chosen, so a customer outside the service area learns it before
  // picking a date and time. The confirm step and the server still check again. Asked only for the
  // resolved service: for one render the page can hold the first service in the list instead, and
  // its answer shown here would be an answer about a different service.
  /**
   * Phase 15.2 — booking_started: the customer is on the booking page with a real, resolved
   * service (arrived from the detail CTA, a home tile, search, or a shared link). Identity is
   * (session, service): a refresh, a re-render or the detail CTA having already fired it resolve to
   * the same id and stay one row. Fires again only for a different service.
   */
  // A service the page merely defaulted to (no link, nothing picked) is not one the customer chose.
  const funnelServiceId = serviceResolved && (parsed.serviceId || pickedHere) ? rawService?.id : undefined;
  useEffect(() => {
    if (!funnelServiceId) return;
    trackFunnelEvent("BOOKING_STARTED", {
      serviceId: funnelServiceId,
      metadata: { entry: "book-page", fromLink: Boolean(parsed.serviceId), pickedHere },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity is the service; the rest is labels
  }, [funnelServiceId]);

  const toggleAddon = (id: string) => {
    // Phase 15.2 — selecting is the event; removing an add-on is not an "add-on selected".
    const adding = !addons.has(id);
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (adding && funnelServiceId) trackFunnelEvent("ADDON_SELECTED", { serviceId: funnelServiceId, addonId: id, metadata: { page: "book" } });
  };
  // Variant / audience / preference picked on this page (the detail page carries its own selection).
  const selectOnBook = (next: Partial<NonNullable<typeof selection>>) => {
    setSelection((prev) => ({ ...(prev ?? {}), ...next }));
    if (!funnelServiceId) return;
    if (next.variantId) trackFunnelEvent("VARIANT_SELECTED", { serviceId: funnelServiceId, variantId: next.variantId, metadata: { page: "book" } });
    if (next.audience) trackFunnelEvent("OPTION_SELECTED", { serviceId: funnelServiceId, optionId: next.audience, metadata: { kind: "audience", page: "book" } });
    if (next.professionalPreference) {
      trackFunnelEvent("OPTION_SELECTED", { serviceId: funnelServiceId, optionId: next.professionalPreference, metadata: { kind: "preference", page: "book" } });
    }
  };
  const selectPackage = (i: number) => {
    setPkg(i);
    const price = svc.packages[i]?.price;
    if (funnelServiceId && price != null) {
      trackFunnelEvent("OPTION_SELECTED", { serviceId: funnelServiceId, optionId: String(price), metadata: { kind: "tier", page: "book" } });
    }
  };

  const serviceabilityQuery = useServiceabilityQuery({
    serviceId: serviceResolved ? rawService?.id : null,
    addressId: selectedAddress?.id,
    date: toYmdLocal(scheduledAt),
  });
  const serviceability = serviceabilityQuery.data ?? null;
  // The two answers that mean "this cannot be booked here": the confirm controls say so and are off.
  const notServiceable = serviceability?.status === "NOT_AVAILABLE" || serviceability?.status === "TEMPORARILY_UNAVAILABLE";

  const availabilityQuery = useAvailabilityQuery({
    serviceId: serviceResolved && !addressesLoading ? svc.id : null,
    date: toYmdLocal(scheduledAt),
    addressId: effectiveAddressId,
  });

  const priceQuoteQuery = useBookingPriceQuoteQuery(
    // Wait for addresses: the quote is priced at the selected address (surge), and a first quote
    // without it would show a total that silently changes a moment later.
    serviceResolved && !addressesLoading
      ? {
          serviceId: svc.id,
          ...selectionPayload,
          addonIds,
          couponCode: appliedCoupon || undefined,
          addressId: effectiveAddressId ?? undefined,
        }
      : null,
  );
  const quote = priceQuoteQuery.data?.quote;
  const quoteError = priceQuoteQuery.error ? getErrorMessage(priceQuoteQuery.error) : null;
  // Every displayed amount comes from the server quote — never a client total.
  const subtotal = quote?.baseAmount ?? null;
  const taxes = quote?.taxes ?? null;
  const discount = quote?.discount ?? 0;
  const total = quote?.finalAmount ?? null;
  const couponError = quote?.couponError;
  const requirements = quote?.requirements ?? null;
  const mustConfirm = requirements?.beforeBooking ?? [];
  const unconfirmed = mustConfirm.filter((r) => !attested.has(r.code));
  const sel = quote?.selection;
  const summaryLine = bookingSummaryLine({
    hasSelection: Boolean(effectiveSelection),
    selection: sel,
    serverPrice: quote?.packagePrice,
    tier: selected,
  });

  async function resolveAddressId(): Promise<string | null> {
    if (effectiveAddressId) return effectiveAddressId;
    showToast("Add your service address to continue", "error");
    setAddAddressOpen(true);
    return null;
  }

  async function confirmBooking() {
    if (confirming) return;
    // The link named a service that is not available: nothing is booked until the customer picks one.
    if (urlService === "missing" && !pickedHere) {
      showToast("The service in this link is not available. Choose a service to continue.", "error");
      return;
    }
    if (!quote) {
      showToast(quoteError ?? "Price is still being calculated", "error");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("You are offline. Reconnect and try again.", "error");
      return;
    }
    if (addressesLoading) {
      showToast("Loading your addresses…", "info");
      return;
    }
    if (!slotChosen) {
      showToast("Choose a time slot before paying", "error");
      scrollTo(dateRef.current);
      return;
    }
    const offered = availabilityQuery.data?.slots ?? [];
    if (availabilityQuery.isLoading || (offered.length === 0 && availabilityQuery.isFetching)) {
      showToast("Checking available times…", "info");
      return;
    }
    if (
      !retryUnseenCreate.current &&
      offered.length > 0 &&
      !offered.some((s) => s.available && new Date(s.start).getTime() === scheduledAt.getTime())
    ) {
      setSlotChosen(false);
      showToast("That time isn't available. Pick another slot.", "error");
      scrollTo(dateRef.current);
      return;
    }
    setConfirming(true);
    let bookingAnswered = false;
    try {
      const addressId = await resolveAddressId();
      if (!addressId) {
        setConfirming(false);
        return;
      }
      const pin = savedAddresses.find((a) => a.id === addressId);
      if (pin?.latitude != null && pin.longitude != null) {
        try {
          const zone = await coreApi.geo.serviceable(
            pin.latitude,
            pin.longitude,
            rawService?.category ?? rawService?.taxonomy?.category?.slug,
          );
          if (!zone.serviceable) {
            setConfirming(false);
            showToast("This service is not currently available in your area", "error");
            return;
          }
        } catch (err) {
          setConfirming(false);
          showToast(getErrorMessage(err, "Couldn't check if we serve this address"), "error");
          return;
        }
      }
      // The quote token lets the server refuse — rather than silently charge a different total —
      // if the price moved since the customer saw it.
      if (unconfirmed.length) {
        setConfirming(false);
        showToast(`Please confirm: ${unconfirmed.map((r) => r.label).join(", ")}`, "error");
        scrollTo(prepRef.current);
        return;
      }
      if (quote.expiresAt && new Date(quote.expiresAt).getTime() <= Date.now()) {
        await priceQuoteQuery.refetch();
        showToast("Your price was refreshed — please review the total and confirm again", "info");
        return;
      }
      // The same request reuses its stored key (a retry, or a refresh after a lost response);
      // a different slot, address or selection is a new attempt.
      const idempotencyKey = attemptKeyFor(
        attemptStore.current,
        attemptFingerprint({
          serviceId: svc.id,
          addressId,
          scheduledDate: scheduledAt.toISOString(),
          ...selectionPayload,
          addonIds,
          couponCode: appliedCoupon || null,
          description: instructions.trim() || null,
        }),
        () => crypto.randomUUID(),
      );
      const created = await createBookingMutation.mutateAsync({
        serviceId: svc.id,
        scheduledDate: scheduledAt.toISOString(),
        addressId,
        description: instructions.trim() || undefined,
        paymentMethod: "razorpay",
        ...selectionPayload,
        addonIds,
        couponCode: appliedCoupon || undefined,
        quoteToken: quote.quoteToken,
        idempotencyKey,
        ...(mustConfirm.length ? { requirementAttestations: mustConfirm.filter((r) => attested.has(r.code)).map((r) => r.code) } : {}),
      });
      bookingAnswered = true;
      releaseAttempt(attemptStore.current);
      retryUnseenCreate.current = false;
      if (!created.booking?.id) {
        showToast("Booking could not be confirmed", "error");
        return;
      }
      const booking: SavedBooking = {
        ...mapBackendBookingToSaved(created.booking),
        serviceId: svc.id,
        serviceTitle: svc.title,
        serviceName: svc.name,
        // What was booked: the server-priced selection, or the tier when the tier was the selection.
        // A finished label, printed as is by every consumer; empty when there is nothing to name.
        packageName: summaryLine.label ?? "",
        dateLabel: `${formatDateLabel(scheduledAt)}, ${scheduledAt.getFullYear()}`,
        timeLabel: formatTimeLabel(scheduledAt),
        address: addressText,
        imagePath: SERVICE_IMAGES[svc.id] ?? svc.img,
        serviceColor: svc.color,
        instructions: instructions.trim() || undefined,
      };
      addBooking(booking);
      // The success modal and the "confirmed" copy are gated on the SERVER verifying the payment.
      // `payForBooking` resolves as soon as the gateway sheet opens (razorpay.open() is void), so
      // anything after the await would fire while the payment is unattempted, dismissed or declined.
      await payForBooking({
        bookingId: created.booking.id,
        description: `${svc.title} booking payment`,
        onVerified: () => {
          // The server has just verified this payment; the create response predates it.
          setBookingDone({ ...booking, paymentStatus: "success" });
          showToast("Payment verified — we're finding your pro", "success");
        },
      });
    } catch (err) {
      // A dropped response may already have created the booking. Keep the key so the next confirm
      // replays it. A server answer (price, slot, validation) released the key, so the next confirm
      // is a new attempt.
      const failed = err as { code?: string; status?: number } | null;
      // Only the create's own outcome can be "unseen": a payment error after it is a separate matter.
      const keepKey = !bookingAnswered && keepAttemptAfter(err);
      retryUnseenCreate.current = keepKey;
      if (!keepKey) releaseAttempt(attemptStore.current);
      // The mutation toasts the server's message. A price change or an expired quote also means
      // the total on screen is stale: reload the server quote so the customer re-confirms the real one.
      const code = failed?.code;
      if (code === "PRICE_CHANGED" || code === "QUOTE_EXPIRED" || code === "QUOTE_MISMATCH") {
        void priceQuoteQuery.refetch();
      }
      if (code === "REQUIREMENTS_NOT_CONFIRMED") scrollTo(prepRef.current);
      // A schedule refusal (lead time, blackout date, the partner's hours, an overlapping booking)
      // is fixed by picking another slot, so put the customer on the date step rather than leaving
      // them at the confirm button with a toast.
      if (code === "SCHEDULE_NOT_ALLOWED" || code === "PROVIDER_UNAVAILABLE" || code === "OVERLAPPING_BOOKING") {
        scrollTo(dateRef.current);
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className={bookPageRoot}>
      <BookAmbientBackground />

      <BookPageHeader currentStep={currentStep} />

      <main className={bookMain}>
        {/* ---------- Search + location ---------- */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-4">
          <ServiceSearchInput
            initialQuery={searchQuery}
            inputClassName="px-4 sm:px-6"
            onQueryChange={setSearchQuery}
            onSelectService={handleSearchSelect}
          />
          <div className="flex shrink-0 items-center sm:h-auto">
            <LocationButton />
          </div>
        </div>

        {/* ---------- Service strip (premium glass 3D cards) ---------- */}
        <div className={cn("mt-5 sm:mt-8", bookServiceRail)}>
          {servicesLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <StaticSkeleton key={`book-service-skeleton-${i}`} className="h-[190px] rounded-[24px] bg-surface/70 ring-1 ring-line" />
              ))
            : null}
          {!servicesLoading && servicesError ? (
            <div className="col-span-full rounded-2xl border border-line bg-surface/60 px-4 py-8 text-center text-sm text-muted">
              Could not load services.
              <button
                type="button"
                onClick={() => void refetchServices()}
                className="ml-2 font-semibold text-emerald-600 underline"
              >
                Retry
              </button>
            </div>
          ) : null}
          {catalogueReady && searchQuery.trim() && filteredServices.length === 0 ? (
            <p className="col-span-full rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-sm text-muted">
              No services match &ldquo;{searchQuery.trim()}&rdquo;.
            </p>
          ) : null}
          {(catalogueReady ? filteredServices : []).map(({ s, i }) => {
            const active = i === service;
            const Icon = s.icon;
            return (
              <motion.button
                key={s.id}
                type="button"
                onClick={() => selectService(i)}
                whileHover={{ y: -8 }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  bookServiceCard,
                  active
                    ? "bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_14px_34px_-10px_rgb(16_185_129/0.55)]"
                    : "glass-card text-content hover:shadow-[0_22px_50px_-14px_rgb(15_23_42/0.28)]",
                )}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 sheen opacity-70"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute -bottom-14 left-1/2 size-40 -translate-x-1/2 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-60"
                  style={{ background: active ? "#10b981" : s.color }}
                />
                {active && (
                  <span className="absolute right-2 top-2 z-10 rounded-full bg-white/95 px-2 py-0.5 text-[9px] font-bold text-emerald-700 shadow-e2 backdrop-blur sm:right-3 sm:top-3 sm:px-3 sm:py-1 sm:text-[11px]">
                    Selected
                  </span>
                )}
                <span
                  className={cn(
                    "relative grid size-20 place-items-center overflow-hidden rounded-[18px] transition-transform duration-300 group-hover:scale-105 sm:size-28 sm:rounded-[24px]",
                    active ? "bg-white/15 ring-1 ring-white/30" : "ring-1 ring-white/50",
                  )}
                  style={
                    active
                      ? undefined
                      : {
                          background: `linear-gradient(135deg, ${s.color}33 0%, ${s.color}14 60%, ${s.color}0A 100%)`,
                          boxShadow: `inset 0 2px 6px rgb(255 255 255 / 0.6), 0 12px 24px -8px ${s.color}55`,
                        }
                  }
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-1/2 sheen"
                  />
                  {s.img ? (
                    <ServiceImage
                      src={s.img}
                      alt={s.name}
                      size={96}
                      sizes="(max-width: 640px) 64px, 96px"
                      className="relative size-16 drop-shadow-[0_12px_20px_rgb(15_23_42/0.32)] transition-transform duration-500 ease-out group-hover:scale-[1.18] sm:size-24"
                    />
                  ) : Icon ? (
                    <>
                      <Icon
                        size={40}
                        strokeWidth={1.75}
                        className="transition-transform duration-500 group-hover:scale-[1.18] sm:hidden"
                        style={{ color: active ? "#fff" : s.color }}
                      />
                      <Icon
                        size={52}
                        strokeWidth={1.75}
                        className="hidden transition-transform duration-500 group-hover:scale-[1.18] sm:block"
                        style={{ color: active ? "#fff" : s.color }}
                      />
                    </>
                  ) : null}
                </span>
                <span className="relative font-display text-sm font-bold sm:text-lg">
                  {s.name}
                </span>
                <span
                  className={cn(
                    "relative text-xs font-medium sm:text-sm",
                    active ? "text-white/90" : "text-muted",
                  )}
                >
                  {/* The API's price, or nothing — never a placeholder amount. */}
                  {s.price ? `From ${s.price}` : null}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* ---------- Two-column layout ----------
            Only once the catalogue has answered. While it loads, fails or comes back empty there is
            no service to describe, so no title, price, tier or total is shown — the built-in list
            used to stand in here with prices and package contents that were not the server's. */}
        {!catalogueReady ? (
          <p
            role="status"
            data-testid="book-catalogue-state"
            className="mt-8 rounded-2xl border border-line bg-surface/60 px-4 py-12 text-center text-sm text-muted"
          >
            {servicesLoading
              ? "Loading services…"
              : servicesError
                ? "Services could not be loaded, so booking is unavailable right now. Retry above."
                : "No services are available to book right now."}
          </p>
        ) : (
        <>
        {urlService === "missing" && !pickedHere ? (
          <p role="alert" data-testid="book-service-unavailable" className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            The service in this link is not available to book. Choose a service below.
          </p>
        ) : null}
        <div className={bookSplitGrid}>
          {/* ================= LEFT ================= */}
          <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
            {/* Service hero */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_32px_80px_-20px_rgb(6_78_59/0.6)] ring-1 ring-emerald-300/20 sm:rounded-[32px] sm:p-8 lg:rounded-[36px] lg:p-12"
              style={{
                background:
                  "linear-gradient(135deg, #064e3b 0%, #0f766e 55%, #115e59 100%)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/12 to-transparent"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-emerald-300/25 blur-3xl"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-24 right-1/3 size-72 rounded-full bg-teal-300/20 blur-3xl"
              />
              <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
                {/* 3D image + halo */}
                <div className="relative grid shrink-0 place-items-center">
                  <span className="absolute size-40 rounded-full halo opacity-55 sm:size-64" />
                  {svc.img ? (
                    <MotionImage
                      key={svc.img}
                      src={svc.img}
                      alt={svc.title}
                      sizes="(min-width: 1024px) 240px, (min-width: 640px) 192px, 144px"
                      wrapperClassName="size-36 sm:size-48 lg:size-60"
                      animate={{ y: [0, -12, 0] }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                      className="drop-shadow-[0_28px_52px_rgb(16_185_129/0.55)]"
                    />
                  ) : SvcIcon ? (
                    <motion.div
                      animate={{ y: [0, -12, 0] }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                      className="relative grid size-36 place-items-center sm:size-48 lg:size-60"
                    >
                      <SvcIcon
                        size={72}
                        className="text-white sm:hidden"
                      />
                      <SvcIcon
                        size={120}
                        className="hidden text-white sm:block"
                      />
                    </motion.div>
                  ) : null}
                </div>

                <div className="min-w-0 flex-1 text-center sm:text-left">
                  {/* Only the catalogue's own flag (services.isPopular), worded as the catalogue words it. */}
                  {rawService?.isPopular ? (
                    <span className="inline-block rounded-full bg-success-strong px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg sm:px-4 sm:py-1.5 sm:text-xs">
                      Popular
                    </span>
                  ) : null}
                  <h2
                    className={cn(bookHeroTitle, "mt-3 sm:mt-4")}
                    style={{ fontSize: "clamp(1.75rem, 6vw, 3.75rem)" }}
                  >
                    {svc.title}
                  </h2>
                  {svc.tagline ? (
                    <p className="mt-2 text-sm text-white/75 sm:mt-3 sm:text-base lg:text-lg">
                      {svc.tagline}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-4 sm:justify-start">
                    {rawService?.rating != null && rawService.rating > 0 && (rawService.reviewCount ?? 0) > 0 ? (
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Star size={18} className="fill-gold text-gold" />
                        {rawService.rating.toFixed(1)}
                        <span className="font-normal text-white/60">
                          ({rawService.reviewCount} {rawService.reviewCount === 1 ? "review" : "reviews"})
                        </span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* feature chips */}
              <div className="book-hero-feature relative mt-5 grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-3 ring-1 ring-white/10 sm:mt-7 sm:grid-cols-4 sm:gap-3 sm:rounded-2xl sm:p-4">
                {HERO_FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.label}
                      className="flex flex-col items-center gap-1 text-center sm:gap-1.5"
                    >
                      <Icon size={18} className="text-emerald-300 sm:size-5" />
                      <span className="whitespace-pre-line text-[10px] font-medium text-white/80 sm:text-xs">
                        {f.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            {/* Price picker (or the carried selection) */}
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3">
                <h3 className={bookSectionTitle}>{effectiveSelection ? "Your Selection" : svc.packages.length > 1 ? "Choose a Price Option" : "Price"}</h3>
              </div>
              {effectiveSelection ? (
                <SelectionSummary
                  selection={sel}
                  loading={priceQuoteQuery.isFetching && !sel}
                  error={quoteError}
                  onChange={() => router.back()}
                  controls={
                    <SelectionControls
                      config={rawService?.catalogConfig}
                      current={effectiveSelection}
                      onSelect={selectOnBook}
                    />
                  }
                />
              ) : (
              <div className={bookPackageGrid}>
                {svc.packages.map((p, i) => {
                  const active = i === pkg;
                  return (
                    <motion.button
                      key={p.tierIndex ?? i}
                      type="button"
                      onClick={() => selectPackage(i)}
                      whileHover={{ y: -8 }}
                      className={cn(
                        "group relative flex min-w-0 flex-col overflow-hidden rounded-[20px] p-5 text-left transition-shadow duration-300 sm:rounded-[28px] sm:p-7",
                        active
                          ? "glass-card ring-2 ring-emerald-500 shadow-[0_24px_56px_-12px_rgb(16_185_129/0.4)]"
                          : "glass-card hover:shadow-[0_24px_56px_-16px_rgb(15_23_42/0.28)]",
                      )}
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 h-20 sheen"
                      />
                      {/* Named for what it is ("Base price"); a single price carries no name. */}
                      {p.name ? (
                        <span className="relative font-display text-lg font-bold text-content sm:text-xl">
                          {p.name}
                        </span>
                      ) : null}
                      {p.tag ? (
                        <span className="relative text-xs text-muted sm:text-sm">
                          {p.tag}
                        </span>
                      ) : null}
                      <span
                        className="relative mt-3 font-display font-bold text-content sm:mt-4"
                        style={{ fontSize: "clamp(2rem, 6vw, 3rem)" }}
                      >
                        ₹{p.price}
                      </span>
                      <ul className="relative mt-5 flex flex-1 flex-col gap-2.5">
                        {p.items.map((it) => (
                          <li
                            key={it}
                            className="flex items-center gap-2 text-sm text-content"
                          >
                            <Check
                              size={15}
                              className="shrink-0 text-success"
                              strokeWidth={3}
                            />
                            {it}
                          </li>
                        ))}
                      </ul>
                      {/* Nothing to select between when the service has one price. */}
                      {svc.packages.length > 1 ? (
                      <span
                        className={cn(
                          "relative mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold transition",
                          active
                            ? "bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_10px_26px_-8px_rgb(16_185_129/0.55)]"
                            : "border border-emerald-500/40 text-emerald-600 group-hover:bg-emerald-500/5",
                        )}
                      >
                        {active ? (
                          <>
                            Selected <Check size={16} strokeWidth={3} />
                          </>
                        ) : (
                          "Select"
                        )}
                      </span>
                      ) : null}
                    </motion.button>
                  );
                })}
              </div>
              )}
            </div>

            {/* Date & time */}
            <div ref={dateRef} className="scroll-mt-28">
            <SectionCard>
              <BookingScheduleSection
                scheduledAt={scheduledAt}
                timeSelected={slotChosen}
                onScheduledAtChange={(next) => {
                  setScheduledAt(next);
                  setSlotChosen(false);
                }}
                onPickTime={(next) => {
                  setScheduledAt(next);
                  setSlotChosen(true);
                }}
                onInvalid={(msg) => showToast(msg, "error")}
                step={3}
                slots={availabilityQuery.data?.slots}
                slotsLoading={availabilityQuery.isLoading}
              />
            </SectionCard>
            </div>

            {/* Phase 16 — live pros near you (reuses the certified matching engine). */}
            {svc.id && svc.id !== "service-unavailable" && (
              <SectionCard>
                <h3 className="mb-3 font-display text-lg font-bold text-content">Pros near you</h3>
                <ProviderETA
                  serviceId={svc.id}
                  latitude={selectedAddress?.latitude ?? getLocation(locationId).latitude}
                  longitude={selectedAddress?.longitude ?? getLocation(locationId).longitude}
                />
              </SectionCard>
            )}

            {/* Add-ons + instructions */}
            <div className="grid gap-6 sm:gap-8 lg:grid-cols-2">
              <SectionCard>
                <h3 className="mb-4 font-display text-lg font-bold text-content">
                  Add-ons{" "}
                  <span className="text-sm font-medium text-muted">
                    (Optional)
                  </span>
                </h3>
                <div className="flex flex-col gap-3">
                  {addonList.map((a) => {
                    const on = addons.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAddon(a.id)}
                        className="flex items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-emerald-500/5"
                      >
                        <span
                          className={cn(
                            "grid size-6 shrink-0 place-items-center rounded-md border-2 transition",
                            on
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-line",
                          )}
                        >
                          {on && <Check size={14} strokeWidth={3} />}
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-bold text-content">
                            {a.name}
                          </span>
                          <span className="block text-xs text-muted">
                            {a.desc}
                          </span>
                        </span>
                        <span className="text-sm font-bold text-emerald-600">
                          + ₹{a.price}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard>
                <h3 id="special-instructions-heading" className="mb-4 font-display text-lg font-bold text-content">
                  Special Instructions
                </h3>
                <Textarea
                  ref={instrRef}
                  aria-labelledby="special-instructions-heading"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxCharacters={250}
                  showCharacterCount
                  placeholder="Any specific instructions for your professional…"
                  size="sm"
                  className="scroll-mt-28"
                  containerClassName="rounded-2xl bg-surface/60"
                />
              </SectionCard>
            </div>
          </div>

          {/* ================= RIGHT (sidebar) ================= */}
          <div className="flex min-w-0 flex-col gap-6 sm:gap-8 lg:sticky lg:top-28 lg:self-start">
            {/* Booking summary */}
            <SectionCard>
              <h3
                className="font-display font-bold tracking-tight text-content"
                style={{ fontSize: "clamp(1.25rem, 4vw, 1.5rem)" }}
              >
                Booking Summary
              </h3>

              <div className="mt-4 flex items-center gap-3 rounded-2xl glass-card p-3">
                {svc.img ? (
                  <ServiceImage
                    src={svc.img}
                    alt={svc.title}
                    size={64}
                    sizes="64px"
                    className="size-16 drop-shadow-md"
                  />
                ) : SvcIcon ? (
                  <span className="grid size-16 place-items-center">
                    <SvcIcon size={36} style={{ color: svc.color }} />
                  </span>
                ) : null}
                <span className="flex-1">
                  <span className="block text-sm font-bold text-content">
                    {svc.title}
                  </span>
                  {/* The selection the server is pricing; a tier only when the tier is the selection. */}
                  {summaryLine.label ? (
                    <span data-testid="summary-selection" className="block text-xs text-muted">
                      {summaryLine.label}
                    </span>
                  ) : null}
                </span>
                <span className="font-display font-bold text-content">
                  {summaryLine.amount != null ? `₹${summaryLine.amount}` : "—"}
                </span>
              </div>

              {/* Date & Time */}
              <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-4">
                <span>
                  <span className="block text-sm font-bold text-content">
                    Date &amp; Time
                  </span>
                  <span className="block whitespace-pre-line text-xs text-muted">
                    {`${formatDateLabel(scheduledAt)}, ${scheduledAt.getFullYear()}\n${formatTimeLabel(scheduledAt)}`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => scrollTo(dateRef.current)}
                  className="text-xs font-bold text-emerald-600 hover:underline"
                >
                  Edit
                </button>
              </div>

              {/* Address */}
              <div className="mt-4 border-t border-line pt-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-bold text-content">Address</span>
                  <button
                    type="button"
                    onClick={() => setAddAddressOpen(true)}
                    className="text-xs font-bold text-emerald-600 hover:underline"
                  >
                    Add address
                  </button>
                </div>
                {savedAddresses.length > 0 ? (
                  <select
                    aria-label="Service address"
                    value={effectiveAddressId ?? ""}
                    onChange={(e) => setSelectedAddressId(e.target.value || null)}
                    className="mt-2 w-full rounded-xl border border-line bg-surface/60 px-2 py-2 text-xs text-content"
                  >
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.latitude == null || a.longitude == null}>
                        {[a.label, a.line1, a.city].filter(Boolean).join(" · ")}
                        {a.latitude == null || a.longitude == null ? " (no map pin)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="mt-1 block text-xs text-muted">
                    {addressesLoading ? "Loading your addresses…" : "Add the address where the service will happen."}
                  </span>
                )}
                {selectedAddress && rawService ? (
                  <p
                    role="status"
                    data-testid="serviceability-status"
                    data-status={serviceability?.status ?? (serviceabilityQuery.isLoading ? "CHECKING" : "UNKNOWN")}
                    className={`mt-2 text-xs font-medium ${
                      notServiceable
                        ? "text-error"
                        : serviceability?.status === "AVAILABLE"
                          ? "text-success"
                          : serviceability?.status === "LIMITED" || serviceability?.status === "NEEDS_CONFIRMATION"
                            ? "text-warning"
                            : "text-muted"
                    }`}
                  >
                    {/* The sentence is the server's (lib/customer-serviceability); nothing is derived here. */}
                    {serviceability
                      ? serviceability.message
                      : serviceabilityQuery.isLoading
                        ? "Checking availability for this address…"
                        : "We couldn't check this address just now. We'll check again when you confirm."}
                  </p>
                ) : null}
                <AddAddressModal
                  open={addAddressOpen}
                  onClose={() => setAddAddressOpen(false)}
                  onSaved={(id) => setSelectedAddressId(id)}
                />
              </div>

              {/* Instructions */}
              <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-4">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-content">
                    Instructions
                  </span>
                  <span className="block break-words text-xs text-muted">
                    {instructions.trim() || "None"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    scrollTo(instrRef.current);
                    setTimeout(() => instrRef.current?.focus(), 400);
                  }}
                  className="shrink-0 text-xs font-bold text-emerald-600 hover:underline"
                >
                  Edit
                </button>
              </div>

              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  Promo code
                </p>
                <div className="flex gap-2">
                  <Input
                    size="sm"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Enter code"
                    showClear={false}
                    containerClassName="flex-1 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setAppliedCoupon(couponInput.trim())}
                    className="shrink-0 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white"
                  >
                    Apply
                  </button>
                </div>
                {couponError && appliedCoupon ? (
                  <p className="mt-1 text-xs text-warning">{couponError.replace(/_/g, " ")}</p>
                ) : null}
                {appliedCoupon && !couponError && (quote?.campaignDiscount ?? 0) + (quote?.membershipDiscount ?? 0) > 0 ? (
                  <p className="mt-1 text-xs text-success">
                    {appliedCoupon} applied — ₹{(quote?.campaignDiscount ?? 0) + (quote?.membershipDiscount ?? 0)} off
                  </p>
                ) : appliedCoupon && !couponError && !priceQuoteQuery.isFetching ? (
                  <p className="mt-1 text-xs text-success">{appliedCoupon} applied</p>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                {quoteError ? (
                  <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">{quoteError}</p>
                ) : null}
                <Row label="Service + add-ons" value={subtotal != null ? `₹${subtotal}` : "—"} />
                {discount > 0 ? (
                  <Row label="Discounts" value={`-₹${discount}`} />
                ) : null}
                <Row
                  label={
                    quote?.tax
                      ? `${quote.tax.label} (${quote.tax.rateBps / 100}%)`
                      : "Taxes"
                  }
                  value={taxes != null ? `₹${taxes}` : "—"}
                />
                {priceQuoteQuery.isFetching ? (
                  <p className="text-xs text-muted">Updating price…</p>
                ) : null}
              </div>

              {requirements && !requirements.empty && (
                <div ref={prepRef} className="mt-5 border-t border-line pt-5">
                  <BookingPreparation view={requirements} attested={attested} onToggle={toggleAttested} />
                </div>
              )}

              <div className="mt-5 flex items-center justify-between border-t border-line pt-5">
                <span className="font-display text-lg font-bold text-content">
                  Total Payable
                </span>
                <span
                  className="font-display font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent"
                  style={{ fontSize: "clamp(1.5rem, 5vw, 1.875rem)" }}
                >
                  {total != null ? `₹${total}` : "—"}
                </span>
              </div>

              <CancellationPolicyCard />

              <div className="mt-4 hidden items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 text-xs ring-1 ring-success/20 lg:flex">
                <Lock size={16} className="text-success" />
                <span>
                  <span className="block font-bold text-success">
                    Secure Payment
                  </span>
                  <span className="text-muted">
                    Card details are handled by Razorpay
                  </span>
                </span>
              </div>

              <motion.button
                type="button"
                disabled={confirming || notServiceable}
                onClick={confirmBooking}
                whileHover={{ y: confirming || notServiceable ? 0 : -3 }}
                whileTap={{ scale: confirming || notServiceable ? 1 : 0.98 }}
                className="mt-5 hidden h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-base font-bold text-white shadow-[0_18px_40px_-10px_rgb(16_185_129/0.55)] disabled:opacity-70 lg:flex"
              >
                <Lock size={18} />
                {confirming
                  ? "Securing your slot…"
                  : notServiceable
                    ? "Not available at this address"
                    : slotChosen
                      ? "Confirm Booking Securely"
                      : "Choose a time slot"}
                <ArrowRight size={18} />
              </motion.button>
              <p className="mt-2 hidden text-center text-xs text-muted lg:block">
                Payment is taken when you confirm
              </p>
            </SectionCard>
          </div>
        </div>
        </>
        )}

        {/* ---------- Trust bar ---------- */}
        <div className="mt-8 flex flex-col items-center justify-between gap-6 rounded-[20px] glass-card px-4 py-6 sm:mt-12 sm:gap-8 sm:rounded-[28px] sm:px-8 sm:py-8 lg:flex-row lg:px-10">
          <div className="grid w-full grid-cols-2 gap-4 min-[480px]:flex min-[480px]:flex-wrap min-[480px]:justify-center min-[480px]:gap-6 sm:gap-8 lg:w-auto">
            {TRUST.map((t) => {
              const Icon = t.icon;
              return (
                <div
                  key={t.label}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <Icon size={22} className="text-emerald-600" />
                  <span className="whitespace-pre-line text-xs font-semibold text-muted">
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>

        </div>
      </main>

      {catalogueReady ? (
        <BookStickyCheckout
          total={total}
          confirming={confirming}
          slotChosen={slotChosen}
          unavailable={notServiceable}
          onConfirm={confirmBooking}
        />
      ) : null}

      <BookingSuccessModal
        open={!!bookingDone}
        onClose={() => setBookingDone(null)}
        booking={bookingDone}
        onViewBookings={() => {
          setBookingDone(null);
          router.push("/bookings");
        }}
      />
    </div>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={cn("font-semibold text-content", className)}>
        {value}
      </span>
    </div>
  );
}

/** Add-ons offered for a service: only the catalogue on the service. */
function addonCatalogFor(raw: BackendService | undefined): { id: string; name: string; desc: string; price: number }[] {
  const own = raw?.catalogConfig?.addons;
  if (!own) return [];
  return own.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, desc: "", price: a.price }));
}

/**
 * The option and the quantity, changeable here: the options the server lists, in its order, and a
 * quantity stepper inside the server's rule. Each change is sent to the server, which prices it or
 * refuses it in its own words; nothing here decides a price or a bound.
 */
function SelectionControls({
  config,
  current,
  onSelect,
}: {
  config: BackendService["catalogConfig"] | null | undefined;
  current: { variantId?: string; quantity?: number } | null;
  onSelect: (next: { variantId?: string; quantity?: number }) => void;
}) {
  const variants = bookVariants(config);
  const rule = bookQuantityRule(config);
  if (!variants.length && !rule) return null;
  const variant = variants.find((v) => v.id === current?.variantId) ?? null;
  const bounds = rule ? bookQuantityBounds(rule, variant) : null;
  const quantity = rule && bounds ? clampQuantity(current?.quantity ?? rule.default ?? rule.min, bounds) : null;
  const unit = rule ? (quantity === 1 ? rule.unitLabel : rule.unitLabelPlural ?? rule.unitLabel) : null;
  const step = (dir: -1 | 1) => {
    if (!bounds || quantity == null) return;
    const next = clampQuantity(quantity + dir * (bounds.step > 0 ? bounds.step : 1), bounds);
    if (next !== quantity) onSelect({ quantity: next });
  };
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="selection-controls">
      {variants.length ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Option</span>
          <select
            aria-label="Option"
            data-testid="selection-option"
            value={current?.variantId ?? ""}
            onChange={(e) => onSelect({ variantId: e.target.value || undefined })}
            className="min-h-11 rounded-xl border border-line bg-surface px-3 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <option value="">Choose an option</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {rule && bounds && quantity != null ? (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Quantity</span>
          <div className="flex items-center gap-2" role="group" aria-label="Quantity">
            <button
              type="button"
              aria-label="Fewer"
              onClick={() => step(-1)}
              disabled={quantity <= bounds.min}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg text-content disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-16 text-center font-medium text-content" data-testid="selection-quantity" aria-live="polite">
              {quantity} {unit}
            </span>
            <button
              type="button"
              aria-label="More"
              onClick={() => step(1)}
              disabled={quantity >= bounds.max}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-lg text-content disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The server-priced selection carried from the service page (variant, quantity, audience). */
function SelectionSummary({
  selection,
  loading,
  error,
  onChange,
  controls,
}: {
  selection: ServiceSelectionSnapshot | undefined;
  loading: boolean;
  error: string | null;
  onChange: () => void;
  /** The option / quantity controls, when the service has any. */
  controls?: React.ReactNode;
}) {
  const audience = selection?.audience ? AUDIENCE_LABEL[selection.audience] : null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      {error ? (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      ) : loading || !selection ? (
        <p className="text-sm text-muted">Calculating your price…</p>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {selection.variant ? (
            <Row label="Option" value={selection.variant.name} />
          ) : null}
          {selection.quantityType ? (
            <Row label="Quantity" value={`${selection.quantity} ${selection.unitLabel ?? ""}`.trim()} />
          ) : null}
          {selection.unitPrice != null ? <Row label="Unit price" value={`₹${selection.unitPrice}`} /> : null}
          {audience ? <Row label="For" value={audience} /> : null}
          <Row label="Estimated time" value={`${selection.durationMinutes} min`} />
        </dl>
      )}
      {controls}
      <button type="button" onClick={onChange} className="mt-4 text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-300">
        Back to the service page
      </button>
    </div>
  );
}

const AUDIENCE_LABEL: Record<string, string> = {
  women: "Women",
  men: "Men",
  girls: "Girls",
  boys: "Boys",
  "senior-women": "Senior Women",
  "senior-men": "Senior Men",
};

/**
 * Phase 06 — the selection's requirements on the booking page, from the server quote. Blocking
 * requirements are ticked here; the backend refuses the booking without them, so this is guidance,
 * never the enforcement.
 */
function BookingPreparation({
  view,
  attested,
  onToggle,
}: {
  view: NonNullable<NonNullable<ReturnType<typeof useBookingPriceQuoteQuery>["data"]>["quote"]["requirements"]>;
  attested: Set<string>;
  onToggle: (code: string) => void;
}) {
  const lines: Array<{ title: string; items: typeof view.weBring }> = [
    { title: "Have this ready", items: view.beforeArrival },
    { title: "You'll provide", items: view.youProvide },
    { title: "Shared", items: view.shared },
    { title: "We'll bring", items: view.weBring },
    { title: "Optional", items: view.optional },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4" data-testid="booking-preparation">
      <p className="text-sm font-semibold text-content">Before we arrive</p>
      {view.beforeBooking.length > 0 && (
        <ul className="space-y-2">
          {view.beforeBooking.map((r) => (
            <li key={r.code}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-emerald-600"
                  checked={attested.has(r.code)}
                  onChange={() => onToggle(r.code)}
                  aria-describedby={r.note ? `prep-note-${r.code}` : undefined}
                />
                <span className="min-w-0">
                  <span className="font-medium text-content">{r.label}</span>
                  <span className="block text-xs text-muted">Please confirm before booking</span>
                  {r.note && <span id={`prep-note-${r.code}`} className="mt-1 block text-xs text-muted">{r.note}</span>}
                  {r.warning && <span className="mt-1 block text-xs text-warning">{r.warning}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {lines.map((g) => (
        <div key={g.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>
          <ul className="mt-1 space-y-1 text-sm text-content">
            {g.items.map((r) => (
              <li key={r.code} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" aria-hidden />
                <span>
                  {r.label}
                  {[r.quantity, r.chargeText, r.timingText].filter(Boolean).length > 0 && (
                    <span className="text-muted"> · {[r.quantity, r.chargeText, r.timingText].filter(Boolean).join(" · ")}</span>
                  )}
                  {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}


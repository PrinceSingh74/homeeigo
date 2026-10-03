"use client";

import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { m as motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Star,
  ShieldCheck,
  BadgeCheck,
  Clock,
  Sparkles,
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
import { AddAddressModal } from "@/components/profile/AddAddressModal";
import {
  SERVICES,
  popularPackageIndex,
  packagePositionForTier,
  getLocation,
  type Service,
} from "@/lib/services";
import { bookUrl, parseBookParams } from "@/lib/booking-url";
import { BOOKING_ADDONS, tierOptions } from "@/lib/catalog/pricing";
import { SERVICE_IMAGES, type SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  mapBackendBookingToSaved,
  useAddressesQuery,
  useAvailabilityQuery,
  useBookingPriceQuoteQuery,
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
import { getErrorMessage } from "@/lib/auth/errors";

/* ----------------------------- data ----------------------------- */

// Only claims the product can back: partner approval, itemised server pricing,
// live arrival tracking and gateway payments. (No guarantees or material claims.)
const HERO_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: BadgeCheck, label: "Itemised\nPricing" },
  { icon: Clock, label: "Live Arrival\nTracking" },
  { icon: CreditCard, label: "Secure\nPayments" },
];

// Shared with the service detail page so both show the same add-on prices.
const ADDONS = BOOKING_ADDONS;

const TRUST = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: UserCheck, label: "Start PIN\nat the Door" },
  { icon: Clock, label: "Live\nTracking" },
  { icon: BadgeCheck, label: "Cancellation Terms\nShown Upfront" },
  { icon: CreditCard, label: "Secure\nPayments" },
];

const FALLBACK_SERVICE: Service = {
  id: "service-unavailable",
  name: "Service",
  price: "₹0",
  priceFrom: 0,
  color: "#7C3AED",
  title: "Service",
  tagline: "Live catalog is syncing. Please retry shortly.",
  rating: "0",
  reviews: "0",
  homes: "",
  packages: [{ name: "Standard", tag: "Default", price: 0, items: ["Live pricing unavailable"] }],
  keywords: [],
};

/**
 * Exactly the tiers the server prices (resolvePackagePrice: min / base / max, exact values only).
 * Not base × 1.35 when maxPrice is unset — the server refuses that price — and no per-tier feature
 * claims the service does not actually configure.
 */
function packagesFromApi(api: BackendService): Service["packages"] {
  const base = api.basePrice ?? api.minPrice ?? 0;
  const min = api.minPrice ?? base;
  const max = api.maxPrice ?? Math.max(base, min);
  return tierOptions({ base, min, max }).map((t) => ({
    name: t.name,
    tag: t.tag,
    price: t.price,
    popular: t.price === base,
    items: [],
    tierIndex: t.index,
  }));
}

function toUiService(api: BackendService, fallbackIndex = 0): Service {
  const fallback = SERVICES.length ? SERVICES[fallbackIndex % SERVICES.length]! : FALLBACK_SERVICE;
  const priceFrom = api.basePrice ?? api.minPrice ?? fallback.priceFrom;
  return {
    ...fallback,
    id: api.id,
    slug: api.slug,
    name: api.name || fallback.name,
    title: api.name || fallback.title,
    tagline: api.description || fallback.tagline,
    priceFrom,
    price: `₹${priceFrom}`,
    packages: packagesFromApi(api),
    rating: api.rating != null && api.rating > 0 && (api.reviewCount ?? 0) > 0 ? String(api.rating) : "New",
    reviews: (api.reviewCount ?? 0) > 0 ? `${api.reviewCount}` : "0",
    featured: api.isFeatured ?? fallback.featured,
    img: api.thumbnail ?? api.icon ?? fallback.img,
  };
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
  const { data: addressesData, isLoading: addressesLoading } = useAddressesQuery();
  const { payForBooking } = useBookingPayment();
  const services: Service[] = useMemo(() => {
    const incoming = servicesData?.services ?? [];
    if (!incoming.length) return SERVICES.length ? SERVICES : [FALLBACK_SERVICE];
    return incoming.map((service, index) => toUiService(service, index));
  }, [servicesData]);

  const parsed = parseBookParams(searchParams);
  const initialService = parsed.serviceId
    ? Math.max(
        0,
        services.findIndex((s) => s.id === parsed.serviceId || s.slug === parsed.serviceId),
      )
    : 0;
  const initialPkg = packagePositionForTier(services[initialService] ?? services[0]!, parsed.packageIndex);

  const [service, setService] = useState(initialService);
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
      setPkg(packagePositionForTier(services[idx] ?? services[0]!, parsed.packageIndex));
    }
    if (parsed.query) setSearchQuery(parsed.query);
    if (parsed.addons.length) {
      const raw = servicesData?.services?.find((s) => s.id === sid || s.slug === sid);
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
    setService(idx);
    setPkg(popularPackageIndex(services[idx] ?? services[0]!));
    setAddons(new Set());
    setSelection(null);
    showToast(`${(services[idx] ?? services[0]!).title} selected`, "info");
    router.replace(
      bookUrl({ service: serviceId, q: q || undefined }),
      { scroll: false },
    );
  };

  const currentStep = useMemo(() => {
    if (bookingDone) return 3;
    if (pkg >= 0) return 2;
    return 0;
  }, [bookingDone, pkg]);

  const selectService = (i: number) => {
    setService(i);
    setPkg(popularPackageIndex(services[i] ?? services[0]!));
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
  const toggleAddon = (id: string) =>
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scrollTo = (el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const selected = svc.packages[pkg] ?? svc.packages[0];
  const addonIds = Array.from(addons);
  const rawService = servicesData?.services?.find((s) => s.id === svc.id);
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
    : { packagePrice: selected.price };
  /**
   * Which times the SERVER will accept for the chosen day. The booking step used to offer six
   * hardcoded times nobody had agreed to; this asks.
   */
  const availabilityQuery = useAvailabilityQuery({
    serviceId: svc?.id,
    date: toYmdLocal(scheduledAt),
    addressId: effectiveAddressId,
  });

  const priceQuoteQuery = useBookingPriceQuoteQuery(
    // Wait for addresses: the quote is priced at the selected address (surge), and a first quote
    // without it would show a total that silently changes a moment later.
    svc.id && svc.id !== "service-unavailable" && !servicesLoading && !addressesLoading
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

  async function resolveAddressId(): Promise<string | null> {
    if (effectiveAddressId) return effectiveAddressId;
    showToast("Add your service address to continue", "error");
    setAddAddressOpen(true);
    return null;
  }

  async function confirmBooking() {
    if (confirming) return;
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
    if (offered.length > 0 && !offered.some((s) => s.available && new Date(s.start).getTime() === scheduledAt.getTime())) {
      setSlotChosen(false);
      showToast("That time isn't available. Pick another slot.", "error");
      scrollTo(dateRef.current);
      return;
    }
    setConfirming(true);
    try {
      const addressId = await resolveAddressId();
      if (!addressId) {
        setConfirming(false);
        return;
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
        ...(mustConfirm.length ? { requirementAttestations: mustConfirm.filter((r) => attested.has(r.code)).map((r) => r.code) } : {}),
      });
      if (!created.booking?.id) {
        showToast("Booking could not be confirmed", "error");
        return;
      }
      const booking: SavedBooking = {
        ...mapBackendBookingToSaved(created.booking),
        serviceId: svc.id,
        serviceTitle: svc.title,
        serviceName: svc.name,
        packageName: selected.name,
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
          setBookingDone(booking);
          showToast("Payment verified — we're finding your pro", "success");
        },
      });
    } catch (err) {
      // The mutation toasts the server's message. A price change or an expired quote also means
      // the total on screen is stale: reload the server quote so the customer re-confirms the real one.
      const code = (err as { code?: string } | null)?.code;
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

  function applyAiRecommendation() {
    const rec = popularPackageIndex(svc);
    setPkg(rec);
    showToast("Standard package applied — best for 2BHK", "success");
    scrollTo(dateRef.current);
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
          {searchQuery.trim() && filteredServices.length === 0 ? (
            <p className="col-span-full rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-sm text-muted">
              No services match &ldquo;{searchQuery.trim()}&rdquo;. Try
              cleaning, AC, plumbing, or electrical.
            </p>
          ) : null}
          {(servicesLoading || servicesError ? [] : filteredServices).map(({ s, i }) => {
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
                    Featured
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
                  From {s.price}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* ---------- Two-column layout ---------- */}
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
                  <span className="inline-block rounded-full bg-success-strong px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg sm:px-4 sm:py-1.5 sm:text-xs">
                    Best Seller
                  </span>
                  <h2
                    className={cn(bookHeroTitle, "mt-3 sm:mt-4")}
                    style={{ fontSize: "clamp(1.75rem, 6vw, 3.75rem)" }}
                  >
                    {svc.title}
                  </h2>
                  <p className="mt-2 text-sm text-white/75 sm:mt-3 sm:text-base lg:text-lg">
                    {svc.tagline}
                  </p>
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

            {/* Package picker */}
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3">
                <h3 className={bookSectionTitle}>{effectiveSelection ? "Your Selection" : "Choose Your Package"}</h3>
                <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-bold text-success sm:px-3 sm:py-1 sm:text-xs">
                  Save More
                </span>
              </div>
              {effectiveSelection ? (
                <SelectionSummary
                  selection={sel}
                  loading={priceQuoteQuery.isFetching && !sel}
                  error={quoteError}
                  onChange={() => router.back()}
                />
              ) : (
              <div className={bookPackageGrid}>
                {svc.packages.map((p, i) => {
                  const active = i === pkg;
                  return (
                    <motion.button
                      key={p.name}
                      type="button"
                      onClick={() => setPkg(i)}
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
                      {p.popular && (
                        <span className="absolute right-3 top-3 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg sm:right-4 sm:top-4 sm:px-3 sm:py-1 sm:text-[10px]">
                          Most Popular
                        </span>
                      )}
                      <span className="relative font-display text-lg font-bold text-content sm:text-xl">
                        {p.name}
                      </span>
                      <span className="relative text-xs text-muted sm:text-sm">
                        {p.tag}
                      </span>
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
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px] text-muted sm:flex sm:items-center sm:justify-around sm:text-xs">
                  <span>
                    <span className="block text-sm font-bold text-content">
                      50,000+
                    </span>
                    Happy Customers
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-content">
                      4.9 ★
                    </span>
                    Average Rating
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-content">
                      12K+
                    </span>
                    Bookings Today
                  </span>
                </div>
              </SectionCard>
            </div>
          </div>

          {/* ================= RIGHT (sidebar) ================= */}
          <div className="flex min-w-0 flex-col gap-6 sm:gap-8 lg:sticky lg:top-28 lg:self-start">
            {/* AI recommendation */}
            <div className="relative overflow-hidden rounded-[20px] p-5 ring-1 ring-emerald-500/25 shadow-[0_20px_48px_-16px_rgb(16_185_129/0.3)] sm:rounded-[28px] sm:p-7"
              style={{
                background:
                  "linear-gradient(135deg, rgb(16 185 129 / 0.14) 0%, rgb(20 184 166 / 0.1) 100%)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] opacity-20 blur-3xl"
              />
              <div className="relative flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_14px_34px_-10px_rgb(16_185_129/0.55)]">
                  <Sparkles size={18} />
                </span>
                <span className="font-display text-lg font-bold text-content sm:text-xl">
                  AI Recommendation
                </span>
              </div>
              <p className="relative mt-2 text-xs text-muted sm:mt-3 sm:text-sm">
                Based on your home size (2BHK) and cleaning needs
              </p>
              <div className="relative mt-4 rounded-2xl glass-card p-4">
                <p className="text-sm text-muted">We recommend</p>
                <p className="font-display text-xl font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                  Standard Package
                </p>
              </div>
              <p className="relative mt-5 text-sm font-bold text-content">
                Why?
              </p>
              <ul className="relative mt-2 flex flex-col gap-2.5">
                {[
                  "Perfect for 2BHK homes",
                  "Most booked in your area",
                  "Best value for deep cleaning",
                ].map((w) => (
                  <li
                    key={w}
                    className="flex items-center gap-2 text-sm text-content"
                  >
                    <Check size={15} className="text-success" strokeWidth={3} />
                    {w}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={applyAiRecommendation}
                className="relative mt-6 w-full rounded-2xl glass-card py-3 text-sm font-bold text-content transition hover:-translate-y-0.5"
              >
                Looks good 👍
              </button>
            </div>

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
                  <span className="block text-xs text-muted">
                    {selected.name} Package
                  </span>
                </span>
                <span className="font-display font-bold text-content">
                  ₹{selected.price}
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
                <Row label={sel ? "Service + add-ons" : "Package + add-ons"} value={subtotal != null ? `₹${subtotal}` : "—"} />
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
                    Your data is 100% protected
                  </span>
                </span>
              </div>

              <motion.button
                type="button"
                disabled={confirming}
                onClick={confirmBooking}
                whileHover={{ y: confirming ? 0 : -3 }}
                whileTap={{ scale: confirming ? 1 : 0.98 }}
                className="mt-5 hidden h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-base font-bold text-white shadow-[0_18px_40px_-10px_rgb(16_185_129/0.55)] disabled:opacity-70 lg:flex"
              >
                <Lock size={18} />
                {confirming ? "Securing your slot…" : slotChosen ? "Confirm Booking Securely" : "Choose a time slot"}
                <ArrowRight size={18} />
              </motion.button>
              <p className="mt-2 hidden text-center text-xs text-muted lg:block">
                Payment is taken when you confirm
              </p>
            </SectionCard>
          </div>
        </div>

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

      <BookStickyCheckout
        total={total}
        confirming={confirming}
        slotChosen={slotChosen}
        onConfirm={confirmBooking}
      />

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

/** Add-ons offered for a service: its configured catalogue, else the shared one. */
function addonCatalogFor(raw: BackendService | undefined): { id: string; name: string; desc: string; price: number }[] {
  const own = raw?.catalogConfig?.addons;
  if (own) return own.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, desc: "", price: a.price }));
  return ADDONS.map((a) => ({ ...a }));
}

/** The server-priced selection carried from the service page (variant, quantity, audience). */
function SelectionSummary({
  selection,
  loading,
  error,
  onChange,
}: {
  selection: ServiceSelectionSnapshot | undefined;
  loading: boolean;
  error: string | null;
  onChange: () => void;
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
      <button type="button" onClick={onChange} className="mt-4 text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-300">
        Change selection
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


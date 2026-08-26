"use client";

import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { m as motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Star,
  ShieldCheck,
  Leaf,
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
import { buildAddressCreatePayload } from "@/lib/addresses";
import {
  SERVICES,
  popularPackageIndex,
  getLocation,
  type Service,
} from "@/lib/services";
import { bookUrl, parseBookParams } from "@/lib/booking-url";
import { SERVICE_IMAGES, type SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  mapBackendBookingToSaved,
  useAddressesQuery,
  useBookingPriceQuoteQuery,
  useCreateAddressMutation,
  useCreateBookingMutation,
  useServicesQuery,
} from "@/hooks/use-core-data";
import { useBookingPayment } from "@/hooks/use-booking-payment";
import {
  defaultScheduledSlot,
  formatDateLabel,
  formatTimeLabel,
} from "@/lib/booking-datetime";
import type { BackendService } from "@/types/backend";

/* ----------------------------- data ----------------------------- */

const HERO_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: Leaf, label: "Eco Friendly\nProducts" },
  { icon: BadgeCheck, label: "Satisfaction\nGuarantee" },
  { icon: Clock, label: "On-time\nService" },
];

const ADDONS = [
  { id: "fridge", name: "Fridge Cleaning", desc: "Deep cleaning & sanitization", price: 99 },
  { id: "sofa", name: "Sofa Cleaning", desc: "Vacuum & stain removal", price: 149 },
  { id: "microwave", name: "Microwave Cleaning", desc: "Interior cleaning", price: 79 },
] as const;

const TRUST = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: UserCheck, label: "Background\nChecked" },
  { icon: Clock, label: "On-time\nGuarantee" },
  { icon: BadgeCheck, label: "Satisfaction\nGuarantee" },
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

function packagesFromApi(api: BackendService): Service["packages"] {
  const base = api.basePrice ?? api.minPrice ?? 199;
  const min = api.minPrice ?? base;
  const max = api.maxPrice ?? Math.round(base * 1.35);
  const mid = base;
  return [
    {
      name: "Basic",
      tag: "Essentials",
      price: min,
      items: ["Core service scope", "Standard products"],
    },
    {
      name: "Standard",
      tag: "Most popular",
      price: mid,
      popular: true,
      items: ["Extended coverage", "Premium products", "Quality check"],
    },
    {
      name: "Premium",
      tag: "Full service",
      price: max,
      items: ["Maximum coverage", "Deep treatment", "Priority support"],
    },
  ];
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
    rating: String(api.rating ?? fallback.rating),
    reviews: api.reviewCount ? `${api.reviewCount}` : fallback.reviews,
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
  const createAddressMutation = useCreateAddressMutation();
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
  const initialPkg =
    parsed.packageIndex ?? popularPackageIndex(services[initialService] ?? services[0]!);

  const [service, setService] = useState(initialService);
  const [pkg, setPkg] = useState(initialPkg);
  const [searchQuery, setSearchQuery] = useState(parsed.query);
  const [scheduledAt, setScheduledAt] = useState(() => defaultScheduledSlot());
  const [addons, setAddons] = useState<Set<string>>(new Set());
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [instructions, setInstructions] = useState("");
  const [address, setAddress] = useState({
    line1: "",
    line2: "",
  });

  useEffect(() => {
    const list = addressesData?.addresses ?? [];
    const def = list.find((a) => a.isDefault) ?? list[0];
    if (def) {
      setAddress({
        line1: def.line1 ?? "",
        line2: [def.line2, def.city, def.pincode].filter(Boolean).join(", "),
      });
      return;
    }
    const l = getLocation(locationId);
    setAddress({ line1: l.label, line2: `${l.city}, ${l.pin}` });
  }, [addressesData?.addresses, locationId]);
  const [editingAddr, setEditingAddr] = useState(false);
  const [bookingDone, setBookingDone] = useState<SavedBooking | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dateRef = useRef<HTMLDivElement>(null);
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
      setPkg(parsed.packageIndex ?? popularPackageIndex(services[idx] ?? services[0]!));
    }
    if (parsed.query) setSearchQuery(parsed.query);
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
    showToast(`${(services[i] ?? services[0]!).title} selected`, "info");
  };

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
  const priceQuoteQuery = useBookingPriceQuoteQuery(
    svc.id && svc.id !== "service-unavailable" && !servicesLoading
      ? {
          serviceId: svc.id,
          packagePrice: selected.price,
          addonIds,
          couponCode: appliedCoupon || undefined,
        }
      : null,
  );
  const quote = priceQuoteQuery.data?.quote;
  const subtotal = quote?.baseAmount ?? selected.price;
  const taxes = quote?.taxes ?? Math.round(subtotal * 0.1);
  const discount = quote?.discount ?? 0;
  const total = quote?.finalAmount ?? subtotal + taxes;
  const couponError = quote?.couponError;

  async function resolveAddressId(): Promise<string | null> {
    const list = addressesData?.addresses ?? [];
    const def = list.find((a) => a.isDefault) ?? list[0];
    if (def?.id) return def.id;
    if (!address.line1.trim()) {
      showToast("Please add an address to continue", "error");
      return null;
    }
    try {
      const loc = getLocation(locationId);
      const created = await createAddressMutation.mutateAsync(
        buildAddressCreatePayload({
          line1: address.line1,
          line2: address.line2,
          latitude: loc.latitude,
          longitude: loc.longitude,
        }),
      );
      return created.address?.id ?? null;
    } catch {
      return null;
    }
  }

  async function confirmBooking() {
    if (confirming) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("You are offline. Reconnect and try again.", "error");
      return;
    }
    if (addressesLoading) {
      showToast("Loading your addresses…", "info");
      return;
    }
    setConfirming(true);
    try {
      const addressId = await resolveAddressId();
      if (!addressId) {
        setConfirming(false);
        return;
      }
      const created = await createBookingMutation.mutateAsync({
        serviceId: svc.id,
        scheduledDate: scheduledAt.toISOString(),
        addressId,
        description: instructions.trim() || undefined,
        paymentMethod: "razorpay",
        packagePrice: selected.price,
        addonIds,
        couponCode: appliedCoupon || undefined,
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
        address: `${address.line1}, ${address.line2}`,
        imagePath: SERVICE_IMAGES[svc.id] ?? svc.img,
        serviceColor: svc.color,
        instructions: instructions.trim() || undefined,
      };
      addBooking(booking);
      setBookingDone(booking);
      await payForBooking({
        bookingId: created.booking.id,
        description: `${svc.title} booking payment`,
        onVerified: () => {
          showToast("Payment completed and verified", "success");
        },
      });
      showToast("Booking confirmed securely", "success");
    } catch {
      // mutation handles user-facing error toast
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
                  <span className="inline-block rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider shadow-lg sm:px-4 sm:py-1.5 sm:text-xs">
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
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Star size={18} className="fill-gold text-gold" />
                      {svc.rating}
                      <span className="font-normal text-white/60">
                        ({svc.reviews} reviews)
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-white/75">
                      <span className="flex -space-x-2">
                        {[0, 1, 2].map((a) => (
                          <span
                            key={a}
                            className="size-6 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#14b8a6_100%)] ring-2 ring-emerald-900"
                          />
                        ))}
                      </span>
                      {svc.homes}
                    </span>
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
                <h3 className={bookSectionTitle}>Choose Your Package</h3>
                <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-bold text-success sm:px-3 sm:py-1 sm:text-xs">
                  Save More
                </span>
              </div>
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
            </div>

            {/* Date & time */}
            <div ref={dateRef} className="scroll-mt-28">
            <SectionCard>
              <BookingScheduleSection
                scheduledAt={scheduledAt}
                onScheduledAtChange={setScheduledAt}
                onInvalid={(msg) => showToast(msg, "error")}
                step={3}
              />
            </SectionCard>
            </div>

            {/* Phase 16 — live pros near you (reuses the certified matching engine). */}
            {svc.id && svc.id !== "service-unavailable" && (
              <SectionCard>
                <h3 className="mb-3 font-display text-lg font-bold text-content">Pros near you</h3>
                <ProviderETA
                  serviceId={svc.id}
                  latitude={getLocation(locationId).latitude}
                  longitude={getLocation(locationId).longitude}
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
                  {ADDONS.map((a) => {
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
                <h3 className="mb-4 font-display text-lg font-bold text-content">
                  Special Instructions
                </h3>
                <Textarea
                  ref={instrRef}
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
                    onClick={() => setEditingAddr((v) => !v)}
                    className="text-xs font-bold text-emerald-600 hover:underline"
                  >
                    {editingAddr ? "Save" : "Edit"}
                  </button>
                </div>
                {editingAddr ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <Input
                      size="sm"
                      value={address.line1}
                      onChange={(e) =>
                        setAddress((a) => ({ ...a, line1: e.target.value }))
                      }
                      placeholder="Address line 1"
                      showClear={false}
                      containerClassName="rounded-xl bg-surface/60"
                      inputClassName="text-xs"
                    />
                    <Input
                      size="sm"
                      value={address.line2}
                      onChange={(e) =>
                        setAddress((a) => ({ ...a, line2: e.target.value }))
                      }
                      placeholder="City, PIN"
                      showClear={false}
                      containerClassName="rounded-xl bg-surface/60"
                      inputClassName="text-xs"
                    />
                  </div>
                ) : (
                  <span className="mt-1 block whitespace-pre-line text-xs text-muted">
                    {`${address.line1}\n${address.line2}`}
                  </span>
                )}
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
                <Row label="Package + add-ons" value={`₹${subtotal}`} />
                {discount > 0 ? (
                  <Row label="Discounts" value={`-₹${discount}`} />
                ) : null}
                <Row label="Taxes (10%)" value={`₹${taxes}`} />
                {priceQuoteQuery.isFetching ? (
                  <p className="text-xs text-muted">Updating price…</p>
                ) : null}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-5">
                <span className="font-display text-lg font-bold text-content">
                  Total Payable
                </span>
                <span
                  className="font-display font-bold bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent"
                  style={{ fontSize: "clamp(1.5rem, 5vw, 1.875rem)" }}
                >
                  ₹{total}
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
                {confirming ? "Securing your slot…" : "Confirm Booking Securely"}
                <ArrowRight size={18} />
              </motion.button>
              <p className="mt-2 hidden text-center text-xs text-muted lg:block">
                You won&apos;t be charged yet
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
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <span className="text-center text-xs font-semibold text-content sm:text-left sm:text-sm">
              Trusted by 50,000+ families
            </span>
            <span className="flex -space-x-2">
              {[0, 1, 2, 3, 4].map((a) => (
                <span
                  key={a}
                  className="size-7 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#14b8a6_100%)] ring-2 ring-surface"
                />
              ))}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] px-3 py-1 text-sm font-bold text-white">
              4.9 <Star size={13} className="fill-white" />
            </span>
          </div>
        </div>
      </main>

      <BookStickyCheckout
        total={total}
        confirming={confirming}
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

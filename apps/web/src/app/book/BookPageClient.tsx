"use client";

import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
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
import { AuroraBackground } from "@/components/AuroraBackground";
import { ServiceSearchInput } from "@/components/ServiceSearchInput";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { LocationButton } from "@/components/LocationButton";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { MotionImage } from "@/components/ui/MotionImage";
import { BookingSuccessModal } from "@/components/overlays/BookingSuccessModal";
import { BookingScheduleSection } from "@/components/booking/BookingScheduleSection";
import { BookPageHeader } from "@/components/booking/BookPageHeader";
import { BookStickyCheckout } from "@/components/booking/BookStickyCheckout";
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
  popularPackageIndex,
  getServiceIndex,
  searchServices,
  getLocation,
} from "@/lib/services";
import {
  bookUrl,
  parseBookParams,
  generateBookingId,
} from "@/lib/booking-url";
import {
  createInitialTimeline,
  SERVICE_IMAGES,
  type SavedBooking,
} from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  defaultScheduledSlot,
  formatDateLabel,
  formatTimeLabel,
} from "@/lib/booking-datetime";

/* ----------------------------- data ----------------------------- */

const HERO_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: Leaf, label: "Eco Friendly\nProducts" },
  { icon: BadgeCheck, label: "Satisfaction\nGuarantee" },
  { icon: Clock, label: "On-time\nService" },
];

const ADDONS = [
  { name: "Fridge Cleaning", desc: "Deep cleaning & sanitization", price: 99 },
  { name: "Sofa Cleaning", desc: "Vacuum & stain removal", price: 149 },
  { name: "Microwave Cleaning", desc: "Interior cleaning", price: 79 },
];

const TRUST = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: UserCheck, label: "Background\nChecked" },
  { icon: Clock, label: "On-time\nGuarantee" },
  { icon: BadgeCheck, label: "Satisfaction\nGuarantee" },
  { icon: CreditCard, label: "Secure\nPayments" },
];

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
      <AuroraBackground />
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
  const activePromo = useAppStore((s) => s.activePromo);
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const addBooking = useAppStore((s) => s.addBooking);

  const parsed = parseBookParams(searchParams);
  const initialService = parsed.serviceId
    ? getServiceIndex(parsed.serviceId)
    : 0;
  const initialPkg =
    parsed.packageIndex ?? popularPackageIndex(SERVICES[initialService]);

  const [service, setService] = useState(initialService);
  const [pkg, setPkg] = useState(initialPkg);
  const [searchQuery, setSearchQuery] = useState(parsed.query);
  const [scheduledAt, setScheduledAt] = useState(() => defaultScheduledSlot());
  const [addons, setAddons] = useState<Set<number>>(new Set());
  const [instructions, setInstructions] = useState("");
  const [address, setAddress] = useState({
    line1: "",
    line2: "",
  });

  useEffect(() => {
    const l = getLocation(locationId);
    setAddress({ line1: l.label, line2: `${l.city}, ${l.pin}` });
  }, [locationId]);
  const [editingAddr, setEditingAddr] = useState(false);
  const [bookingDone, setBookingDone] = useState<SavedBooking | null>(null);
  const [confirming, setConfirming] = useState(false);

  const dateRef = useRef<HTMLDivElement>(null);
  const instrRef = useRef<HTMLTextAreaElement>(null);

  const svc = SERVICES[service];
  const SvcIcon = svc.icon;

  useEffect(() => {
    const sid = parsed.serviceId;
    if (sid) {
      const idx = getServiceIndex(sid);
      setService(idx);
      setPkg(parsed.packageIndex ?? popularPackageIndex(SERVICES[idx]));
    }
    if (parsed.query) setSearchQuery(parsed.query);
    if (parsed.promo) {
      useAppStore.getState().setActivePromo(parsed.promo);
      showToast(`Promo ${parsed.promo} applied`, "success");
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return SERVICES.map((s, i) => ({ s, i }));
    return searchServices(searchQuery)
      .map((s) => ({
        s,
        i: SERVICES.findIndex((x) => x.id === s.id),
      }))
      .filter(({ i }) => i >= 0);
  }, [searchQuery]);

  const handleSearchSelect = (serviceId: string, q: string) => {
    const idx = getServiceIndex(serviceId);
    setSearchQuery(q);
    setService(idx);
    setPkg(popularPackageIndex(SERVICES[idx]));
    setAddons(new Set());
    showToast(`${SERVICES[idx].title} selected`, "info");
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
    setPkg(popularPackageIndex(SERVICES[i]));
    setAddons(new Set());
    showToast(`${SERVICES[i].title} selected`, "info");
  };

  const toggleAddon = (i: number) =>
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const scrollTo = (el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const selected = svc.packages[pkg] ?? svc.packages[0];
  const addonTotal = useMemo(
    () => [...addons].reduce((s, i) => s + ADDONS[i].price, 0),
    [addons],
  );
  const promoDiscount =
    activePromo === "COOL100"
      ? 100
      : activePromo === "FIX150"
        ? 150
        : activePromo === "FRESH25"
          ? Math.round(selected.price * 0.25)
          : 0;

  const subtotal = selected.price + addonTotal;
  const platformFee = 20;
  const gst = +(
    (Math.max(0, subtotal - promoDiscount) + platformFee) *
    0.18
  ).toFixed(2);
  const total = +(
    Math.max(0, subtotal - promoDiscount) +
    platformFee +
    gst
  ).toFixed(2);
  const saved = promoDiscount + 120;

  async function confirmBooking() {
    if (confirming) return;
    setConfirming(true);
    await new Promise((r) => setTimeout(r, 800));
    const now = new Date().toISOString();
    const pros = ["Rajesh Kumar", "Amit Sharma", "Priya Singh", "Vikram Patel"];
    const booking: SavedBooking = {
      id: generateBookingId(),
      serviceId: svc.id,
      serviceTitle: svc.title,
      serviceName: svc.name,
      packageName: selected.name,
      dateLabel: `${formatDateLabel(scheduledAt)}, ${scheduledAt.getFullYear()}`,
      timeLabel: formatTimeLabel(scheduledAt),
      address: `${address.line1}, ${address.line2}`,
      total,
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
      imagePath: SERVICE_IMAGES[svc.id] ?? svc.img,
      serviceColor: svc.color,
      proName: pros[Math.floor(Math.random() * pros.length)]!,
      instructions: instructions.trim() || undefined,
      timeline: createInitialTimeline(now),
    };
    addBooking(booking);
    setBookingDone(booking);
    setConfirming(false);
    showToast("Booking confirmed securely", "success");
  }

  function applyAiRecommendation() {
    const rec = popularPackageIndex(svc);
    setPkg(rec);
    showToast("Standard package applied — best for 2BHK", "success");
    scrollTo(dateRef.current);
  }

  return (
    <div className={bookPageRoot}>
      <AuroraBackground />

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
          {searchQuery.trim() && filteredServices.length === 0 ? (
            <p className="col-span-full rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-8 text-center text-sm text-muted">
              No services match &ldquo;{searchQuery.trim()}&rdquo;. Try
              cleaning, AC, plumbing, or electrical.
            </p>
          ) : null}
          {filteredServices.map(({ s, i }) => {
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
                    ? "bg-premium text-white shadow-glow-violet"
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
                  style={{ background: active ? "#a855f7" : s.color }}
                />
                {active && (
                  <span className="absolute right-2 top-2 z-10 rounded-full bg-white/95 px-2 py-0.5 text-[9px] font-bold text-violet shadow-e2 backdrop-blur sm:right-3 sm:top-3 sm:px-3 sm:py-1 sm:text-[11px]">
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
              className="relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_32px_80px_-20px_rgb(76_29_149/0.6)] ring-1 ring-white/15 sm:rounded-[32px] sm:p-8 lg:rounded-[36px] lg:p-12"
              style={{
                background:
                  "linear-gradient(135deg, #1E1B4B 0%, #312E81 55%, #4C1D95 100%)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/12 to-transparent"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-cyan/20 blur-3xl"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-24 right-1/3 size-72 rounded-full bg-pink/15 blur-3xl"
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
                      className="drop-shadow-[0_28px_52px_rgb(124_58_237/0.55)]"
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
                  <span className="inline-block rounded-full bg-violet px-3 py-1 text-[10px] font-bold uppercase tracking-wider shadow-lg sm:px-4 sm:py-1.5 sm:text-xs">
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
                            className="size-6 rounded-full bg-aurora ring-2 ring-[#312E81]"
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
                      <Icon size={18} className="text-cyan sm:size-5" />
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
                          ? "glass-card ring-2 ring-primary shadow-[0_24px_56px_-12px_rgb(37_99_235/0.4)]"
                          : "glass-card hover:shadow-[0_24px_56px_-16px_rgb(15_23_42/0.28)]",
                      )}
                    >
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 h-20 sheen"
                      />
                      {p.popular && (
                        <span className="absolute right-3 top-3 rounded-full bg-premium px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg sm:right-4 sm:top-4 sm:px-3 sm:py-1 sm:text-[10px]">
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
                            ? "bg-aurora text-white shadow-glow-blue"
                            : "border border-primary/40 text-primary group-hover:bg-primary/5",
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
                  {ADDONS.map((a, i) => {
                    const on = addons.has(i);
                    return (
                      <button
                        key={a.name}
                        type="button"
                        onClick={() => toggleAddon(i)}
                        className="flex items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-primary/5"
                      >
                        <span
                          className={cn(
                            "grid size-6 shrink-0 place-items-center rounded-md border-2 transition",
                            on
                              ? "border-primary bg-primary text-white"
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
                        <span className="text-sm font-bold text-primary">
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
            <div className="relative overflow-hidden rounded-[20px] p-5 ring-1 ring-violet/25 shadow-[0_20px_48px_-16px_rgb(124_58_237/0.35)] sm:rounded-[28px] sm:p-7"
              style={{
                background:
                  "linear-gradient(135deg, rgb(124 58 237 / 0.14) 0%, rgb(236 72 153 / 0.1) 100%)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-premium opacity-20 blur-3xl"
              />
              <div className="relative flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-xl bg-premium text-white shadow-glow-violet">
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
                <p className="font-display text-xl font-bold text-aurora">
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
                  className="text-xs font-bold text-primary hover:underline"
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
                    className="text-xs font-bold text-primary hover:underline"
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
                  className="shrink-0 text-xs font-bold text-primary hover:underline"
                >
                  Edit
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <Row label="Package Price" value={`₹${subtotal}.00`} />
                {promoDiscount > 0 && (
                  <Row
                    label={`Promo (${activePromo})`}
                    value={`- ₹${promoDiscount}`}
                    className="text-success"
                  />
                )}
                <Row label="Platform Fee" value={`₹${platformFee}.00`} />
                <Row label="GST (18%)" value={`₹${gst}`} />
                <Row
                  label="You Saved"
                  value={`- ₹${saved}.00`}
                  className="text-success"
                />
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-line pt-5">
                <span className="font-display text-lg font-bold text-content">
                  Total Payable
                </span>
                <span
                  className="font-display font-bold text-aurora"
                  style={{ fontSize: "clamp(1.5rem, 5vw, 1.875rem)" }}
                >
                  ₹{total}
                </span>
              </div>

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
                className="mt-5 hidden h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-premium text-base font-bold text-white shadow-[0_18px_40px_-10px_rgb(124_58_237/0.55)] disabled:opacity-70 lg:flex"
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
                  <Icon size={22} className="text-primary" />
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
                  className="size-7 rounded-full bg-aurora ring-2 ring-surface"
                />
              ))}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-premium px-3 py-1 text-sm font-bold text-white">
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

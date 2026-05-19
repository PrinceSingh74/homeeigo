"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Search,
  MapPin,
  ChevronDown,
  Check,
  Star,
  ShieldCheck,
  Leaf,
  BadgeCheck,
  Clock,
  Sparkles,
  Lock,
  Flame,
  Scissors,
  LayoutGrid,
  UserCheck,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AuroraBackground } from "@/components/AuroraBackground";
import { ThemeToggle } from "@/components/ThemeToggle";

/* ----------------------------- data ----------------------------- */

const STEPS = ["Service", "Package", "Schedule", "Payment"];

const SERVICES = [
  { img: "/svc-cleaning.png", name: "Cleaning", price: "₹199" },
  { img: "/svc-ac.png", name: "AC Service", price: "₹299" },
  { img: "/svc-plumbing.png", name: "Plumbing", price: "₹249" },
  { img: "/svc-electrician.png", name: "Electrician", price: "₹199" },
  { img: "/svc-pest.png", name: "Pest Control", price: "₹299" },
  { icon: Scissors, name: "Salon", price: "₹199" },
];

const HERO_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "Verified\nProfessionals" },
  { icon: Leaf, label: "Eco Friendly\nProducts" },
  { icon: BadgeCheck, label: "Satisfaction\nGuarantee" },
  { icon: Clock, label: "On-time\nService" },
];

const PACKAGES = [
  {
    name: "Basic",
    tag: "Essential Cleaning",
    price: 199,
    items: ["1 Bedroom", "1 Bathroom", "Kitchen Cleaning", "Floor Cleaning"],
  },
  {
    name: "Standard",
    tag: "Deep Cleaning",
    price: 299,
    popular: true,
    items: [
      "2 Bedroom",
      "2 Bathroom",
      "Kitchen Cleaning",
      "Dusting & Wiping",
      "Floor Cleaning",
    ],
  },
  {
    name: "Premium",
    tag: "Full Home Cleaning",
    price: 499,
    items: [
      "3 Bedroom",
      "3 Bathroom",
      "Kitchen Cleaning",
      "Deep Cleaning",
      "Balcony Cleaning",
      "Windows Cleaning",
    ],
  },
];

const DATES = [
  { d: "Today", n: "21 May" },
  { d: "Wed", n: "22 May" },
  { d: "Thu", n: "23 May" },
  { d: "Fri", n: "24 May" },
  { d: "Sat", n: "25 May" },
  { d: "Sun", n: "26 May" },
];

const TIMES = [
  "09:00 AM",
  "11:00 AM",
  "01:00 PM",
  "03:00 PM",
  "05:00 PM",
  "07:00 PM",
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
    <div
      className={cn(
        "relative overflow-hidden rounded-[28px] glass-card p-6 sm:p-7",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-16 sheen"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/* ----------------------------- page ----------------------------- */

export default function BookPage() {
  const [service, setService] = useState(0);
  const [pkg, setPkg] = useState(1);
  const [dateIdx, setDateIdx] = useState(1);
  const [timeIdx, setTimeIdx] = useState(1);
  const [addons, setAddons] = useState<Set<number>>(new Set());

  const toggleAddon = (i: number) =>
    setAddons((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const selected = PACKAGES[pkg];
  const addonTotal = useMemo(
    () => [...addons].reduce((s, i) => s + ADDONS[i].price, 0),
    [addons],
  );
  const subtotal = selected.price + addonTotal;
  const platformFee = 20;
  const gst = +((subtotal + platformFee) * 0.18).toFixed(2);
  const total = +(subtotal + platformFee + gst).toFixed(2);
  const saved = 120;

  return (
    <>
      <AuroraBackground />

      {/* ---------- Sticky header + stepper ---------- */}
      <header className="sticky top-0 z-50 glass dark:glass-dark border-b border-line">
        <div className="mx-auto flex max-w-content items-center gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/"
            aria-label="Back to home"
            className="grid size-11 shrink-0 place-items-center rounded-full glass-card text-content transition-transform hover:-translate-x-0.5"
          >
            <ArrowLeft size={20} />
          </Link>

          <h1 className="shrink-0 font-display text-2xl font-bold text-content sm:text-3xl">
            Book a <span className="text-aurora">Service</span>
          </h1>

          {/* stepper */}
          <div className="mx-auto hidden items-center lg:flex">
            {STEPS.map((s, i) => {
              const active = i === 0;
              const done = false;
              return (
                <div key={s} className="flex items-center">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-full text-sm font-bold transition",
                        active
                          ? "bg-aurora text-white shadow-glow-blue"
                          : "glass-card text-muted",
                      )}
                    >
                      {done ? <Check size={16} /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        active ? "text-primary" : "text-muted",
                      )}
                    >
                      {s}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span className="mx-3 mb-5 h-px w-14 border-t-2 border-dashed border-line" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0 sm:gap-3">
            <ThemeToggle />
            <button
              type="button"
              aria-label="Notifications"
              className="relative grid size-11 place-items-center rounded-full glass-card text-content"
            >
              <Bell size={20} />
              <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-pink text-[10px] font-bold text-white ring-2 ring-surface">
                3
              </span>
            </button>
            <span className="grid size-11 place-items-center rounded-full bg-premium text-sm font-bold text-white ring-2 ring-primary shadow-[0_0_12px_rgb(37_99_235/0.25)]">
              A
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-content px-5 pb-16 pt-7 sm:px-8">
        {/* ---------- Search + location ---------- */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex h-14 flex-1 items-center gap-3 rounded-2xl glass-card px-5">
            <Search size={20} className="text-muted" />
            <input
              placeholder="Search for a service…"
              aria-label="Search for a service"
              className="h-full w-full bg-transparent text-[15px] text-content outline-none placeholder:text-muted"
            />
          </div>
          <button
            type="button"
            className="flex h-14 items-center justify-center gap-2 rounded-2xl glass-card px-5 text-sm font-semibold text-content"
          >
            <MapPin size={18} className="text-primary" />
            Gurugram, Sector&nbsp;49
            <ChevronDown size={16} className="text-muted" />
          </button>
        </div>

        {/* ---------- Service strip ---------- */}
        <div className="mt-6 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SERVICES.map((s, i) => {
            const active = i === service;
            const Icon = s.icon;
            return (
              <button
                key={s.name}
                type="button"
                onClick={() => setService(i)}
                className={cn(
                  "group relative flex w-32 shrink-0 flex-col items-center gap-1.5 rounded-2xl p-4 transition",
                  active
                    ? "glass-card ring-2 ring-primary"
                    : "glass-card hover:-translate-y-0.5",
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-white">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <span className="grid size-20 place-items-center">
                  {s.img ? (
                    <img
                      src={s.img}
                      alt={s.name}
                      className="size-18 object-contain drop-shadow-[0_8px_16px_rgb(15_23_42/0.28)] transition-transform duration-500 group-hover:scale-[1.18]"
                    />
                  ) : Icon ? (
                    <Icon
                      size={40}
                      className="text-pink transition-transform duration-500 group-hover:scale-[1.18]"
                    />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-sm font-bold",
                    active ? "text-primary" : "text-content",
                  )}
                >
                  {s.name}
                </span>
                <span className="text-xs text-muted">From {s.price}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="flex w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl glass-card p-4 text-content"
          >
            <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <LayoutGrid size={24} />
            </span>
            <span className="text-sm font-bold">All Services</span>
          </button>
        </div>

        {/* ---------- Two-column layout ---------- */}
        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_22rem] xl:grid-cols-[1fr_24rem]">
          {/* ================= LEFT ================= */}
          <div className="flex flex-col gap-6">
            {/* Service hero */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="relative overflow-hidden rounded-[32px] p-8 text-white shadow-e5 ring-1 ring-white/10 sm:p-10"
              style={{
                background:
                  "linear-gradient(135deg, #1E1B4B 0%, #312E81 55%, #4C1D95 100%)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/10 to-transparent"
              />
              <div className="relative flex flex-col items-center gap-8 sm:flex-row">
                {/* 3D image + halo */}
                <div className="relative grid shrink-0 place-items-center">
                  <span className="absolute size-64 rounded-full halo opacity-55" />
                  <motion.img
                    src="/svc-cleaning.png"
                    alt="Home Cleaning"
                    animate={{ y: [0, -12, 0] }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    className="relative size-60 object-contain drop-shadow-[0_28px_52px_rgb(124_58_237/0.55)]"
                  />
                </div>

                <div className="flex-1 text-center sm:text-left">
                  <span className="inline-block rounded-full bg-violet px-3 py-1 text-xs font-bold">
                    Best Seller
                  </span>
                  <h2 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
                    Home Cleaning
                  </h2>
                  <p className="mt-2 text-white/75">
                    Professional home cleaning neat, clean &amp; hygienic.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-4 sm:justify-start">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Star size={18} className="fill-gold text-gold" />
                      4.8
                      <span className="font-normal text-white/60">
                        (12.5k reviews)
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
                      12K+ homes cleaned
                    </span>
                  </div>
                </div>
              </div>

              {/* feature chips */}
              <div className="relative mt-7 grid grid-cols-2 gap-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:grid-cols-4">
                {HERO_FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.label}
                      className="flex flex-col items-center gap-1.5 text-center"
                    >
                      <Icon size={20} className="text-cyan" />
                      <span className="whitespace-pre-line text-xs font-medium text-white/80">
                        {f.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>

            {/* Package picker */}
            <div>
              <div className="mb-5 flex items-center gap-3">
                <h3 className="font-display text-2xl font-bold text-content">
                  Choose Your Package
                </h3>
                <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-bold text-success">
                  Save More
                </span>
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                {PACKAGES.map((p, i) => {
                  const active = i === pkg;
                  return (
                    <motion.button
                      key={p.name}
                      type="button"
                      onClick={() => setPkg(i)}
                      whileHover={{ y: -6 }}
                      className={cn(
                        "relative flex flex-col overflow-hidden rounded-[24px] p-6 text-left transition",
                        active
                          ? "glass-card ring-2 ring-primary shadow-glow-blue"
                          : "glass-card",
                      )}
                    >
                      {p.popular && (
                        <span className="absolute right-4 top-4 rounded-full bg-premium px-3 py-1 text-[10px] font-bold text-white">
                          Most Popular
                        </span>
                      )}
                      <span className="font-display text-xl font-bold text-content">
                        {p.name}
                      </span>
                      <span className="text-sm text-muted">{p.tag}</span>
                      <span className="mt-3 font-display text-4xl font-bold text-content">
                        ₹{p.price}
                      </span>
                      <ul className="mt-4 flex flex-1 flex-col gap-2">
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
                          "mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition",
                          active
                            ? "bg-aurora text-white shadow-glow-blue"
                            : "border border-primary/40 text-primary",
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
            <SectionCard>
              <div className="mb-5 flex items-center gap-3">
                <h3 className="font-display text-2xl font-bold text-content">
                  Select Date &amp; Time
                </h3>
                <span className="flex items-center gap-1 rounded-full bg-warning/15 px-3 py-1 text-xs font-bold text-warning">
                  <Flame size={12} />
                  Filling Fast
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {DATES.map((d, i) => {
                  const active = i === dateIdx;
                  return (
                    <button
                      key={d.n}
                      type="button"
                      onClick={() => setDateIdx(i)}
                      className={cn(
                        "flex flex-col items-center rounded-2xl py-3 text-sm transition",
                        active
                          ? "bg-aurora text-white shadow-glow-blue"
                          : "glass-card text-content hover:-translate-y-0.5",
                      )}
                    >
                      <span className="font-bold">{d.d}</span>
                      <span
                        className={active ? "text-white/80" : "text-muted"}
                      >
                        {d.n}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
                {TIMES.map((t, i) => {
                  const active = i === timeIdx;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTimeIdx(i)}
                      className={cn(
                        "rounded-2xl py-3 text-sm font-semibold transition",
                        active
                          ? "bg-aurora text-white shadow-glow-blue"
                          : "glass-card text-content hover:-translate-y-0.5",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-success/10 px-4 py-3 ring-1 ring-success/20">
                <span className="flex items-center gap-2 text-sm font-medium text-success">
                  <Check size={16} strokeWidth={3} />
                  Great! You got the fastest available slot.
                </span>
                <span className="hidden items-center gap-2 text-xs font-semibold text-muted sm:flex">
                  <span className="flex -space-x-2">
                    {[0, 1, 2].map((a) => (
                      <span
                        key={a}
                        className="size-5 rounded-full bg-aurora ring-2 ring-surface"
                      />
                    ))}
                  </span>
                  Only 2 slots left
                </span>
              </div>
            </SectionCard>

            {/* Add-ons + instructions */}
            <div className="grid gap-6 lg:grid-cols-2">
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
                <textarea
                  maxLength={250}
                  placeholder="Any specific instructions for your professional…"
                  className="h-28 w-full resize-none rounded-2xl border border-line bg-surface/60 p-4 text-sm text-content outline-none placeholder:text-muted focus:border-primary/40"
                />
                <div className="mt-4 flex items-center justify-around text-center text-xs text-muted">
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
          <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            {/* AI recommendation */}
            <div className="relative overflow-hidden rounded-[28px] p-6 ring-1 ring-violet/20"
              style={{
                background:
                  "linear-gradient(135deg, rgb(124 58 237 / 0.12) 0%, rgb(236 72 153 / 0.08) 100%)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-premium text-white">
                  <Sparkles size={16} />
                </span>
                <span className="font-display text-lg font-bold text-content">
                  AI Recommendation
                </span>
              </div>
              <p className="mt-3 text-sm text-muted">
                Based on your home size (2BHK) and cleaning needs
              </p>
              <div className="mt-4 rounded-2xl glass-card p-4">
                <p className="text-sm text-muted">We recommend</p>
                <p className="font-display text-lg font-bold text-aurora">
                  Standard Package
                </p>
              </div>
              <p className="mt-4 text-sm font-bold text-content">Why?</p>
              <ul className="mt-2 flex flex-col gap-2">
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
                className="mt-5 w-full rounded-full glass-card py-2.5 text-sm font-bold text-content"
              >
                Looks good 👍
              </button>
            </div>

            {/* Booking summary */}
            <SectionCard className="p-6">
              <h3 className="font-display text-xl font-bold text-content">
                Booking Summary
              </h3>

              <div className="mt-4 flex items-center gap-3 rounded-2xl glass-card p-3">
                <img
                  src="/svc-cleaning.png"
                  alt="Home Cleaning"
                  className="size-16 object-contain drop-shadow-md"
                />
                <span className="flex-1">
                  <span className="block text-sm font-bold text-content">
                    Home Cleaning
                  </span>
                  <span className="block text-xs text-muted">
                    {selected.name} Package
                  </span>
                </span>
                <span className="font-display font-bold text-content">
                  ₹{selected.price}
                </span>
              </div>

              {[
                {
                  label: "Date & Time",
                  value: `${DATES[dateIdx].d}, ${DATES[dateIdx].n} 2024\n${TIMES[timeIdx]} – 01:00 PM`,
                },
                {
                  label: "Address",
                  value: "Gurugram, Sector 49\nHaryana, 122018",
                },
                { label: "Instructions", value: "None" },
              ].map((r) => (
                <div
                  key={r.label}
                  className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-4"
                >
                  <span>
                    <span className="block text-sm font-bold text-content">
                      {r.label}
                    </span>
                    <span className="block whitespace-pre-line text-xs text-muted">
                      {r.value}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-xs font-bold text-primary"
                  >
                    Edit
                  </button>
                </div>
              ))}

              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <Row label="Package Price" value={`₹${subtotal}.00`} />
                <Row label="Platform Fee" value={`₹${platformFee}.00`} />
                <Row label="GST (18%)" value={`₹${gst}`} />
                <Row
                  label="You Saved"
                  value={`- ₹${saved}.00`}
                  className="text-success"
                />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <span className="font-display text-lg font-bold text-content">
                  Total Payable
                </span>
                <span className="font-display text-2xl font-bold text-aurora">
                  ₹{total}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-success/10 px-4 py-3 text-xs ring-1 ring-success/20">
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
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-premium text-base font-bold text-white shadow-glow-violet"
              >
                <Lock size={18} />
                Confirm Booking Securely
                <ArrowRight size={18} />
              </motion.button>
              <p className="mt-2 text-center text-xs text-muted">
                You won&apos;t be charged yet
              </p>
            </SectionCard>
          </div>
        </div>

        {/* ---------- Trust bar ---------- */}
        <div className="mt-10 flex flex-col items-center justify-between gap-6 rounded-[28px] glass-card px-8 py-6 lg:flex-row">
          <div className="flex flex-wrap items-center justify-center gap-8">
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
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-content">
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
    </>
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

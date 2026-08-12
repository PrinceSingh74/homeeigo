"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, m as motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bike,
  Check,
  Gauge,
  Maximize2,
  MessageSquare,
  Navigation,
  Phone,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { LiveTrackingMapView } from "@/components/LiveTrackingMapView";
import type { LiveTelemetry, RouteInfo } from "@/components/tracking/LiveTrackingMap";
import { toJourneyStage, type JourneyStage } from "@/components/tracking/BookingJourney";
import { HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import { useBookingDetailQuery } from "@/hooks/use-core-data";
import { bookUrl } from "@/lib/booking-url";
import { pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

/** Real Uber-style map (Kalman GPS + bike marker + traffic route) — loaded only when live. */
const LiveTrackingMap = dynamic(
  () => import("@/components/tracking/LiveTrackingMap").then((m) => m.LiveTrackingMap),
  { ssr: false, loading: () => <div className="absolute inset-0 bg-slate-900" aria-hidden /> },
);

/** Compact journey rail for the home card (full 6-stage rail lives on /bookings). */
const STEPS: { key: JourneyStage; label: string }[] = [
  { key: "ASSIGNED", label: "Confirmed" },
  { key: "EN_ROUTE", label: "En route" },
  { key: "ARRIVED", label: "Arrived" },
  { key: "STARTED", label: "Started" },
  { key: "COMPLETED", label: "Done" },
];

const STAGE_ORDER: JourneyStage[] = [
  "SEARCHING",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "STARTED",
  "COMPLETED",
];

const TRAFFIC_LABEL: Record<RouteInfo["trafficLevel"], { text: string; cls: string }> = {
  light: { text: "Clear roads", cls: "text-emerald-600 dark:text-emerald-400" },
  moderate: { text: "Moderate traffic", cls: "text-amber-600 dark:text-amber-400" },
  heavy: { text: "Heavy traffic", cls: "text-red-600 dark:text-red-400" },
};

/** Degrees → 8-point compass label. */
function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((deg % 360) / 45) % 8]!;
}

/** "Arriving by 7:42 pm" — wall-clock arrival from the live traffic ETA. */
function arrivalClock(etaMin: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(
    new Date(Date.now() + etaMin * 60_000),
  );
}

/** Straight-line km between two points (route-visibility gate, not shown to the user). */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(s));
}

type TrackingShape = {
  eta?: number | null;
  distance?: number | null;
  status?: string | null;
  providerLatitude?: number | null;
  providerLongitude?: number | null;
  bearing?: number | null;
  speed?: number | null;
};

export function LiveTrackingSection() {
  const reduce = useReducedMotion() ?? false;
  const { activeBooking, tracking, connected, reconnecting } = useActiveTracking();
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [tele, setTele] = useState<LiveTelemetry | null>(null);

  // Real provider contact (phone/rating) + home coords from GET /api/bookings/:id.
  const detail = useBookingDetailQuery(activeBooking?.id);
  const partnerPhone = detail.data?.provider?.phoneNumber ?? null;
  const partnerRating = detail.data?.provider?.rating ?? null;
  const destination =
    detail.data?.address?.latitude != null && detail.data?.address?.longitude != null
      ? { lat: detail.data.address.latitude, lng: detail.data.address.longitude }
      : undefined;

  const t = tracking as TrackingShape | undefined;
  const hasLive = Boolean(activeBooking);
  const providerPos =
    t?.providerLatitude != null && t?.providerLongitude != null
      ? { lat: t.providerLatitude, lng: t.providerLongitude }
      : null;

  // Prefer the exact Google route ETA/distance; fall back to the server WS estimate.
  const etaMin = route?.etaMin ?? t?.eta ?? null;
  const distanceKm = route?.distanceKm ?? t?.distance ?? null;
  // Speed/heading: WS telemetry first, Kalman velocity from the map as real fallback.
  const speedKmh =
    t?.speed != null ? Math.round(t.speed * 3.6) : tele != null ? tele.speedKmh : null;
  const headingDeg = t?.bearing ?? tele?.headingDeg ?? null;
  const traffic = route ? TRAFFIC_LABEL[route.trafficLevel] : null;

  const stage = toJourneyStage(t?.status ?? activeBooking?.status);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  // Route/ETA make sense while the partner is still riding to you. Status can
  // lag reality (e.g. job force-started while the partner is still far away),
  // so ALSO treat "partner is >150 m from the door" as riding — the customer
  // must always see the exact route while the partner is on the move.
  const enRouteByStatus = stageIdx <= STAGE_ORDER.indexOf("EN_ROUTE");
  const farFromHome =
    providerPos && destination ? haversineKm(providerPos, destination) > 0.15 : false;
  const enRoute = enRouteByStatus || farFromHome;
  const [fullMapOpen, setFullMapOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Full-map overlay: Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!fullMapOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullMapOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullMapOpen]);

  const riderLabel = hasLive
    ? enRoute && etaMin != null
      ? `${activeBooking!.proName} · ${etaMin} min`
      : activeBooking!.proName
    : null;

  return (
    <section
      id="tracking"
      className={cn(pageSection, "scroll-mt-20", "mt-12 sm:mt-16 lg:mt-20")}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto w-full min-w-0 max-w-content"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-[36px] halo opacity-30 sm:-inset-3"
        />

        <article className="relative w-full min-w-0 overflow-hidden rounded-[26px] glass-card ring-aurora shadow-[0_24px_60px_-28px_rgb(30_27_75/0.4)] sm:rounded-[30px]">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 sheen opacity-45"
          />

          {/* Header */}
          <header className="relative z-10 flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-5 sm:py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex size-2.5 shrink-0">
                {!reduce && hasLive && connected && (
                  <span className="absolute size-full animate-ping rounded-full bg-emerald-500 opacity-50" />
                )}
                <span
                  className={cn(
                    "relative size-2.5 rounded-full",
                    hasLive && connected ? "bg-emerald-500" : "bg-slate-400",
                  )}
                />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-tight text-content sm:text-xl">
                  Live <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">Tracking</span>
                </h2>
                <p className="truncate text-xs text-muted">
                  {hasLive
                    ? `${activeBooking!.serviceTitle} · ${activeBooking!.dateLabel}`
                    : "Every booking comes with a real-time map"}
                </p>
              </div>
            </div>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold ring-1",
                hasLive && connected
                  ? "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                  : hasLive && reconnecting
                    ? "bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300"
                    : "bg-slate-500/10 text-muted ring-line",
              )}
            >
              {hasLive && connected ? <Wifi size={12} /> : hasLive ? <WifiOff size={12} /> : null}
              {hasLive ? (connected ? "LIVE" : reconnecting ? "RECONNECTING" : "OFFLINE") : "PREVIEW"}
            </span>
          </header>

          {/* Stack mobile · side-by-side desktop — height clamped to viewport */}
          <div className="flex min-h-0 w-full flex-col lg:max-h-[min(52dvh,20rem)] lg:flex-row lg:items-stretch xl:max-h-[min(48dvh,22rem)]">
            <div className="relative min-h-0 w-full shrink-0 border-b border-line/70 lg:flex-[1.15] lg:border-b-0 lg:border-r lg:min-h-[13rem]">
              <div className="relative h-[clamp(9.5rem,28dvh,13.5rem)] w-full min-h-0 sm:h-[clamp(10.5rem,30dvh,14.5rem)] md:h-[clamp(11rem,32dvh,15.5rem)] lg:absolute lg:inset-0 lg:h-full lg:min-h-[13rem]">
                {hasLive ? (
                  <>
                    <LiveTrackingMap
                      provider={providerPos}
                      destination={destination}
                      bearing={t?.bearing}
                      onRoute={setRoute}
                      onTelemetry={setTele}
                      routeEnabled={enRoute}
                      riderLabel={riderLabel}
                      className="absolute inset-0 size-full"
                    />
                    {!providerPos ? (
                      <span className="absolute left-3 top-3 z-10 rounded-full bg-slate-900/70 px-2.5 py-1 text-[10px] font-semibold text-sky-300 ring-1 ring-white/10 backdrop-blur">
                        Waiting for partner location…
                      </span>
                    ) : null}
                  </>
                ) : (
                  <LiveTrackingMapView className="absolute inset-0 size-full" />
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3.5 sm:gap-3.5 sm:p-4 lg:justify-between lg:overflow-y-auto lg:overscroll-contain lg:p-4 xl:gap-4 xl:p-5">
              {hasLive ? (
                <>
                  {/* Stage-aware hero — exact traffic ETA while riding, honest states after */}
                  <div className="flex items-start justify-between gap-4">
                    {enRoute ? (
                      <>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                            Arriving in
                          </p>
                          <p className="mt-0.5 font-display text-[clamp(1.75rem,7vw,2.75rem)] font-bold leading-none bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                            {etaMin != null ? etaMin : "—"}
                            <span className="ml-1 text-base font-semibold text-muted sm:text-lg">
                              min
                            </span>
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-muted">
                            {etaMin != null ? (
                              <>
                                by <span className="text-content">{arrivalClock(etaMin)}</span>
                                {traffic ? (
                                  <span className={cn("ml-1.5", traffic.cls)}>
                                    · {traffic.text}
                                    {route?.withTraffic ? " · live traffic" : ""}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              "Calculating the fastest route…"
                            )}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-emerald-500/8 px-3 py-2 text-center ring-1 ring-emerald-500/15">
                          <Navigation size={16} className="mx-auto text-emerald-600" />
                          <p className="mt-1 text-sm font-bold text-content">
                            {route?.distanceText ?? (distanceKm != null ? `${distanceKm} km` : "—")}
                          </p>
                          <p className="text-[10px] font-medium text-muted">exact route</p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                          {stage === "ARRIVED" ? "Partner at your door" : "Service in progress"}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2.5 font-display text-[clamp(1.4rem,5.5vw,2rem)] font-bold leading-tight bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                          {stage === "ARRIVED" ? "They're here" : "Work underway"}
                          <span className="relative flex size-2.5">
                            {!reduce && (
                              <span className="absolute size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                            )}
                            <span className="relative size-2.5 rounded-full bg-emerald-500" />
                          </span>
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-muted">
                          {stage === "ARRIVED"
                            ? "Please meet your partner at the door"
                            : "Sit back — we'll update you the moment it's done"}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Partner card — real name + real service */}
                  <div className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-canvas/70 p-2.5 ring-1 ring-line sm:gap-3 sm:p-3 dark:bg-white/[0.04]">
                    <div className="relative h-12 w-14 shrink-0 sm:h-14 sm:w-[4.5rem]">
                      <Image
                        src={HOMIGO_RIDER_IMAGE}
                        alt=""
                        fill
                        className="object-contain object-bottom"
                        sizes="72px"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-bold text-content sm:text-base">
                        {activeBooking!.proName}
                        {partnerRating != null ? (
                          <span className="ml-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            ★ {Number(partnerRating).toFixed(1)}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {activeBooking!.serviceName} · {activeBooking!.packageName}
                      </p>
                      {/* Real telemetry — speed + heading from the live GPS feed */}
                      <p className="mt-1 flex items-center gap-2.5 text-[11px] font-semibold text-muted">
                        <span className="inline-flex items-center gap-1">
                          <Gauge size={12} className="text-emerald-600" />
                          {speedKmh != null ? `${speedKmh} km/h` : "— km/h"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Navigation size={12} className="text-emerald-600" />
                          {headingDeg != null ? compass(headingDeg) : "—"}
                        </span>
                      </p>
                    </div>
                    {/* Call / Message — real partner phone from the booking */}
                    {partnerPhone ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <a
                          href={`sms:${partnerPhone}`}
                          aria-label={`Message ${activeBooking!.proName}`}
                          title={`Message ${activeBooking!.proName}`}
                          className="grid size-9 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 transition hover:bg-emerald-500/20 active:scale-95"
                        >
                          <MessageSquare size={15} />
                        </a>
                        <a
                          href={`tel:${partnerPhone}`}
                          aria-label={`Call ${activeBooking!.proName}`}
                          title={`Call ${activeBooking!.proName}`}
                          className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30 transition hover:brightness-110 active:scale-95"
                        >
                          <Phone size={15} />
                        </a>
                      </div>
                    ) : null}
                  </div>

                  {/* Real journey rail — driven by the live booking status */}
                  <div className="rounded-xl bg-surface/50 px-1 py-2 ring-1 ring-line/80 dark:bg-white/[0.03]">
                    <div className="flex items-center">
                      {STEPS.map((s, i) => {
                        const sIdx = STAGE_ORDER.indexOf(s.key);
                        const done = stageIdx > sIdx;
                        const active = stageIdx === sIdx;
                        return (
                          <div key={s.key} className="flex flex-1 items-center">
                            <div className="flex flex-col items-center gap-1 px-1">
                              <span
                                className={cn(
                                  "grid size-6 place-items-center rounded-full",
                                  done || active
                                    ? "bg-emerald-500 text-white shadow-sm"
                                    : "border-2 border-dashed border-line bg-surface",
                                  active && "ring-2 ring-emerald-500/30 ring-offset-2",
                                )}
                              >
                                {done && <Check size={12} strokeWidth={3} />}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] font-semibold",
                                  done || active ? "text-content" : "text-muted",
                                )}
                              >
                                {s.label}
                              </span>
                            </div>
                            {i < STEPS.length - 1 && (
                              <span
                                className={cn(
                                  "mx-1 mb-5 h-0.5 flex-1 rounded-full",
                                  stageIdx > sIdx
                                    ? "bg-gradient-to-r from-emerald-400/60 to-emerald-500"
                                    : "bg-line",
                                )}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setFullMapOpen(true)}
                      className="group flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(120deg,#10b981_0%,#0d9488_55%,#0f766e_100%)] text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgb(16_185_129/0.55)] transition hover:brightness-105 active:scale-[0.99] sm:h-12"
                    >
                      <Maximize2 size={17} />
                      Open full map
                      <ArrowRight
                        size={16}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </button>
                    <Link
                      href="/bookings"
                      className="block text-center text-[11px] font-semibold text-muted transition hover:text-content"
                    >
                      View all bookings →
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  {/* Honest empty state — no fake numbers */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                      Uber-style tracking
                    </p>
                    <p className="mt-1.5 font-display text-lg font-bold leading-snug text-content sm:text-xl">
                      Watch your pro ride to your door —{" "}
                      <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">live on the map</span>
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      Real-time GPS, exact ETA with live traffic, distance, speed and
                      arrival updates — on every HOMEEIGO booking.
                    </p>
                  </div>

                  <ul className="space-y-1.5 text-xs text-muted">
                    {["Live partner location & route", "Traffic-aware ETA", "Arrival & progress updates"].map(
                      (f) => (
                        <li key={f} className="flex items-center gap-2">
                          <span className="grid size-4 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
                            <Check size={10} strokeWidth={3} />
                          </span>
                          {f}
                        </li>
                      ),
                    )}
                  </ul>

                  <Link
                    href={bookUrl()}
                    className="group flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(120deg,#10b981_0%,#0d9488_55%,#0f766e_100%)] text-sm font-bold text-white shadow-[0_12px_30px_-10px_rgb(16_185_129/0.55)] transition hover:brightness-105 sm:h-12"
                  >
                    <Bike size={18} />
                    Book a service to go live
                    <ArrowRight
                      size={16}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </>
              )}
            </div>
          </div>
        </article>
      </motion.div>

      {/* ---- Premium full-screen live map (portal → body, above everything) ---- */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {fullMapOpen && hasLive ? (
              <motion.div
                key="full-map"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="fixed inset-0 z-[120] bg-slate-950"
                role="dialog"
                aria-modal="true"
                aria-label="Full-screen live tracking map"
              >
                {/* Map fills the viewport */}
                <LiveTrackingMap
                  provider={providerPos}
                  destination={destination}
                  bearing={t?.bearing}
                  onRoute={setRoute}
                  onTelemetry={setTele}
                  routeEnabled={enRoute}
                  riderLabel={riderLabel}
                  className="absolute inset-0 h-full w-full"
                />

                {/* Floating glass header — partner + status + close */}
                <motion.div
                  initial={{ y: -24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.08, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/85 p-3 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:left-1/2 sm:w-[min(40rem,92vw)] sm:-translate-x-1/2"
                >
                  <div className="relative h-11 w-14 shrink-0">
                    <Image src={HOMIGO_RIDER_IMAGE} alt="" fill className="object-contain object-bottom" sizes="56px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">
                      {activeBooking!.proName}
                      {partnerRating != null ? (
                        <span className="ml-1.5 text-[11px] font-semibold text-amber-400">
                          ★ {Number(partnerRating).toFixed(1)}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {activeBooking!.serviceName} · {activeBooking!.dateLabel}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1",
                      connected
                        ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                        : "bg-amber-500/15 text-amber-300 ring-amber-500/30",
                    )}
                  >
                    {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
                    {connected ? "LIVE" : "RECONNECTING"}
                  </span>
                  {partnerPhone ? (
                    <a
                      href={`tel:${partnerPhone}`}
                      aria-label={`Call ${activeBooking!.proName}`}
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30 transition hover:brightness-110 active:scale-95"
                    >
                      <Phone size={15} />
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setFullMapOpen(false)}
                    aria-label="Close full map"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition hover:bg-white/20 active:scale-95"
                  >
                    <X size={16} />
                  </button>
                </motion.div>

                {/* Floating glass bottom panel — live numbers + journey rail */}
                <motion.div
                  initial={{ y: 28, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.12, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-x-3 bottom-3 z-10 space-y-2.5 rounded-2xl border border-white/10 bg-slate-900/85 p-3.5 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:left-1/2 sm:w-[min(40rem,92vw)] sm:-translate-x-1/2"
                >
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                        {enRoute ? "Arriving in" : stage === "ARRIVED" ? "Partner at your door" : "Service in progress"}
                      </p>
                      {enRoute ? (
                        <p className="font-display text-3xl font-bold leading-none text-white">
                          {etaMin != null ? etaMin : "—"}
                          <span className="ml-1 text-sm font-semibold text-slate-400">min</span>
                        </p>
                      ) : (
                        <p className="font-display text-2xl font-bold leading-tight text-white">
                          {stage === "ARRIVED" ? "They're here" : "Work underway"}
                        </p>
                      )}
                      {enRoute && etaMin != null ? (
                        <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                          by <span className="text-white">{arrivalClock(etaMin)}</span>
                          {traffic ? (
                            <span className={cn("ml-1.5", traffic.cls)}>
                              · {traffic.text}
                              {route?.withTraffic ? " · live traffic" : ""}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2 text-center">
                      <div className="rounded-xl bg-white/5 px-3 py-1.5 ring-1 ring-white/10">
                        <Navigation size={13} className="mx-auto text-sky-400" />
                        <p className="mt-0.5 text-xs font-bold text-white">
                          {enRoute ? route?.distanceText ?? (distanceKm != null ? `${distanceKm} km` : "—") : "0 km"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/5 px-3 py-1.5 ring-1 ring-white/10">
                        <Gauge size={13} className="mx-auto text-sky-400" />
                        <p className="mt-0.5 text-xs font-bold text-white">
                          {speedKmh != null ? `${speedKmh} km/h` : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center rounded-xl bg-white/[0.04] px-1 py-1.5 ring-1 ring-white/10">
                    {STEPS.map((s, i) => {
                      const sIdx = STAGE_ORDER.indexOf(s.key);
                      const done = stageIdx > sIdx;
                      const active = stageIdx === sIdx;
                      return (
                        <div key={s.key} className="flex flex-1 items-center">
                          <div className="flex flex-col items-center gap-0.5 px-1">
                            <span
                              className={cn(
                                "grid size-5 place-items-center rounded-full",
                                done || active
                                  ? "bg-sky-500 text-white"
                                  : "border-2 border-dashed border-white/20 bg-transparent",
                                active && "ring-2 ring-sky-400/40 ring-offset-1 ring-offset-slate-900",
                              )}
                            >
                              {done && <Check size={10} strokeWidth={3} />}
                            </span>
                            <span className={cn("text-[9px] font-semibold", done || active ? "text-white" : "text-slate-500")}>
                              {s.label}
                            </span>
                          </div>
                          {i < STEPS.length - 1 && (
                            <span
                              className={cn(
                                "mx-0.5 mb-4 h-0.5 flex-1 rounded-full",
                                stageIdx > sIdx ? "bg-gradient-to-r from-sky-500/50 to-sky-500" : "bg-white/10",
                              )}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
    </section>
  );
}

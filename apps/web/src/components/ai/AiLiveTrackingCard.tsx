"use client";

import Image from "next/image";
import Link from "next/link";
import { Bike, Navigation } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { professionalLabel } from "@/lib/bookings";
import { liveTrackingView } from "@/lib/live-tracking-view";
import { cn } from "@/lib/utils";

type AiLiveTrackingCardProps = {
  embedded?: boolean;
  className?: string;
};

/**
 * Live tracking for the customer's real active booking, from the server's tracking record.
 *
 * With no professional on the way it says so. It used to render "Live · On the way", an arrival
 * countdown (0 when there was no data), a named "assigned expert" and an animated route for every
 * visitor, booking or not; the drawn route is gone too — the real map is on the booking.
 */
export function AiLiveTrackingCard({ embedded, className }: AiLiveTrackingCardProps) {
  const reduce = useReducedMotion();
  const { activeBooking, tracking } = useActiveTracking();
  const live = liveTrackingView(activeBooking, tracking);

  if (!live || !activeBooking) {
    return (
      <div
        id={AI_SECTION_IDS.liveTracking}
        data-testid="ai-live-tracking-idle"
        className={cn(!embedded && "w-full min-w-0 scroll-mt-24", className)}
      >
        <div className="rounded-xl border border-dashed border-emerald-400/20 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-ink dark:text-slate-100">No visit on the way right now</p>
          <p className="mt-1 text-[11px] text-slate">
            Live tracking appears here when your professional is travelling to you.
          </p>
          <Link
            href="/bookings"
            className="mt-3 inline-block rounded-md bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-300"
          >
            My bookings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      id={AI_SECTION_IDS.liveTracking}
      data-testid="ai-live-tracking-live"
      className={cn(!embedded && "w-full min-w-0 scroll-mt-24", className)}
    >
      <div className="relative mb-3 overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 shadow-[0_12px_32px_-12px_rgb(16_185_129/0.4)] ring-1 ring-emerald-500/25 dark:ring-emerald-400/20">
        <div className="relative flex items-end justify-between gap-2 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/30">
              <span className="relative flex size-1.5">
                {!reduce && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className="relative size-1.5 rounded-full bg-emerald-400" />
              </span>
              Live · On the way
            </span>
            <p className="mt-2 truncate font-display text-sm font-bold tracking-tight text-white sm:text-base">
              {professionalLabel(activeBooking)}
            </p>
            <p className="truncate text-[11px] text-white/70">{activeBooking.serviceTitle}</p>
          </div>
          <div className="relative h-14 w-16 shrink-0">
            <Image src={HOMIGO_RIDER_IMAGE} alt="" fill className="object-contain object-bottom" sizes="64px" priority={embedded} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* The server's ETA; when it has none, no number is shown. */}
        <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-ink dark:text-slate-100">
          {live.etaMin != null ? (
            <>
              <Bike size={12} className="shrink-0 text-emerald-500" />
              <span className="truncate">Arriving in about {live.etaMin} min</span>
            </>
          ) : (
            <>
              <Navigation size={12} className="shrink-0 text-emerald-500" />
              <span className="truncate">On the way</span>
            </>
          )}
        </span>
        <Link
          href="/bookings"
          className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-300"
        >
          Track
        </Link>
      </div>
    </div>
  );
}

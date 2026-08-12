"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { m as motion, useReducedMotion } from "framer-motion";
import { Calendar, ChevronRight, Star, User } from "lucide-react";
import {
  profileInteractiveSurface,
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { STATUS_CONFIG } from "@/lib/booking-status";
import type { SavedBooking } from "@/lib/bookings";
import { BookingDetailModal } from "@/components/booking/BookingDetailModal";
import { useAppStore } from "@/stores/app-store";
import { useUserRatingsQuery } from "@/hooks/use-core-data";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";

const EXTRA: Record<string, { rating: number; eta?: string }> = {
  "prof-ac-1": { rating: 4.9, eta: "Arriving in 12 mins" },
  "prof-sofa-1": { rating: 4.8 },
};

export function ProfileBookings() {
  const reduce = useReducedMotion();
  const storeBookings = useAppStore((s) => s.bookings);
  // Bookings synced via useProfileDerived / layout — avoid duplicate subscription
  const { data: ratingsData } = useUserRatingsQuery();
  const [selected, setSelected] = useState<SavedBooking | null>(null);

  const bookings = useMemo(() => {
    return [...storeBookings].slice(0, 2);
  }, [storeBookings]);
  const ratingsByBookingId = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of ratingsData?.ratings ?? []) {
      const bookingId = (r.bookingId as string | undefined) ?? (r.id as string | undefined);
      const rating = (r.rating as number | undefined) ?? (r.stars as number | undefined);
      if (bookingId && typeof rating === "number") map.set(bookingId, rating);
    }
    return map;
  }, [ratingsData?.ratings]);

  return (
    <>
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4 }}
        className={cn(profilePanelShell, profilePanelPad)}
      >
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2 sm:mb-5">
          <h2 className="font-display text-base font-bold text-content sm:text-lg">My Bookings</h2>
          <Link
            href="/bookings"
            className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-emerald-600 hover:underline sm:text-[13px]"
          >
            View All
            <ChevronRight size={15} className="sm:hidden" />
            <ChevronRight size={16} className="hidden sm:block" />
          </Link>
        </div>

        <ul className="flex flex-col gap-3 sm:gap-4">
          {bookings.map((booking, i) => {
            const cfg = STATUS_CONFIG[booking.status];
            const extra = {
              ...EXTRA[booking.id],
              rating: ratingsByBookingId.get(booking.id) ?? EXTRA[booking.id]?.rating,
            };
            const live = booking.status === "in_progress";

            return (
              <motion.li
                key={booking.id}
                initial={reduce ? false : { opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
              >
                <button
                  type="button"
                  onClick={() => setSelected(booking)}
                  className={cn(
                    profileInteractiveSurface,
                    "flex w-full min-w-0 flex-col gap-3 rounded-xl p-3 text-left min-[480px]:flex-row min-[480px]:gap-4 min-[480px]:p-4",
                  )}
                >
                  <div className="flex min-w-0 gap-3 min-[480px]:flex-1">
                    <div className="size-16 shrink-0 overflow-hidden rounded-[10px] bg-white shadow-[0_2px_8px_rgb(0_0_0/0.08)] dark:bg-ink sm:size-20">
                      {booking.imagePath ? (
                        <div className="relative size-full">
                          <ServiceImage
                            src={booking.imagePath}
                            alt=""
                            fill
                            sizes="80px"
                            className="object-contain p-1.5 sm:p-2"
                          />
                        </div>
                      ) : (
                        <div
                          className="size-full"
                          style={{ background: `${booking.serviceColor}22` }}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-[13px] font-bold leading-snug text-content sm:text-sm">
                        {booking.serviceTitle}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted sm:text-xs">
                        <User size={11} className="shrink-0" />
                        <span className="truncate">{booking.proName}</span>
                        {extra?.rating != null && (
                          <>
                            <span>·</span>
                            <Star size={11} className="shrink-0 text-gold" fill="currentColor" />
                            {extra.rating}
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted sm:text-xs">
                        <Calendar size={11} className="shrink-0" />
                        {booking.dateLabel}, {booking.timeLabel}
                      </p>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center justify-between gap-2 border-t border-line/80 pt-2.5 min-[480px]:shrink-0 min-[480px]:flex-col min-[480px]:items-end min-[480px]:justify-center min-[480px]:border-0 min-[480px]:pt-0">
                    <div className="flex flex-col items-start gap-1 min-[480px]:items-end">
                      <span
                        className="rounded-md px-2 py-0.5 text-[10px] font-semibold sm:px-3 sm:py-1 sm:text-[11px]"
                        style={{ backgroundColor: cfg.bg, color: cfg.text }}
                      >
                        {cfg.label}
                      </span>
                      {extra?.eta && live && (
                        <span className="text-[10px] text-muted sm:text-[11px]">{extra.eta}</span>
                      )}
                    </div>
                    <span
                      className="rounded-md border border-[#DBEAFE] bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-600/10 sm:px-3 sm:py-1.5 sm:text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {live ? "Track" : "Rebook"}
                    </span>
                  </div>
                </button>
              </motion.li>
            );
          })}
        </ul>
      </motion.section>

      <BookingDetailModal
        open={!!selected}
        booking={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

"use client";

import { useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import { useBookingStatusSubscription } from "@/hooks/use-booking-status-subscription";

/**
 * Mounts a /ws/booking/:bookingId subscription for the customer's currently
 * active booking (confirmed | in_progress). Decoupled from RealtimeBridge so
 * the booking room only opens when there is something to track — no extra
 * sockets on the home / dashboard pages.
 */
export function ActiveBookingChannel() {
  const bookings = useAppStore((s) => s.bookings);

  const activeBookingId = useMemo(() => {
    const active = bookings.find(
      (b) => b.status === "confirmed" || b.status === "in_progress",
    );
    return active?.id ?? null;
  }, [bookings]);

  useBookingStatusSubscription({
    bookingId: activeBookingId,
    enabled: !!activeBookingId,
  });

  return null;
}

"use client";

import { useEffect } from "react";
import { ensureDemoTrackingBooking } from "@/lib/demo-tracking-booking";
import { useAppStore } from "@/stores/app-store";

/** Ensures demo live-tracking booking exists for the AI page. */
export function useEnsureDemoTracking() {
  const bookings = useAppStore((s) => s.bookings);
  const addBooking = useAppStore((s) => s.addBooking);

  useEffect(() => {
    ensureDemoTrackingBooking(bookings, addBooking);
  }, [bookings, addBooking]);
}

"use client";

import { useBookingsQuery } from "@/hooks/use-core-data";

/** Ensures live bookings are synced for AI live tracking cards. */
export function useEnsureDemoTracking() {
  useBookingsQuery();
}

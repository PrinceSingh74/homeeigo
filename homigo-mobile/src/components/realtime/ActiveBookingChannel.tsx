import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { useBookingStatusSubscription } from "@/hooks/use-booking-status-subscription";

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

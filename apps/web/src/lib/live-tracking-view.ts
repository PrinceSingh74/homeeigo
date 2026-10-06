import type { BackendTracking } from "@/types/backend";

/**
 * Whether there is a live journey to show, and its ETA.
 *
 * Live means a real booking whose professional is travelling (`en_route`, on the booking or on its
 * tracking record) AND a tracking record from the server. Anything else is null and the card is not
 * rendered: it used to show "Live · On the way" and "Arriving in 0 mins" over an animated route for
 * every visitor, with or without a booking.
 */
export function liveTrackingView(
  activeBooking: { backendStatus?: string | null } | null | undefined,
  tracking: Pick<BackendTracking, "status" | "eta"> | null | undefined,
): { etaMin: number | null } | null {
  if (!activeBooking || !tracking) return null;
  const enRoute =
    (activeBooking.backendStatus ?? "").toLowerCase() === "en_route" || (tracking.status ?? "").toLowerCase() === "en_route";
  if (!enRoute) return null;
  // The server's ETA or none — never 0 standing in for "unknown".
  return { etaMin: typeof tracking.eta === "number" && tracking.eta > 0 ? Math.round(tracking.eta) : null };
}

import { useQuery } from "@tanstack/react-query";
import { parityApi } from "@/services/core/parity-api";
import { useAuthStore } from "@/stores/auth-store";
import { AuthApiError } from "@/lib/auth/errors";
import { selectionKey, type BookingQuote, type BookingSelection } from "@/lib/booking-quote";

/**
 * Server price quote for the CURRENT selection. The result carries the key it was priced for, so
 * the screen can refuse to confirm while a quote for an older selection is still on screen.
 */
export function useBookingPriceQuote(selection: BookingSelection | null) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const key = selection ? selectionKey(selection) : null;
  const query = useQuery({
    queryKey: ["bookings", "price-quote", key],
    queryFn: async (): Promise<{ key: string; quote: BookingQuote }> => ({
      key: key!,
      quote: await parityApi.bookings.priceQuote(selection!),
    }),
    enabled: isAuthenticated && !!selection?.serviceId,
    staleTime: 15_000,
    // A 4xx is an answer about this selection (bad tier, premium-only…) — retrying can't change it.
    retry: (count, error) =>
      !(error instanceof AuthApiError && error.status >= 400 && error.status < 500) && count < 2,
  });
  const current = query.data && query.data.key === key ? query.data.quote : null;
  return {
    quote: current,
    /** True only when the quote on screen was priced for exactly this selection. */
    ready: !!current && !query.isFetching && !query.isError,
    key,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export type ServiceabilityState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "serviceable"; zones: string[] }
  | { state: "unserviceable"; reason: "outside_zone" | "outside_india" }
  | { state: "unknown"; message: string };

/** Backend serviceability for a real point (GET /api/geo/serviceable). */
export function useServiceability(
  coords: { latitude: number; longitude: number } | null,
  category?: string,
): ServiceabilityState & { retry: () => void } {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const query = useQuery({
    queryKey: ["geo", "serviceable", coords?.latitude, coords?.longitude, category ?? ""],
    queryFn: () => parityApi.geo.serviceable(coords!.latitude, coords!.longitude, category),
    enabled: isAuthenticated && !!coords,
    staleTime: 5 * 60_000,
    retry: (count, error) =>
      !(error instanceof AuthApiError && error.status >= 400 && error.status < 500) && count < 2,
  });
  const retry = () => void query.refetch();
  if (!coords) return { state: "idle", retry };
  if (query.isLoading) return { state: "checking", retry };
  if (query.error) {
    if (query.error instanceof AuthApiError && query.error.code === "OUT_OF_AREA") {
      return { state: "unserviceable", reason: "outside_india", retry };
    }
    return { state: "unknown", message: "Couldn't check if we serve this address.", retry };
  }
  if (!query.data) return { state: "checking", retry };
  if (!query.data.serviceable) return { state: "unserviceable", reason: "outside_zone", retry };
  return { state: "serviceable", zones: query.data.zones.map((z) => z.name), retry };
}

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { PartnerBooking, PartnerBookingsResponse } from "@/types/partner";

/** Every read of the partner's bookings lives under this key, so one invalidation refreshes them all. */
export const BOOKINGS_ALL_KEY = ["partner", "bookings"] as const;

/**
 * One job, read on its own (`GET /api/bookings/:id`). It sits under BOOKINGS_ALL_KEY on purpose:
 * every lifecycle mutation and every realtime booking frame invalidates that prefix, so the open job
 * page follows them without each caller having to remember a second key.
 */
export const bookingDetailKey = (bookingId: string) => [...BOOKINGS_ALL_KEY, "detail", bookingId] as const;

type Cached = PartnerBookingsResponse | PartnerBooking | undefined;
export type BookingSnapshots = Array<[QueryKey, Cached]>;

const isList = (v: Cached): v is PartnerBookingsResponse => Array.isArray((v as PartnerBookingsResponse | undefined)?.bookings);

/** Applies an optimistic patch to the booking wherever it is cached — list rows and its own read. */
export function patchBookingsCache(qc: QueryClient, bookingId: string, patch: Partial<PartnerBooking>): BookingSnapshots {
  const snapshots = qc.getQueriesData<Cached>({ queryKey: BOOKINGS_ALL_KEY });
  for (const [key, prev] of snapshots) {
    if (!prev) continue;
    if (isList(prev)) {
      qc.setQueryData<PartnerBookingsResponse>(key, { ...prev, bookings: prev.bookings.map((b) => (b.id === bookingId ? { ...b, ...patch } : b)) });
    } else if ((prev as PartnerBooking).id === bookingId) {
      qc.setQueryData<PartnerBooking>(key, { ...(prev as PartnerBooking), ...patch });
    }
  }
  return snapshots;
}

export function restoreSnapshots(qc: QueryClient, snapshots: BookingSnapshots) {
  for (const [key, prev] of snapshots) {
    if (prev) qc.setQueryData(key, prev);
  }
}

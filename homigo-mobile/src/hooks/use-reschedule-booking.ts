import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parityApi } from "@/services/core/parity-api";
import { qk } from "@/hooks/use-core-data";
import { AuthApiError, getErrorMessage } from "@/lib/auth/errors";

// The rule itself lives in lib/booking-reschedule-rules (pure, unit-tested); re-exported here so
// existing importers are unaffected.
export { canRescheduleBooking } from "@/lib/booking-reschedule-rules";

const RESCHEDULE_ERROR_COPY: Record<string, string> = {
  OVERLAPPING_BOOKING: "You already have a booking at that time. Pick a different slot.",
  PROVIDER_UNAVAILABLE: "Your professional isn't available at that time. Pick a different slot.",
  INVALID_STATUS: "This booking can no longer be rescheduled.",
  NOT_FOUND: "This booking could not be found.",
  POOL_BUSY: "We're busy right now — please try again in a few seconds.",
};

export function rescheduleErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError && error.code && RESCHEDULE_ERROR_COPY[error.code]) {
    return RESCHEDULE_ERROR_COPY[error.code]!;
  }
  return getErrorMessage(error, "Could not reschedule. Please try again.");
}

export function useRescheduleBookingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, scheduledAt }: { bookingId: string; scheduledAt: Date }) =>
      parityApi.bookings.reschedule(bookingId, scheduledAt.toISOString()),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.bookingDetail(vars.bookingId) });
    },
  });
}

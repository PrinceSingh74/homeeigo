"use client";

import { useState } from "react";
import { useRescheduleQuoteQuery } from "@/hooks/use-core-data";
import { Calendar, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { BookingScheduleSection } from "@/components/booking/BookingScheduleSection";
import { useUpdateBookingMutation } from "@/hooks/use-core-data";
import { useAppStore } from "@/stores/app-store";

type RescheduleBookingModalProps = {
  open: boolean;
  bookingId: string;
  serviceTitle: string;
  currentScheduledAt: Date;
  onClose: () => void;
  onSuccess?: () => void;
};

export function RescheduleBookingModal({
  open,
  bookingId,
  serviceTitle,
  currentScheduledAt,
  onClose,
  onSuccess,
}: RescheduleBookingModalProps) {
  const showToast = useAppStore((s) => s.showToast);
  const updateBooking = useUpdateBookingMutation();
  const [scheduledAt, setScheduledAt] = useState(currentScheduledAt);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Asked only once the customer opens the confirm step — the fee depends on the booking, not
  // on the slot being picked, so there is nothing to refetch while they browse times.
  const feeQuote = useRescheduleQuoteQuery(bookingId, confirmOpen);
  const fee = feeQuote.data?.quote;

  const minFuture = new Date(Date.now() + 60 * 60 * 1000);
  const isValid = scheduledAt.getTime() >= minFuture.getTime();

  async function confirmReschedule() {
    if (!isValid) {
      showToast("Please pick a time at least 1 hour from now", "error");
      return;
    }
    try {
      await updateBooking.mutateAsync({
        bookingId,
        payload: { scheduledDate: scheduledAt.toISOString() },
      });
      setConfirmOpen(false);
      onClose();
      onSuccess?.();
      showToast("Booking rescheduled — your pro will be notified", "success");
    } catch {
      /* toast from mutation */
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Reschedule booking" size="md">
        <p className="mb-4 text-sm text-muted">
          Choose a new date and time for <span className="font-semibold text-content">{serviceTitle}</span>.
          We&apos;ll check partner availability and prevent double bookings.
        </p>
        <BookingScheduleSection
          scheduledAt={scheduledAt}
          onScheduledAtChange={setScheduledAt}
          onInvalid={(msg) => showToast(msg, "error")}
          step={undefined}
        />
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl bg-surface text-sm font-bold text-content ring-1 ring-line"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid || updateBooking.isPending}
            onClick={() => setConfirmOpen(true)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-aurora text-sm font-bold text-white shadow-glow-blue disabled:opacity-50"
          >
            {updateBooking.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calendar size={18} />
            )}
            Continue
          </button>
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm new time?"
        size="sm"
      >
        <p className="text-sm text-muted">
          New schedule:{" "}
          <span className="font-semibold text-content">
            {scheduledAt.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}
          </span>
        </p>
        {/*
          §45 / O6. This used to read "No extra charge unless your plan says otherwise", which
          became untrue the day the late-reschedule fee was set: a move inside two hours costs 25%.
          The number shown is the SERVER's, priced by the policy frozen on this booking — the client
          never works the percentage out, or it would disagree the moment the policy changes.
        */}
        {feeQuote.isLoading ? (
          <p className="mt-2 text-xs text-muted">Checking whether a fee applies…</p>
        ) : fee?.disposition === "LATE_FEE" ? (
          <p className="mt-2 text-xs font-semibold text-warning">
            {fee.feeAmount > 0
              ? `Moving this booking now carries a ₹${fee.feeAmount} late-reschedule fee (${fee.feeBps / 100}%).`
              : fee.message}{" "}
            Partner receives an instant notification.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted">
            No reschedule fee applies. Partner receives an instant notification.
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="h-12 rounded-2xl bg-surface text-sm font-bold text-content ring-1 ring-line"
          >
            Go back
          </button>
          <button
            type="button"
            disabled={updateBooking.isPending}
            onClick={() => void confirmReschedule()}
            className="h-12 rounded-2xl bg-aurora text-sm font-bold text-white"
          >
            {updateBooking.isPending ? "Updating…" : "Confirm reschedule"}
          </button>
        </div>
      </Modal>
    </>
  );
}

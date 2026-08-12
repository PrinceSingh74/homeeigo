"use client";

import { useState } from "react";
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
        <p className="mt-2 text-xs text-muted">
          No extra charge unless your plan says otherwise. Partner receives an instant notification.
        </p>
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Calendar,
  User,
  MessageSquare,
  Navigation,
  XCircle,
  CheckCircle2,
  RotateCcw,
  Star,
  ReceiptText,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import type { SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  useBookingDetailQuery,
  useCancelBookingMutation,
  useCancellationQuoteQuery,
  useRatingByBookingQuery,
  useRefreshBookingFromServerMutation,
} from "@/hooks/use-core-data";
import { RatingModal } from "@/components/ratings/RatingModal";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingTimeline } from "./BookingTimeline";
import { bookUrl } from "@/lib/booking-url";
import { useBookingPayment } from "@/hooks/use-booking-payment";
import { RescheduleBookingModal } from "@/components/booking/RescheduleBookingModal";
import { CustomerTrackingMap } from "@/components/tracking/CustomerTrackingMap";
import { WalletCheckoutSummary } from "@/components/checkout/WalletCheckoutSummary";

export function BookingDetailModal({
  open,
  booking,
  onClose,
}: {
  open: boolean;
  booking: SavedBooking | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);
  const cancelBooking = useCancelBookingMutation();
  const refreshBooking = useRefreshBookingFromServerMutation();
  const { clearPendingPaymentBookingId } = useBookingPayment();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const bookingId = booking?.id ?? "";

  const detailQuery = useBookingDetailQuery(open ? bookingId : undefined);
  const cancelQuoteQuery = useCancellationQuoteQuery(bookingId, cancelOpen);
  const ratingQuery = useRatingByBookingQuery(open ? bookingId : undefined);
  const liveStatus = detailQuery.data?.status;
  const resolvedStatus =
    liveStatus === "in_progress"
      ? "in_progress"
      : liveStatus === "completed"
        ? "completed"
        : liveStatus === "cancelled" || liveStatus === "cancelled_by_provider" || liveStatus === "cancelled_by_user"
          ? "cancelled"
          : (booking?.status ?? "confirmed");
  const cfg = STATUS_CONFIG[resolvedStatus];
  const img = booking?.imagePath;
  const canTrack = resolvedStatus === "confirmed";
  const canComplete =
    resolvedStatus === "confirmed" || resolvedStatus === "in_progress";
  const canCancel =
    resolvedStatus === "confirmed" || resolvedStatus === "in_progress";
  const canReschedule = resolvedStatus === "confirmed";
  const scheduledAt = detailQuery.data?.scheduledDate
    ? new Date(detailQuery.data.scheduledDate)
    : new Date();
  const canRebook =
    resolvedStatus === "cancelled" || resolvedStatus === "completed";
  const canRate = resolvedStatus === "completed";
  const existingRating = ratingQuery.data;
  const paymentStatus = (detailQuery.data?.paymentStatus ?? booking?.paymentStatus ?? "").toLowerCase();
  const paymentNeedsRecovery =
    paymentStatus === "initiated" || paymentStatus === "failed" || paymentStatus === "pending";
  const refundAmount = (detailQuery.data as { refundAmount?: number } | undefined)?.refundAmount;
  const refundStatus = (detailQuery.data as { refundStatus?: string } | undefined)?.refundStatus;
  const isRefundProcessed = refundStatus === "processed";
  const isRefundPending = refundStatus === "pending" || refundStatus === "processing";
  useEffect(() => {
    if (!bookingId) return;
    if (paymentStatus === "success") clearPendingPaymentBookingId(bookingId);
  }, [bookingId, clearPendingPaymentBookingId, paymentStatus]);

  if (!booking) return null;

  async function reconcileBooking(message?: string) {
    await refreshBooking.mutateAsync(bookingId);
    if (message) showToast(message, "info");
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="" size="lg" className="!p-0 overflow-hidden">
        <div className="-mx-6 -mt-2">
          <div
            className="relative overflow-hidden px-6 pb-8 pt-10 text-white"
            style={{ background: cfg.gradient }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 backdrop-blur-sm transition hover:bg-white/30"
            >
              <X size={20} />
            </button>
            <div className="flex items-end gap-5">
              {img ? (
                <ServiceImage
                  src={img}
                  alt=""
                  size={96}
                  sizes="96px"
                  className="size-24 drop-shadow-2xl"
                />
              ) : null}
              <div className="min-w-0 flex-1 space-y-2">
                <BookingStatusBadge status={resolvedStatus} live />
                <h2 className="font-display text-2xl font-bold">{booking.serviceTitle}</h2>
                <p className="text-sm text-white/85">{cfg.description}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm font-bold text-primary">{booking.id}</span>
              <p className="font-display text-3xl font-bold text-content">
                ₹{booking.total}
                <span className="ml-1 text-sm font-medium text-muted">total</span>
              </p>
            </div>

            <div className="space-y-3 rounded-2xl glass-card p-4 text-sm">
              <DetailRow icon={Calendar} label="Schedule" value={`${booking.dateLabel} · ${booking.timeLabel}`} />
              <DetailRow icon={MapPin} label="Address" value={booking.address} />
              <DetailRow icon={User} label="Professional" value={booking.proName} />
              <DetailRow icon={MessageSquare} label="Package" value={`${booking.packageName} Package`} />
              {booking.addons?.length ? (
                <DetailRow
                  icon={MessageSquare}
                  label="Add-ons"
                  value={booking.addons.map((a) => `${a.name} (+₹${a.price})`).join(" · ")}
                />
              ) : null}
              {booking.instructions ? (
                <DetailRow icon={MessageSquare} label="Notes" value={booking.instructions} />
              ) : null}
            </div>
            {detailQuery.isFetching ? (
              <p className="text-xs text-muted">Syncing latest booking status...</p>
            ) : null}

            <div>
              <h3 className="mb-3 font-display text-lg font-bold text-content">Status timeline</h3>
              <div className="rounded-2xl glass-card p-4">
                <BookingTimeline events={booking.timeline} />
              </div>
            </div>

            {/* Live provider tracking (real backend WS — graceful when no provider/offline). */}
            {canTrack && (
              <div>
                <h3 className="mb-3 font-display text-lg font-bold text-content">Live tracking</h3>
                <CustomerTrackingMap
                  bookingId={bookingId}
                  partner={detailQuery.data?.provider ?? null}
                  destination={
                    detailQuery.data?.address?.latitude != null &&
                    detailQuery.data?.address?.longitude != null
                      ? {
                          lat: detailQuery.data.address.latitude,
                          lng: detailQuery.data.address.longitude,
                        }
                      : undefined
                  }
                />
              </div>
            )}

            {/* Wallet + Razorpay checkout for an unpaid booking (real wallet/split engine). */}
            {paymentNeedsRecovery && (
              <div>
                <h3 className="mb-3 font-display text-lg font-bold text-content">Complete payment</h3>
                <WalletCheckoutSummary
                  bookingId={bookingId}
                  description={`${booking.serviceTitle} booking payment`}
                  onPaid={() => void reconcileBooking("Payment synced successfully")}
                />
              </div>
            )}

            <div className="flex flex-col gap-2 pb-2">
              {canTrack && (
                <ActionBtn
                  primary
                  icon={Navigation}
                  label="Track live"
                  onClick={() => {
                    onClose();
                    router.push("/bookings");
                  }}
                />
              )}
              {canComplete && (
                <ActionBtn
                  icon={CheckCircle2}
                  label="Mark as completed"
                  onClick={() =>
                    void reconcileBooking(
                      "Status refreshed from server. Completion is confirmed by provider.",
                    )
                  }
                />
              )}
              {canReschedule && (
                <ActionBtn
                  icon={Calendar}
                  label="Reschedule"
                  onClick={() => setRescheduleOpen(true)}
                />
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-error transition hover:bg-error/10"
                >
                  <XCircle size={18} />
                  Cancel booking
                </button>
              )}
              {canRebook && (
                <ActionBtn
                  primary
                  icon={RotateCcw}
                  label="Book again"
                  onClick={() => {
                    onClose();
                    router.push(bookUrl({ service: booking.serviceId }));
                  }}
                />
              )}
              {canRate && (
                <ActionBtn
                  primary={!existingRating}
                  icon={Star}
                  label={existingRating ? "Edit your review" : "Rate your service"}
                  onClick={() => setRatingOpen(true)}
                />
              )}
              {resolvedStatus === "cancelled" && (isRefundProcessed || isRefundPending) && (
                <div className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface/60 px-3 text-sm font-semibold text-muted">
                  <ReceiptText size={18} className="shrink-0" />
                  {isRefundProcessed
                    ? `Refund of ₹${refundAmount ?? booking.total} processed`
                    : `Refund of ₹${refundAmount ?? booking.total} in progress (5–7 days for card/UPI)`}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <RescheduleBookingModal
        open={rescheduleOpen}
        bookingId={bookingId}
        serviceTitle={booking.serviceTitle}
        currentScheduledAt={scheduledAt}
        onClose={() => setRescheduleOpen(false)}
        onSuccess={() => void reconcileBooking("Schedule updated")}
      />

      <RatingModal
        open={ratingOpen}
        onClose={() => setRatingOpen(false)}
        bookingId={bookingId}
        serviceName={booking.serviceTitle}
        providerName={booking.proName}
      />

      <AnimatePresence>
        {cancelOpen && (
          <Modal
            open
            onClose={() => setCancelOpen(false)}
            title="Cancel booking?"
            size="sm"
          >
            {cancelQuoteQuery.isLoading ? (
              <p className="text-sm text-muted">Calculating refund…</p>
            ) : cancelQuoteQuery.data?.quote ? (
              <div className="space-y-2 text-sm">
                <p className="text-muted">{cancelQuoteQuery.data.quote.message}</p>
                {cancelQuoteQuery.data.quote.refundAmount > 0 ? (
                  <p className="font-semibold text-content">
                    Refund: ₹{cancelQuoteQuery.data.quote.refundAmount}
                    {cancelQuoteQuery.data.quote.feeAmount > 0
                      ? ` (fee ₹${cancelQuoteQuery.data.quote.feeAmount})`
                      : ""}
                  </p>
                ) : (
                  <p className="text-muted">No payment to refund.</p>
                )}
                <p className="text-xs text-muted">
                  {cancelQuoteQuery.data.quote.refundMethodHint === "wallet_instant"
                    ? "Wallet refunds are instant."
                    : "Card/UPI refunds typically take 5–7 business days."}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Your booking will be cancelled. Refund depends on how close you are to the scheduled time.
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="h-12 rounded-2xl bg-surface text-sm font-bold text-content ring-1 ring-line"
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelOpen(false);
                  void cancelBooking.mutateAsync(booking.id).then(() => {
                    updateBookingStatus(bookingId, "cancelled");
                    void reconcileBooking("Booking cancellation synced");
                    onClose();
                  });
                }}
                className="h-12 rounded-2xl bg-error/10 text-sm font-bold text-error"
              >
                Cancel booking
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-0.5 text-content">{value}</p>
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: typeof Navigation;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-70",
        primary
          ? "bg-aurora text-white shadow-glow-blue hover:brightness-110"
          : "glass-card text-primary hover:bg-primary/5",
      )}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

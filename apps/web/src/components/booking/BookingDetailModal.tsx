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
  RotateCcw,
  Star,
  ReceiptText,
  UserRoundX,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import { professionalLabel, type SavedBooking } from "@/lib/bookings";
import { useAppStore } from "@/stores/app-store";
import {
  mapBackendBookingToSaved,
  useBookingDetailQuery,
  useCancelBookingMutation,
  useReportProviderNoShowMutation,
  useCancellationPolicyQuery,
  useCancellationQuoteQuery,
  useRatingByBookingQuery,
  useRefreshBookingFromServerMutation,
} from "@/hooks/use-core-data";
import { RatingModal } from "@/components/ratings/RatingModal";
import { statusConfigFor } from "@/lib/booking-status";
import { canCancelBooking, cancelBlockedReason } from "@/lib/booking-cancel-rules";
import { canReportProviderNoShow } from "@/lib/provider-no-show-offer";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { BookingProgressRail } from "./BookingProgressRail";
import { bookUrl } from "@/lib/booking-url";
import { useBookingPayment } from "@/hooks/use-booking-payment";
import { RescheduleBookingModal } from "@/components/booking/RescheduleBookingModal";
import { CustomerTrackingMap } from "@/components/tracking/CustomerTrackingMap";
import { ServiceStartPin } from "@/components/tracking/ServiceStartPin";
import { ArrivalConfirmation } from "@/components/booking/ArrivalConfirmation";
import { BookingRequirements } from "@/components/booking/BookingRequirements";
import { BookingExecution } from "@/components/booking/BookingExecution";
import { BookingSafety } from "@/components/booking/BookingSafety";
import { BookingCompletion, useBookingCompletionQuery } from "@/components/booking/BookingCompletion";
import { BookingCases } from "@/components/booking/BookingCases";
import { BookingChatPanel } from "@/components/booking/BookingChatPanel";
import { WalletCheckoutSummary } from "@/components/checkout/WalletCheckoutSummary";

export function BookingDetailModal({
  open,
  booking,
  onClose,
  onOpenBooking,
}: {
  open: boolean;
  booking: SavedBooking | null;
  onClose: () => void;
  /** Show another booking in this modal (a case's follow-up visit). Omit and the link is not offered. */
  onOpenBooking?: (booking: SavedBooking) => void;
}) {
  const router = useRouter();
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const showToast = useAppStore((s) => s.showToast);
  const cancelBooking = useCancelBookingMutation();
  const reportNoShow = useReportProviderNoShowMutation();
  const refreshBooking = useRefreshBookingFromServerMutation();
  const { clearPendingPaymentBookingId } = useBookingPayment();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const bookingId = booking?.id ?? "";

  const detailQuery = useBookingDetailQuery(open ? bookingId : undefined);
  const cancelQuoteQuery = useCancellationQuoteQuery(bookingId, cancelOpen);
  const cancellationPolicy = useCancellationPolicyQuery().data;
  const refundNote = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const refundTimingNote = cancelQuoteQuery.data?.quote
    ? refundNote(
        cancelQuoteQuery.data.quote.refundMethodHint === "wallet_instant"
          ? cancellationPolicy?.walletNote
          : cancellationPolicy?.gatewayNote,
      )
    : null;
  const ratingQuery = useRatingByBookingQuery(open ? bookingId : undefined);
  // While the customer has not confirmed the work, confirming is the one primary action.
  const awaitingConfirmation = useBookingCompletionQuery(open ? bookingId : "").data?.completion?.state === "PENDING_CUSTOMER";
  const liveStatus = detailQuery.data?.status?.toLowerCase();
  const resolvedStatus =
    liveStatus === "in_progress" || liveStatus === "en_route"
      ? "in_progress"
      : liveStatus === "completed"
        ? "completed"
        : liveStatus === "expired"
          ? "expired"
        : liveStatus === "customer_no_show"
          ? "customer_no_show"
        : liveStatus === "provider_no_show"
          ? "provider_no_show"
        : liveStatus === "cancelled" ||
            liveStatus === "cancelled_by_provider" ||
            liveStatus === "cancelled_by_user" ||
            liveStatus === "rejected"
          ? "cancelled"
          : (booking?.status ?? "confirmed");
  // Worded from the live booking: its backend status, payment status and whether a professional
  // is on it. The live detail wins over the saved copy.
  const cfg = statusConfigFor({
    status: resolvedStatus,
    backendStatus: liveStatus ?? booking?.backendStatus,
    paymentStatus: detailQuery.data?.paymentStatus ?? booking?.paymentStatus,
    proName: booking?.proName,
  });
  const img = booking?.imagePath;
  const canTrack = resolvedStatus === "confirmed" || resolvedStatus === "in_progress";
  // O3b: decided on the BACKEND status, not the collapsed one — the `in_progress`
  // presentation state also covers EN_ROUTE, where cancelling is still allowed.
  const canCancel = canCancelBooking(liveStatus);
  const cancelBlocked = cancelBlockedReason(liveStatus);
  // §53: only while the booking is still waiting on the professional.
  const canReportNoShow = canReportProviderNoShow(liveStatus, detailQuery.data?.scheduledDate);
  const canReschedule = resolvedStatus === "confirmed";
  const canChat = resolvedStatus === "confirmed" || resolvedStatus === "in_progress";
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
  // The backend also writes "failed" (and raw gateway states). Anything that is not processed or
  // pending must be shown as needing attention, never silently omitted.
  const isRefundFailed = Boolean(refundStatus) && refundStatus !== "none" && !isRefundProcessed && !isRefundPending;
  // Never substitute the booking total for an unknown refund amount — a partial refund would be overstated.
  const refundAmountLabel = refundAmount != null ? `₹${refundAmount}` : "Refund";
  useEffect(() => {
    if (!bookingId) return;
    if (paymentStatus === "success") clearPendingPaymentBookingId(bookingId);
  }, [bookingId, clearPendingPaymentBookingId, paymentStatus]);

  if (!booking) return null;

  async function reconcileBooking(message?: string) {
    await refreshBooking.mutateAsync(bookingId);
    if (message) showToast(message, "info");
  }

  /** Fetch the follow-up booking from the server, then hand it to the page that owns this modal. */
  async function openFollowUp(followUpBookingId: string) {
    try {
      const next = await refreshBooking.mutateAsync(followUpBookingId);
      onOpenBooking?.(mapBackendBookingToSaved(next));
    } catch {
      showToast("We couldn't open the follow-up booking. Please find it in My Bookings.", "error");
    }
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
                <BookingStatusBadge status={resolvedStatus} label={cfg.shortLabel} live />
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
              <DetailRow icon={User} label="Professional" value={professionalLabel(booking)} />
              {/* A finished label ("Split AC · 3 unit", "Base price"); absent when the server sent none. */}
              {booking.packageName?.trim() ? (
                <DetailRow icon={MessageSquare} label="Selection" value={booking.packageName} />
              ) : null}
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
              <h3 className="mb-3 font-display text-lg font-bold text-content">Booking progress</h3>
              {/* Six real stages with server timestamps only — see lib/booking-progress. */}
              <BookingProgressRail
                bookingId={bookingId}
                booking={detailQuery.data}
                loading={detailQuery.isLoading}
                failed={detailQuery.isError}
              />
            </div>

            {/* Service-start PIN — the customer shares it in person so the
                partner can begin. Shown while the job hasn't started yet. */}
            {canTrack && <ServiceStartPin bookingId={bookingId} proName={booking.proName} />}

            {/* The arrival exception: a quiet, explained control for when the professional's phone
                cannot give a location. It decides for itself whether to appear (lib/arrival-confirmation);
                before the live detail has loaded there is no status to go on, so it does not. */}
            <ArrivalConfirmation
              bookingId={bookingId}
              backendStatus={liveStatus}
              hasProfessional={Boolean(detailQuery.data?.provider)}
              professionalId={detailQuery.data?.provider?.id ?? null}
              arrivedAt={detailQuery.data?.arrivedAt}
            />

            {/* §6: what must be in place, whether it is, and what to do — server truth, never decided here. */}
            {/* §9: safety information and any safety hold — server truth. */}
            <BookingSafety bookingId={bookingId} />

            <BookingRequirements bookingId={bookingId} active={canTrack} />

            {/* §8: what was done — step titles and states from the server; never the partner's notes. */}
            <BookingExecution bookingId={bookingId} />

            {/* §10: quality verdict in plain words + the confirmation window; §11: report an issue. */}
            <BookingCompletion bookingId={bookingId} />

            {/* §11: the customer's reported issues and their progress — server truth. */}
            <BookingCases bookingId={bookingId} onOpenBooking={onOpenBooking ? (id) => void openFollowUp(id) : undefined} />

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

            {canChat ? (
              <div>
                <h3 className="mb-3 font-display text-lg font-bold text-content">Messages</h3>
                <BookingChatPanel bookingId={bookingId} partnerName={booking.proName} />
              </div>
            ) : null}

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
              {/* No "mark as completed" here: the professional completes the job, and the customer's
                  confirmation is the real confirm-completion call in BookingCompletion above. */}
              {canReschedule && (
                <ActionBtn
                  icon={Calendar}
                  label="Reschedule"
                  onClick={() => setRescheduleOpen(true)}
                />
              )}
              {/* O3b: say why the button is gone. A customer who opened this modal to cancel a
                  started job needs the route that works, not an absent control. */}
              {cancelBlocked && (
                <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                  {cancelBlocked}
                </p>
              )}
              {/* §53: a distinct action, never a flavour of cancelling — the money and the
                  consequences differ, and the customer is not the one at fault here. */}
              {canReportNoShow && (
                <button
                  type="button"
                  disabled={reportNoShow.isPending}
                  onClick={() => reportNoShow.mutate(booking.id, { onSuccess: () => onClose() })}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold text-warning transition hover:bg-warning/10 disabled:opacity-50"
                >
                  <UserRoundX size={18} />
                  Professional didn&apos;t arrive
                </button>
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
                  primary={!awaitingConfirmation}
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
                  primary={!existingRating && !awaitingConfirmation}
                  icon={Star}
                  label={existingRating ? "Edit your review" : "Rate your service"}
                  onClick={() => setRatingOpen(true)}
                />
              )}
              {resolvedStatus === "cancelled" && (isRefundProcessed || isRefundPending || isRefundFailed) && (
                <div
                  className={`flex h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-semibold ${
                    isRefundFailed ? "border-red-200 bg-red-50 text-red-700" : "border-line bg-surface/60 text-muted"
                  }`}
                  role={isRefundFailed ? "alert" : undefined}
                >
                  <ReceiptText size={18} className="shrink-0" />
                  {isRefundProcessed
                    ? `${refundAmountLabel} refund processed`
                    : isRefundPending
                      ? `${refundAmountLabel} refund in progress`
                      : `${refundAmountLabel} refund needs attention — contact support`}
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
                {/* How long a refund takes is the server's statement (the policy's wallet / gateway
                    note, chosen by the quote's refund method) or it is not stated. */}
                {refundTimingNote ? <p className="text-xs text-muted">{refundTimingNote}</p> : null}
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

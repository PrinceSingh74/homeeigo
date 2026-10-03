"use client";

import { JobBrief } from "@/components/requests/JobBrief";
import { useRef, useState } from "react";
import Link from "next/link";
import { m as motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  IndianRupee,
  MapPin,
  MapPinCheck,
  MessageSquare,
  Navigation,
  PlayCircle,
  User,
  XCircle,
} from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { CallCustomerButton } from "@/components/requests/CallCustomerButton";
import {
  useAcceptBookingMutation,
  useCancelBookingMutation,
  useCompleteBookingMutation,
  useMarkArrivedMutation,
  useMarkEnRouteMutation,
  useRejectBookingMutation,
  useStartBookingMutation,
} from "@/hooks/use-partner-data";
import type { PartnerBooking } from "@/types/partner";
import { formatTime } from "@/lib/format";
import { getErrorMessage, PartnerApiError } from "@/lib/api-error";
import {
  checklistCompletionFields,
  completionGate,
  describeCompletionRefusal,
  type CompletionRefusal,
} from "@/lib/completion-checklist";
import { localActionsFromBooking, primaryActionToLocalCta, primaryControlState, type JobActionResult } from "@/lib/job-action-policy";
import { getPartnerCoords, type PartnerCoords } from "@/lib/partner-coords";
import { StartJobOtpDialog } from "@/components/requests/StartJobOtpDialog";
import { LocationAccessMenu } from "@/components/requests/LocationAccessMenu";
import { useToastStore } from "@/stores/toast-store";

export function BookingRequestCard({
  request,
  onAccepted,
  completion,
  serverActions,
}: {
  request: PartnerBooking;
  onAccepted?: () => void;
  /**
   * The job page's view of the service quality checklist: the booking's frozen items and what the
   * partner has ticked. When given, "Mark complete" is gated on every item being ticked and sends
   * exactly the ticked items. When absent (list cards), this card cannot show a checklist and never
   * invents one — a `QUALITY_CHECKLIST_REQUIRED` refusal is answered with a link to the job page.
   */
  completion?: { checklist: string[]; ticked: ReadonlySet<string>; loading?: boolean; unavailable?: boolean };
  /**
   * The job page's server answer (`GET /api/bookings/:id/actions`), which realtime frames refresh.
   * Preferred over the list-row mirror, which can lag a hold placed or released while the page is open.
   */
  serverActions?: JobActionResult | null;
}) {
  const acceptMutation = useAcceptBookingMutation({ onAccepted });
  const rejectMutation = useRejectBookingMutation();
  const cancelMutation = useCancelBookingMutation();
  const startMutation = useStartBookingMutation();
  const completeMutation = useCompleteBookingMutation();
  const enRouteMutation = useMarkEnRouteMutation();
  const arrivedMutation = useMarkArrivedMutation();
  const showToast = useToastStore((s) => s.showToast);

  const [busy, setBusy] = useState<
    "accept" | "reject" | "cancel" | "start" | "complete" | "en_route" | "arrived" | null
  >(null);
  // "Start job" opens the customer-PIN gate instead of starting directly.
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [gpsMenuOpen, setGpsMenuOpen] = useState(false);
  const pendingGps = useRef<"arrived" | "start" | null>(null);
  // The server refused "Mark complete" for a missing checklist — shown inline with the way out.
  const [checklistRefusal, setChecklistRefusal] = useState<CompletionRefusal | null>(null);

  const gate = completion ? completionGate(completion.checklist, completion.ticked) : null;
  const completeBlocked = completion
    ? completion.loading === true || completion.unavailable === true || !gate!.allowed
    : false;
  const completeHint = completion
    ? completion.loading
      ? "Loading the service checklist…"
      : completion.unavailable
        ? "The service checklist could not be loaded — refresh the page before marking this job complete."
        : gate!.hint
    : null;

  const jobCoords: PartnerCoords | null =
    request.address?.latitude != null && request.address?.longitude != null
      ? { latitude: request.address.latitude, longitude: request.address.longitude }
      : null;

  const customerName =
    `${request.customer.firstName ?? ""} ${request.customer.lastName ?? ""}`.trim() ||
    "Customer";

  const isPending = request.status === "pending";
  const isAccepted = ["accepted", "assigned", "en_route"].includes(request.status);
  const isInProgress = request.status === "in_progress";
  const isActiveJob = isAccepted || isInProgress;

  // Prefer local policy mirror (same rules as GET /actions) without blocking the card on a fetch.
  // Timestamp gating remains the fallback so we never break existing flow.
  const policy = serverActions ?? localActionsFromBooking(request);
  const policyCta = primaryActionToLocalCta(policy.primaryAction);
  // X-60 (browser, 2026-09-29): the primary button now honours the policy's disabled reason (safety hold,
  // payment, requirements) instead of only choosing which button to show.
  const control = primaryControlState(policy);
  // A safety hold raised mid-job disables "Mark complete" too, with the server's sentence first.
  const completeByPolicy = control.action === "COMPLETE_SERVICE" && control.disabled ? control.reason : null;
  const shownCompleteHint = completeByPolicy ?? completeHint;
  const canGoEnRoute = policyCta
    ? policyCta === "en_route"
    : !request.enRouteAt && ["accepted", "assigned"].includes(request.status);
  const canMarkArrived = policyCta
    ? policyCta === "arrived"
    : !request.arrivedAt && ["accepted", "assigned", "en_route"].includes(request.status);

  async function withBusy<T>(label: typeof busy, fn: () => Promise<T>): Promise<void> {
    setBusy(label);
    try {
      await fn();
    } catch (error) {
      // Mutations already toast PartnerApiError; surface GPS / pre-flight failures here.
      if (!(error instanceof PartnerApiError)) {
        showToast(getErrorMessage(error), "error");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <PartnerCard
        className={
          isPending
            ? "border-partner-warning/40 ring-1 ring-partner-warning/20"
            : undefined
        }
      >
        {isPending && (
          <span className="mb-2 inline-block rounded-full bg-partner-warning/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-text">
            New request
          </span>
        )}
        {isInProgress && (
          <span className="mb-2 inline-block rounded-full bg-partner-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-text">
            In progress
          </span>
        )}
        {isAccepted && (
          <span className="mb-2 inline-block rounded-full bg-partner-success/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-text">
            Accepted
          </span>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-partner-primary/20">
              <User className="h-5 w-5 text-partner-primary" />
            </div>
            <div>
              <Link
                href={`/requests/${request.id}`}
                className="font-semibold text-partner-text hover:text-partner-primary hover:underline"
              >
                {customerName}
              </Link>
              <p className="text-sm text-partner-muted">{request.service.name}</p>
              {request.customer.phoneMasked ? (
                <p className="text-[11px] text-partner-muted">{request.customer.phoneMasked}</p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-0.5 font-display text-xl font-bold text-partner-success">
              <IndianRupee className="h-4 w-4" />
              {request.finalAmount}
            </p>
            <p className="text-[10px] text-partner-muted">final amount</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">Scheduled</p>
            <p className="font-semibold">{formatTime(request.scheduledDate)}</p>
          </div>
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">ETA</p>
            <p className="flex items-center justify-center gap-0.5 font-semibold">
              <Clock className="h-3 w-3" />
              {request.eta != null ? `${request.eta}m` : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-partner-bg/80 py-2">
            <p className="text-partner-muted">Booking</p>
            <p className="font-semibold font-mono text-[10px]">
              {request.bookingNumber}
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-sm text-partner-muted">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" />
          {request.address?.fullAddress ?? "Address pending"}
        </p>

        <JobBrief job={request.job} compact />
        {request.addons?.length && !request.job?.addons.length ? (
          <p className="mt-2 text-xs font-medium text-partner-text-secondary">
            Add-ons: {request.addons.map((a) => `${a.name} (+₹${a.price})`).join(" · ")}
          </p>
        ) : null}

        {request.description ? (
          <p className="mt-2 text-xs text-partner-muted">{request.description}</p>
        ) : null}

        {isActiveJob ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <CallCustomerButton
              bookingId={request.id}
              phoneMasked={request.customer.phoneMasked}
            />
            <Link
              href={`/requests/${request.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold text-partner-text transition hover:border-partner-primary/50"
            >
              <MessageSquare className="h-4 w-4 text-partner-primary" />
              Chat
            </Link>
          </div>
        ) : null}

        {isActiveJob ? (
          <div className="mt-3">
            <LocationAccessMenu
              jobCoords={jobCoords}
              forceOpen={gpsMenuOpen}
              onResolved={(coords) => {
                setGpsMenuOpen(false);
                const pending = pendingGps.current;
                pendingGps.current = null;
                if (pending === "arrived") {
                  void withBusy("arrived", () =>
                    arrivedMutation.mutateAsync({
                      bookingId: request.id,
                      latitude: coords.latitude,
                      longitude: coords.longitude,
                    }),
                  );
                }
              }}
            />
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {isPending && (
            <>
              <PartnerButton
                variant="outline"
                className="w-full"
                disabled={busy !== null}
                onClick={() =>
                  void withBusy("reject", () =>
                    rejectMutation.mutateAsync({
                      bookingId: request.id,
                      reason: "Declined by partner",
                    }),
                  )
                }
              >
                <XCircle className="h-4 w-4" />
                {busy === "reject" ? "Declining…" : "Decline"}
              </PartnerButton>
              <PartnerButton
                variant="success"
                className="w-full"
                disabled={busy !== null}
                onClick={() =>
                  void withBusy("accept", () =>
                    acceptMutation.mutateAsync({
                      bookingId: request.id,
                      eta: request.eta ?? undefined,
                    }),
                  )
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                {busy === "accept" ? "Accepting…" : "Accept"}
              </PartnerButton>
            </>
          )}

          {isAccepted && (
            <>
              <PartnerButton
                variant="outline"
                className="w-full"
                disabled={busy !== null}
                onClick={() =>
                  void withBusy("cancel", () =>
                    cancelMutation.mutateAsync({
                      bookingId: request.id,
                      reason: "Cancelled by partner",
                    }),
                  )
                }
              >
                <XCircle className="h-4 w-4" />
                {busy === "cancel" ? "Cancelling…" : "Cancel job"}
              </PartnerButton>

              {control.reason ? (
                <p role="status" data-testid="job-primary-blocked" className="col-span-2 text-xs text-amber-900 dark:text-amber-400">
                  {control.reason}
                </p>
              ) : null}
              {canGoEnRoute ? (
                <PartnerButton
                  variant="primary"
                  className="w-full"
                  disabled={busy !== null || control.disabled}
                  onClick={() =>
                    void withBusy("en_route", async () => {
                      const coords = await getPartnerCoords("soft");
                      await enRouteMutation.mutateAsync({
                        bookingId: request.id,
                        latitude: coords?.latitude ?? null,
                        longitude: coords?.longitude ?? null,
                      });
                    })
                  }
                >
                  <Navigation className="h-4 w-4" />
                  {busy === "en_route" ? "Saving…" : "On my way"}
                </PartnerButton>
              ) : canMarkArrived ? (
                <PartnerButton
                  variant="primary"
                  className="w-full"
                  disabled={busy !== null || control.disabled}
                  onClick={() =>
                    void withBusy("arrived", async () => {
                      const coords = await getPartnerCoords("strict");
                      if (!coords) {
                        pendingGps.current = "arrived";
                        setGpsMenuOpen(true);
                        return;
                      }
                      await arrivedMutation.mutateAsync({
                        bookingId: request.id,
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                      });
                    })
                  }
                >
                  <MapPinCheck className="h-4 w-4" />
                  {busy === "arrived" ? "Saving…" : "I've arrived"}
                </PartnerButton>
              ) : (
                <PartnerButton
                  variant="primary"
                  className="w-full"
                  disabled={busy !== null || control.disabled}
                  onClick={() => setOtpDialogOpen(true)}
                >
                  <PlayCircle className="h-4 w-4" />
                  {busy === "start" ? "Starting…" : "Start job"}
                </PartnerButton>
              )}
            </>
          )}

          {isInProgress && (
            <PartnerButton
              variant="outline"
              className="col-span-2 w-full"
              disabled={busy !== null}
              onClick={() =>
                void withBusy("cancel", () =>
                  cancelMutation.mutateAsync({
                    bookingId: request.id,
                    reason: "Cancelled by partner — unable to complete",
                  }),
                )
              }
            >
              <XCircle className="h-4 w-4" />
              {busy === "cancel" ? "Cancelling…" : "Cancel job"}
            </PartnerButton>
          )}

          {isInProgress && (
            <>
              {checklistRefusal ? (
                <div
                  role="alert"
                  className="col-span-2 flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900"
                  data-testid="complete-checklist-refusal"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Checklist not complete</p>
                    <p>{checklistRefusal.message}</p>
                    {!completion ? (
                      <Link href={checklistRefusal.href} className="mt-1 inline-block font-semibold underline">
                        Open the job page
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {shownCompleteHint ? (
                <p id={`complete-hint-${request.id}`} className="col-span-2 text-xs text-partner-muted" data-testid="complete-hint">
                  {shownCompleteHint}
                </p>
              ) : null}
              <PartnerButton
                variant="success"
                className="col-span-2 w-full"
                disabled={busy !== null || completeBlocked || completeByPolicy !== null}
                aria-describedby={shownCompleteHint ? `complete-hint-${request.id}` : undefined}
                data-testid="mark-complete"
                onClick={() =>
                  void withBusy("complete", async () => {
                    setChecklistRefusal(null);
                    const coords = await getPartnerCoords("soft");
                    try {
                      await completeMutation.mutateAsync({
                        bookingId: request.id,
                        latitude: coords?.latitude ?? null,
                        longitude: coords?.longitude ?? null,
                        // Only what the partner ticked on the job page; nothing when no checklist was shown.
                        ...(completion ? checklistCompletionFields(completion.checklist, completion.ticked) : {}),
                      });
                    } catch (error) {
                      const refusal = describeCompletionRefusal(error, request.id, { onJobPage: !!completion });
                      if (refusal) setChecklistRefusal(refusal);
                      throw error;
                    }
                  })
                }
              >
                <CheckCircle2 className="h-4 w-4" />
                {busy === "complete" ? "Completing…" : "Mark complete"}
              </PartnerButton>
            </>
          )}
        </div>
      </PartnerCard>

      {otpDialogOpen && (
        <StartJobOtpDialog
          bookingId={request.id}
          customerName={customerName}
          onClose={() => setOtpDialogOpen(false)}
          onStart={async (otp) => {
            setBusy("start");
            try {
              const coords = await getPartnerCoords("strict");
              if (!coords) {
                pendingGps.current = "start";
                setGpsMenuOpen(true);
                showToast("Turn on GPS from the dropdown, then enter the PIN again.", "info");
                return;
              }
              await startMutation.mutateAsync({
                bookingId: request.id,
                latitude: coords.latitude,
                longitude: coords.longitude,
                otp,
              });
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </motion.div>
  );
}

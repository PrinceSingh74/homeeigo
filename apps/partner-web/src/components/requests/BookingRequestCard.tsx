"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  IndianRupee,
  MapPin,
  MapPinCheck,
  Navigation,
  PlayCircle,
  User,
  XCircle,
} from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
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
import { StartJobOtpDialog } from "@/components/requests/StartJobOtpDialog";

async function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ latitude: 0, longitude: 0 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => resolve({ latitude: 0, longitude: 0 }),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

export function BookingRequestCard({
  request,
  onAccepted,
}: {
  request: PartnerBooking;
  onAccepted?: () => void;
}) {
  const acceptMutation = useAcceptBookingMutation({ onAccepted });
  const rejectMutation = useRejectBookingMutation();
  const cancelMutation = useCancelBookingMutation();
  const startMutation = useStartBookingMutation();
  const completeMutation = useCompleteBookingMutation();
  const enRouteMutation = useMarkEnRouteMutation();
  const arrivedMutation = useMarkArrivedMutation();

  const [busy, setBusy] = useState<
    "accept" | "reject" | "cancel" | "start" | "complete" | "en_route" | "arrived" | null
  >(null);
  // "Start job" opens the customer-PIN gate instead of starting directly.
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);

  const customerName =
    `${request.customer.firstName ?? ""} ${request.customer.lastName ?? ""}`.trim() ||
    "Customer";

  const isPending = request.status === "pending";
  const isAccepted = ["accepted", "assigned", "en_route"].includes(request.status);
  const isInProgress = request.status === "in_progress";

  // Arrival never changes `status`, so the stage is derived from the timestamps the
  // backend now returns. Offering only the one legal next action is what stops a partner
  // from skipping the travel-start anchor the ETA label is measured from.
  const canGoEnRoute =
    !request.enRouteAt && ["accepted", "assigned"].includes(request.status);
  const canMarkArrived =
    !request.arrivedAt && ["accepted", "assigned", "en_route"].includes(request.status);

  async function withBusy<T>(label: typeof busy, fn: () => Promise<T>): Promise<void> {
    setBusy(label);
    try {
      await fn();
    } catch {
      /* mutation onError surfaces toast — avoid uncaught PartnerApiError */
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
          <span className="mb-2 inline-block rounded-full bg-partner-warning/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-warning">
            New request
          </span>
        )}
        {isInProgress && (
          <span className="mb-2 inline-block rounded-full bg-partner-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-primary">
            In progress
          </span>
        )}
        {isAccepted && (
          <span className="mb-2 inline-block rounded-full bg-partner-success/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-partner-success">
            Accepted
          </span>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-partner-primary/20">
              <User className="h-5 w-5 text-partner-primary" />
            </div>
            <div>
              <p className="font-semibold">{customerName}</p>
              <p className="text-sm text-partner-muted">{request.service.name}</p>
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

        {request.addons?.length ? (
          <p className="mt-2 text-xs font-medium text-partner-text-secondary">
            Add-ons: {request.addons.map((a) => `${a.name} (+₹${a.price})`).join(" · ")}
          </p>
        ) : null}

        {request.description ? (
          <p className="mt-2 text-xs text-partner-muted">{request.description}</p>
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
                    acceptMutation.mutateAsync({ bookingId: request.id }),
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

              {canGoEnRoute ? (
                <PartnerButton
                  variant="primary"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() =>
                    void withBusy("en_route", async () => {
                      const coords = await getCurrentCoords();
                      await enRouteMutation.mutateAsync({
                        bookingId: request.id,
                        latitude: coords.latitude,
                        longitude: coords.longitude,
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
                  disabled={busy !== null}
                  onClick={() =>
                    void withBusy("arrived", async () => {
                      const coords = await getCurrentCoords();
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
                  disabled={busy !== null}
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
            <PartnerButton
              variant="success"
              className="col-span-2 w-full"
              disabled={busy !== null}
              onClick={() =>
                void withBusy("complete", async () => {
                  const coords = await getCurrentCoords();
                  await completeMutation.mutateAsync({
                    bookingId: request.id,
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                  });
                })
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              {busy === "complete" ? "Completing…" : "Mark complete"}
            </PartnerButton>
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
              const coords = await getCurrentCoords();
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

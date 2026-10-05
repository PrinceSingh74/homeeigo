"use client";

import { useEffect, useRef, useState } from "react";
import { m as motion } from "framer-motion";
import {
  Check,
  Clock,
  IndianRupee,
  MapPin,
  Sparkles,
  TimerOff,
  X,
} from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { OfferCountdownRing } from "@/components/requests/OfferCountdownRing";
import { useOfferCountdown } from "@/hooks/use-offer-countdown";
import {
  useAcceptBookingMutation,
  usePartnerDashboardQuery,
  useRejectBookingMutation,
} from "@/hooks/use-partner-data";
import type { PartnerBooking } from "@/types/partner";
import { formatInr, formatTime } from "@/lib/format";
import { getErrorMessage, PartnerApiError } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";

/**
 * A live dispatch offer, for the "New requests" tab.
 *
 * ── Why this is not the generic booking card ────────────────────────────────
 *
 * An offer is a different object from a job. It has a deadline, it is contested with other partners,
 * and the only two things the partner does with it are take it or pass. The generic card rendered it
 * with the same chrome as an accepted job and — critically — showed no deadline at all, because the
 * API did not send one. The offer window is five minutes. Partners were reading a card with no clock
 * on it, tapping Accept, and being told the request "is not assigned to you or has expired".
 *
 * ── What it commits to ──────────────────────────────────────────────────────
 *
 * The deadline is visible from across the room, escalates as it drains, and when it lapses the card
 * SAYS SO instead of vanishing or leaving an Accept button that the server will refuse. An offer the
 * partner cannot win should never look like one they can.
 *
 * Money is stated as what it is. The customer's total is labelled the job's value, and the partner's
 * share is shown only when the server has told us their commission tier — an estimate, labelled as
 * an estimate. Guessing a payout to fill the space would be the platform quoting a partner a number
 * for their own work that nobody computed.
 */
export function JobOfferCard({
  request,
  onAccepted,
}: {
  request: PartnerBooking;
  onAccepted?: () => void;
}) {
  const acceptMutation = useAcceptBookingMutation({ onAccepted });
  const rejectMutation = useRejectBookingMutation();
  const dashboard = usePartnerDashboardQuery();
  const showToast = useToastStore((s) => s.showToast);

  const countdown = useOfferCountdown(request.offer);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [claimed, setClaimed] = useState(false);
  const expiryToasted = useRef(false);

  const expired = countdown?.expired ?? false;
  const urgency = countdown?.urgency ?? "calm";

  /**
   * Tell the partner once, when it happens.
   *
   * Without this the card simply stops working and the partner is left wondering whether they
   * missed it or the app broke. Guarded by a ref because the countdown re-renders every second and
   * an un-guarded toast would fire on every tick.
   */
  useEffect(() => {
    if (expired && !expiryToasted.current && !claimed) {
      expiryToasted.current = true;
      showToast("That request timed out — it's gone to another partner", "info");
    }
  }, [expired, claimed, showToast]);

  const customerName =
    `${request.customer.firstName ?? ""} ${request.customer.lastName ?? ""}`.trim() || "Customer";

  /**
   * The partner's share, stated with its assumption attached.
   *
   * `earnings.calculate` computes `commission = finalAmount × rate` and
   * `netEarning = finalAmount − commission + bonus − deduction`, so this is that figure BEFORE the
   * two provider-level adjustments, which are only known at completion. The rate is the partner's
   * tier as of their last dashboard load; tiers improve with monthly volume, so a stale one can only
   * under-state the payout.
   *
   * The percentage is rendered next to the number rather than folded into it. A bare "you earn ₹X"
   * would be the platform quoting a partner a figure for their own work with no way to check it;
   * with the rate visible, the arithmetic is theirs to verify. When the rate has not loaded, nothing
   * is shown — an invented payout is worse than no payout.
   */
  const commissionRate = dashboard.data?.earnings.commissionRate;
  const rateUsable =
    typeof commissionRate === "number" && commissionRate > 0 && commissionRate < 100;
  const estimatedNet = rateUsable ? request.finalAmount * (1 - commissionRate! / 100) : null;

  const addonTotal = (request.addons ?? []).reduce((sum, a) => sum + a.price, 0);

  const accent =
    expired
      ? "var(--color-partner-line)"
      : urgency === "critical"
        ? "var(--color-partner-danger)"
        : urgency === "warning"
          ? "var(--color-partner-warning)"
          : "var(--color-partner-success)";

  async function run(label: "accept" | "decline", fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      if (label === "accept") setClaimed(true);
    } catch (error) {
      // The mutations already toast PartnerApiError with the server's own wording.
      if (!(error instanceof PartnerApiError)) showToast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      className={`partner-card relative overflow-hidden rounded-2xl ${
        expired ? "opacity-70 saturate-50" : ""
      }`}
      style={{ borderTop: `3px solid ${accent}` }}
      aria-label={`Job offer from ${customerName} for ${request.service.name}`}
    >
      {/* Drains left-to-right: the deadline stays readable even if the ring is off-screen. */}
      {countdown && !expired ? (
        <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden" aria-hidden="true">
          <div
            className="h-full origin-left"
            style={{
              background: accent,
              transform: `scaleX(${countdown.fraction})`,
              transition: "transform 1s linear, background 300ms ease",
            }}
          />
        </div>
      ) : null}

      <div className="p-5">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                expired
                  ? "bg-partner-line text-partner-muted"
                  : "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100"
              }`}
            >
              {expired ? <TimerOff className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {expired ? "Offer closed" : "New request"}
            </span>
            <h3 className="mt-2 truncate font-display text-lg font-bold leading-tight text-partner-text">
              {request.service.name}
            </h3>
            <p className="mt-0.5 truncate text-sm text-partner-text-secondary">
              {customerName}
              <span className="text-partner-muted"> · {request.bookingNumber}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-start gap-3">
            <div className="text-right">
              <p className="flex items-center justify-end gap-0.5 font-display text-2xl font-bold leading-none text-partner-text">
                <IndianRupee className="h-5 w-5" />
                {formatInr(request.finalAmount).replace("₹", "")}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-partner-muted">
                Job value
              </p>
              {estimatedNet != null ? (
                <p
                  className="mt-1 text-[11px] font-semibold text-partner-success"
                  title={`Your ${commissionRate}% commission tier applied to the job value. Bonuses and deductions are settled on completion.`}
                >
                  ≈ {formatInr(estimatedNet)} after {commissionRate}%
                </p>
              ) : null}
            </div>
            {countdown && !expired ? <OfferCountdownRing countdown={countdown} /> : null}
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Scheduled", value: formatTime(request.scheduledDate) },
            {
              label: "Travel",
              value: request.eta != null ? `${request.eta} min` : "—",
              icon: <Clock className="h-3 w-3" />,
            },
            {
              label: "Add-ons",
              value: addonTotal > 0 ? `+${formatInr(addonTotal)}` : "None",
            },
          ].map((cell) => (
            <div key={cell.label} className="rounded-xl bg-partner-bg/70 px-2 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-partner-muted">
                {cell.label}
              </dt>
              <dd className="mt-1 flex items-center justify-center gap-1 text-sm font-bold text-partner-text">
                {cell.icon}
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 flex items-start gap-2 text-sm text-partner-text-secondary">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" />
          <span className="min-w-0">{request.address?.fullAddress ?? "Address pending"}</span>
        </p>

        {request.addons?.length ? (
          <p className="mt-2 text-xs text-partner-muted">
            {request.addons.map((a) => `${a.name} (+${formatInr(a.price)})`).join(" · ")}
          </p>
        ) : null}

        {request.description ? (
          <p className="mt-2 rounded-lg bg-partner-bg/60 px-3 py-2 text-xs italic text-partner-text-secondary">
            “{request.description}”
          </p>
        ) : null}

        {expired ? (
          <p className="mt-4 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-3 text-center text-xs font-medium text-partner-muted">
            This request timed out before it was answered. It has been offered to another partner —
            declining or accepting it now would not reach the customer.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-[1fr_1.6fr] gap-2">
            <PartnerButton
              variant="outline"
              className="w-full"
              disabled={busy !== null || claimed}
              onClick={() =>
                void run("decline", () =>
                  rejectMutation.mutateAsync({
                    bookingId: request.id,
                    reason: "Declined by partner",
                  }),
                )
              }
            >
              <X className="h-4 w-4" />
              {busy === "decline" ? "Declining…" : "Pass"}
            </PartnerButton>
            <PartnerButton
              variant="success"
              className="w-full"
              disabled={busy !== null || claimed}
              onClick={() =>
                void run("accept", () =>
                  acceptMutation.mutateAsync({
                    bookingId: request.id,
                    eta: request.eta ?? undefined,
                  }),
                )
              }
            >
              <Check className="h-4 w-4" />
              {claimed ? "Accepted" : busy === "accept" ? "Accepting…" : "Accept job"}
            </PartnerButton>
          </div>
        )}
      </div>
    </motion.article>
  );
}

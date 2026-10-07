"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  MapPin,
  MapPinCheck,
  MessageSquare,
  Navigation,
  PlayCircle,
  CheckCircle2,
} from "lucide-react";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { CallCustomerButton } from "@/components/requests/CallCustomerButton";
import { StartJobOtpDialog } from "@/components/requests/StartJobOtpDialog";
import {
  useCompleteBookingMutation,
  useMarkArrivedMutation,
  useMarkEnRouteMutation,
  usePartnerActiveBookingsQuery,
  useStartBookingMutation,
} from "@/hooks/use-partner-data";
import { localActionsFromBooking, primaryActionToLocalCta } from "@/lib/job-action-policy";
import { getPartnerCoords } from "@/lib/partner-coords";
import { getErrorMessage, PartnerApiError } from "@/lib/api-error";
import { describeCompletionRefusal, type CompletionRefusal } from "@/lib/completion-checklist";
import { formatInr } from "@/lib/format";
import { useToastStore } from "@/stores/toast-store";

/** Presentation for each lifecycle stage — keeps the CTA a lookup, not a ternary chain. */
const NEXT_ACTION = {
  en_route: { label: "On my way", busyLabel: "Saving…", Icon: Navigation },
  arrived: { label: "I've arrived", busyLabel: "Saving…", Icon: MapPinCheck },
  start: { label: "Start job", busyLabel: "Starting…", Icon: PlayCircle },
  complete: { label: "Mark complete", busyLabel: "Completing…", Icon: CheckCircle2 },
} as const;

export function DashboardLiveTracking() {
  const { data, isLoading, isError } = usePartnerActiveBookingsQuery();

  const startMutation = useStartBookingMutation();
  const completeMutation = useCompleteBookingMutation();
  const enRouteMutation = useMarkEnRouteMutation();
  const arrivedMutation = useMarkArrivedMutation();
  const showToast = useToastStore((s) => s.showToast);
  const [busy, setBusy] = useState<
    "start" | "complete" | "en_route" | "arrived" | null
  >(null);
  // "Start job" routes through the customer-PIN verification gate.
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  /**
   * The dashboard cannot show the service quality checklist, and it must not pretend one was
   * ticked. When the server refuses completion for it, the way out is the job page.
   */
  const [checklistRefusal, setChecklistRefusal] = useState<CompletionRefusal | null>(null);

  const activeJob = useMemo(
    () =>
      (data?.bookings ?? []).find((b) =>
        ["accepted", "assigned", "en_route", "in_progress"].includes(b.status),
      ),
    [data?.bookings],
  );

  const isInProgress = activeJob?.status === "in_progress";

  /**
   * The one legal next action for this job.
   *
   * Arrival does not change booking status, so the stage comes from the lifecycle
   * timestamps. Offering a single staged CTA is what stops the dashboard from becoming
   * the shortcut that skips `enRouteAt` — the anchor the ETA label is measured from,
   * and the reason only 3 of 108 completed bookings ever recorded one.
   */
  const nextAction: "en_route" | "arrived" | "start" | "complete" | null = !activeJob
    ? null
    : (() => {
        const fromPolicy = primaryActionToLocalCta(
          localActionsFromBooking(activeJob).primaryAction,
        );
        if (
          fromPolicy === "en_route" ||
          fromPolicy === "arrived" ||
          fromPolicy === "start" ||
          fromPolicy === "complete"
        ) {
          return fromPolicy;
        }
        if (isInProgress) return "complete";
        if (!activeJob.enRouteAt && ["accepted", "assigned"].includes(activeJob.status)) {
          return "en_route";
        }
        if (!activeJob.arrivedAt) return "arrived";
        return "start";
      })();

  // GPS publishing happens app-wide via <GlobalTrackingPublisher/> in PartnerShell —
  // the customer's live map updates from ANY partner screen, not just this one.

  /** Runs the staged action. The server owns every timestamp; the client only reports position. */
  async function runNextAction() {
    if (!activeJob || !nextAction) return;
    // Start requires the customer's PIN — hand off to the verification dialog.
    if (nextAction === "start") {
      setOtpDialogOpen(true);
      return;
    }
    setBusy(nextAction);
    try {
      const mode = nextAction === "arrived" ? "strict" : "soft";
      const coords = await getPartnerCoords(mode);
      if (nextAction === "arrived") {
        // Arrival is a proof of presence. With no fix from this device the server decides: it
        // records the arrival only if the customer (or support) has confirmed it, and otherwise
        // its answer says what to do.
        await arrivedMutation
          .mutateAsync({ bookingId: activeJob.id, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null })
          .catch(() => undefined);
        return;
      }
      const args = {
        bookingId: activeJob.id,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      };
      if (nextAction === "en_route") await enRouteMutation.mutateAsync(args);
      else {
        setChecklistRefusal(null);
        await completeMutation.mutateAsync(args);
      }
    } catch (error) {
      const refusal = describeCompletionRefusal(error, activeJob.id);
      if (refusal) setChecklistRefusal(refusal);
      if (!(error instanceof PartnerApiError)) {
        showToast(getErrorMessage(error), "error");
      }
    } finally {
      setBusy(null);
    }
  }

  const customerName = activeJob
    ? `${activeJob.customer.firstName ?? ""} ${activeJob.customer.lastName ?? ""}`.trim() ||
      "Customer"
    : "";

  return (
    <DashboardPanel
      title="Live Tracking"
      action={
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-partner-success">
          <span className="status-pulse h-2 w-2 rounded-full bg-partner-success" />
          {activeJob ? (isInProgress ? "In progress" : "Live") : "Idle"}
        </span>
      }
      bodyClassName="gap-4"
    >
      <div className="relative h-[280px] overflow-hidden rounded-xl bg-[#0a1628]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgb(37 99 235 / 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgb(37 99 235 / 0.08) 1px, transparent 1px)
            `,
            backgroundSize: "28px 28px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-partner-bg/90 via-transparent to-transparent" />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 400 280"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M 50 200 Q 150 150 250 120 T 350 70"
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeDasharray="10 8"
            className="route-animate"
            style={{ filter: "drop-shadow(0 0 6px rgb(37 99 235))" }}
          />
        </svg>

        <div className="absolute bottom-[30%] left-[14%]">
          <span className="status-pulse block h-4 w-4 rounded-full border-2 border-white bg-partner-primary shadow-[0_0_12px_rgb(37_99_235)]" />
        </div>
        <div className="absolute right-[16%] top-[24%]">
          <MapPin className="h-7 w-7 text-partner-danger drop-shadow-[0_0_10px_rgb(239_68_68/0.6)]" />
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-partner-card/90 px-3 py-1.5 text-xs font-medium text-partner-text backdrop-blur-sm">
          {isLoading
            ? "Loading active job…"
            : activeJob
              ? `${activeJob.eta ?? 12} min ETA`
              : "No active job"}
        </div>
      </div>

      <div className="grid grid-cols-1 items-center gap-3 rounded-xl border border-partner-primary/20 bg-partner-primary/10 p-4 sm:grid-cols-[1fr_auto_auto] sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          {isLoading ? (
            <p className="text-sm text-partner-muted">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-partner-danger">Couldn&apos;t load active job.</p>
          ) : activeJob ? (
            <>
              <Link
                href={`/requests/${activeJob.id}`}
                className="text-sm font-semibold text-partner-text hover:text-partner-primary hover:underline"
              >
                {customerName}
              </Link>
              <p className="text-[11px] text-partner-muted">{activeJob.service.name}</p>
              {activeJob.customer.phoneMasked ? (
                <p className="text-[11px] text-partner-muted">{activeJob.customer.phoneMasked}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-partner-muted">
              No active job — go online to start receiving requests.
            </p>
          )}
        </div>
        {activeJob ? (
          <p className="font-display text-base font-bold tabular-nums text-partner-accent sm:text-right">
            {formatInr(activeJob.finalAmount)}
          </p>
        ) : (
          <span />
        )}
        {activeJob && nextAction ? (
          <button
            type="button"
            onClick={runNextAction}
            disabled={busy !== null}
            className={`partner-glow-btn flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-semibold text-white disabled:opacity-60 sm:shrink-0 ${
              nextAction === "complete" ? "bg-partner-success" : "bg-partner-primary"
            }`}
          >
            {busy !== null ? (
              <span>{NEXT_ACTION[busy].busyLabel}</span>
            ) : (
              <>
                {(() => {
                  const Icon = NEXT_ACTION[nextAction].Icon;
                  return <Icon className="h-3.5 w-3.5" />;
                })()}
                {NEXT_ACTION[nextAction].label}
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-partner-card px-4 text-xs font-semibold text-partner-muted sm:shrink-0"
          >
            <Navigation className="h-3.5 w-3.5" />
            No job
          </button>
        )}
      </div>

      {activeJob && checklistRefusal && isInProgress ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs text-amber-900"
          data-testid="complete-checklist-refusal"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Checklist not complete</p>
            <p>{checklistRefusal.message}</p>
            <Link href={checklistRefusal.href} className="mt-1 inline-block font-semibold underline">
              Open the job page
            </Link>
          </div>
        </div>
      ) : null}

      {activeJob ? (
        <div className="grid grid-cols-2 gap-2">
          <CallCustomerButton
            bookingId={activeJob.id}
            phoneMasked={activeJob.customer.phoneMasked}
          />
          <Link
            href={`/requests/${activeJob.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-partner-line px-4 py-2.5 text-xs font-semibold text-partner-text transition hover:border-partner-primary/50"
          >
            <MessageSquare className="h-3.5 w-3.5 text-partner-primary" />
            Chat
          </Link>
        </div>
      ) : null}

      {otpDialogOpen && activeJob && (
        <StartJobOtpDialog
          bookingId={activeJob.id}
          customerName={customerName || "the customer"}
          onClose={() => setOtpDialogOpen(false)}
          onStart={async (otp) => {
            setBusy("start");
            try {
              const coords = await getPartnerCoords("strict");
              // With no fix from this device the server decides (see arrival above).
              await startMutation.mutateAsync({
                bookingId: activeJob.id,
                latitude: coords?.latitude ?? null,
                longitude: coords?.longitude ?? null,
                otp,
              });
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </DashboardPanel>
  );
}

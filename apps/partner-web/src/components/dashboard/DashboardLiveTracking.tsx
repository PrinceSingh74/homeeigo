"use client";

import { useMemo, useState } from "react";
import {
  MapPin,
  MapPinCheck,
  Navigation,
  PlayCircle,
  CheckCircle2,
} from "lucide-react";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import {
  useCompleteBookingMutation,
  useMarkArrivedMutation,
  useMarkEnRouteMutation,
  usePartnerActiveBookingsQuery,
  useStartBookingMutation,
} from "@/hooks/use-partner-data";
import { formatInr } from "@/lib/format";

/** Presentation for each lifecycle stage — keeps the CTA a lookup, not a ternary chain. */
const NEXT_ACTION = {
  en_route: { label: "On my way", busyLabel: "Saving…", Icon: Navigation },
  arrived: { label: "I've arrived", busyLabel: "Saving…", Icon: MapPinCheck },
  start: { label: "Start job", busyLabel: "Starting…", Icon: PlayCircle },
  complete: { label: "Mark complete", busyLabel: "Completing…", Icon: CheckCircle2 },
} as const;

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

export function DashboardLiveTracking() {
  const { data, isLoading, isError } = usePartnerActiveBookingsQuery();

  const startMutation = useStartBookingMutation();
  const completeMutation = useCompleteBookingMutation();
  const enRouteMutation = useMarkEnRouteMutation();
  const arrivedMutation = useMarkArrivedMutation();
  const [busy, setBusy] = useState<
    "start" | "complete" | "en_route" | "arrived" | null
  >(null);

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
    : isInProgress
      ? "complete"
      : !activeJob.enRouteAt && ["accepted", "assigned"].includes(activeJob.status)
        ? "en_route"
        : !activeJob.arrivedAt
          ? "arrived"
          : "start";

  // GPS publishing happens app-wide via <GlobalTrackingPublisher/> in PartnerShell —
  // the customer's live map updates from ANY partner screen, not just this one.

  /** Runs the staged action. The server owns every timestamp; the client only reports position. */
  async function runNextAction() {
    if (!activeJob || !nextAction) return;
    setBusy(nextAction);
    try {
      const coords = await getCurrentCoords();
      const args = {
        bookingId: activeJob.id,
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      if (nextAction === "en_route") await enRouteMutation.mutateAsync(args);
      else if (nextAction === "arrived") await arrivedMutation.mutateAsync(args);
      else if (nextAction === "start") await startMutation.mutateAsync(args);
      else await completeMutation.mutateAsync(args);
    } catch {
      /* mutation onError surfaces the toast — avoid an uncaught PartnerApiError */
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
              <p className="text-sm font-semibold text-partner-text">{customerName}</p>
              <p className="text-[11px] text-partner-muted">{activeJob.service.name}</p>
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
    </DashboardPanel>
  );
}

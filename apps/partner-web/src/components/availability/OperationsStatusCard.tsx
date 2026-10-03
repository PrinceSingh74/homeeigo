"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerApi } from "@/services/partner-api";
import { partnerKeys, usePartnerOperationsQuery, useSetOnlineMutation } from "@/hooks/use-partner-data";
import { usePartnerPresenceHeartbeat } from "@/hooks/use-partner-presence-heartbeat";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { cn } from "@/lib/cn";

const PAUSE_REASONS = [
  { id: "break", label: "Break" },
  { id: "personal", label: "Personal" },
  { id: "travel", label: "Travel" },
  { id: "other", label: "Other" },
] as const;

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  available: { label: "Online", detail: "Available for jobs" },
  offered: { label: "Online", detail: "Job offer pending your response" },
  accepting: { label: "Online", detail: "Accepted — preparing to travel" },
  en_route: { label: "Online", detail: "En route to a job" },
  on_job: { label: "Online", detail: "On a job — current work continues if you pause" },
  paused: { label: "Paused", detail: "New offers are paused. Current jobs continue." },
  offline: { label: "Offline", detail: "You're not receiving new job offers." },
};

function dispatchVisibilityCopy(
  dispatchable: boolean,
  presence: { connected: boolean; reconnecting: boolean; lastHeartbeatAt: string | null; presenceFreshness: string },
): { text: string; tone: "ok" | "warn" } | null {
  if (!dispatchable) return null;
  if (presence.reconnecting && (presence.presenceFreshness === "FRESH" || !presence.lastHeartbeatAt)) {
    return { text: "Connection lost — reconnecting…", tone: "warn" };
  }
  if (presence.presenceFreshness !== "FRESH") {
    return { text: "You're currently not receiving new jobs", tone: "warn" };
  }
  if (presence.connected) return { text: "You're visible for new jobs", tone: "ok" };
  if (presence.reconnecting) return { text: "Connection lost — reconnecting…", tone: "warn" };
  return null;
}

export function OperationsStatusCard() {
  const ops = usePartnerOperationsQuery();
  const presence = usePartnerPresenceHeartbeat();
  const setOnline = useSetOnlineMutation();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.showToast);
  const [pauseOpen, setPauseOpen] = useState(false);

  const pause = useMutation({
    mutationFn: (reason: string) => partnerApi.pause(reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.operations });
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
      toast("New offers paused", "success");
      setPauseOpen(false);
    },
    onError: (e) => toast(getErrorMessage(e), "error"),
  });
  const resume = useMutation({
    mutationFn: () => partnerApi.resume(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.operations });
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
      toast("You're available again", "success");
    },
    onError: (e) => toast(getErrorMessage(e), "error"),
  });

  if (ops.isLoading) {
    return (
      <PartnerCard glass className="min-h-[220px]">
        <p className="text-sm text-partner-muted">Loading availability…</p>
      </PartnerCard>
    );
  }

  const data = ops.data;
  const status = data?.operationalStatus === "accepting_job" ? "accepting" : (data?.operationalStatus ?? "offline");
  const copy = STATUS_COPY[status] ?? STATUS_COPY.offline;
  const online = Boolean(data?.uiOnline && status !== "paused" && !data?.isSuspended);
  const busy = setOnline.isPending || pause.isPending || resume.isPending;
  const visibility = dispatchVisibilityCopy(
    online && status !== "offline",
    presence,
  );

  return (
    <PartnerCard glass className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-partner-muted">Status</p>
          <p className="mt-2 flex items-center gap-2 font-display text-3xl font-semibold tracking-tight">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 rounded-full",
                data?.isSuspended && "bg-partner-danger",
                status === "paused" && "bg-partner-warning",
                status === "offline" && "bg-partner-muted",
                online && "bg-partner-success",
              )}
              aria-hidden
            />
            {copy.label}
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-partner-muted">{copy.detail}</p>
          {visibility ? (
            <p
              className={cn(
                "mt-2 max-w-md text-sm font-medium",
                visibility.tone === "ok" ? "text-partner-success" : "text-partner-warning",
              )}
            >
              {visibility.text}
            </p>
          ) : null}
        </div>
        {data?.capacity ? (
          <p className="text-right text-sm text-partner-muted">
            {data.capacity.currentJobs} / {data.capacity.maxConcurrentJobs} capacity
            <span className="mt-1 block text-xs">{data.preferredAreaLabel}</span>
          </p>
        ) : null}
      </div>

      {data?.isSuspended ? (
        <div className="rounded-xl border border-partner-danger/20 bg-partner-danger/5 p-4">
          <p className="font-semibold text-partner-danger">Account restricted</p>
          <p className="mt-1 text-sm text-partner-muted">{data.suspendedMessage}</p>
          <a href="/trust-compliance" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-partner-primary">
            Contact Support
          </a>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === "paused" ? (
            <PartnerButton className="min-h-11" onClick={() => resume.mutate()} disabled={busy}>
              Resume
            </PartnerButton>
          ) : online ? (
            <>
              <PartnerButton
                variant="outline"
                className="min-h-11"
                onClick={() => void setOnline.mutate(false)}
                disabled={busy}
              >
                Go Offline
              </PartnerButton>
              <PartnerButton variant="outline" className="min-h-11" onClick={() => setPauseOpen((v) => !v)} disabled={busy}>
                Pause
              </PartnerButton>
            </>
          ) : (
            <PartnerButton
              variant="success"
              className="min-h-11"
              onClick={() => void setOnline.mutate(true)}
              disabled={busy}
            >
              Go Online
            </PartnerButton>
          )}
        </div>
      )}

      {!data?.readiness.ready && !online ? (
        <ul className="space-y-1 text-sm text-partner-warning">
          {data?.readiness.blockers.map((b) => (
            <li key={b.code}>{b.message}</li>
          ))}
        </ul>
      ) : null}

      {pauseOpen ? (
        <div className="flex flex-wrap gap-2">
          {PAUSE_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="min-h-11 rounded-full border border-partner-line px-4 text-sm font-medium hover:border-partner-primary"
              onClick={() => pause.mutate(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}

      {data?.capacity.capacityFull ? (
        <p className="text-sm text-partner-warning">Capacity limit reached. Existing jobs continue.</p>
      ) : null}
    </PartnerCard>
  );
}

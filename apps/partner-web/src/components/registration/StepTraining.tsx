"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerRegistrationApi, type OnboardingTrainingPayload } from "@/services/partner-registration-api";
import { getErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/cn";

export function StepTraining({
  loading,
  onContinue,
}: {
  loading: boolean;
  onContinue: () => Promise<void>;
}) {
  const [data, setData] = useState<OnboardingTrainingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setData(await partnerRegistrationApi.getTraining());
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      setData(await partnerRegistrationApi.completeTrainingModule(id));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!data && !error) {
    return (
      <div className="space-y-3">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-partner-line/50" />
        <div className="h-28 animate-pulse rounded-2xl bg-partner-line/40" />
      </div>
    );
  }

  const total = data?.requiredModules || data?.modules.length || 0;
  const done = data?.completedCount ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Partner training</h2>
        <p className="mt-1 text-sm text-partner-muted">
          Same Academy used after activation. Training is required before you go live — not before submit.
        </p>
      </div>

      <div className="rounded-2xl border border-partner-line bg-white/70 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{done} / {total || "—"} modules complete</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", data?.trainingComplete ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
            {data?.trainingComplete ? "Training completed" : data && done > 0 ? "Training in progress" : "Not started"}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-partner-line">
          <div className="h-full rounded-full bg-partner-primary" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </div>
        <p className="mt-3 text-xs text-partner-muted">
          Required before activation: {data?.requiredForActivation ? "Yes" : "No published modules yet"}
        </p>
      </div>

      <div className="space-y-3">
        {(data?.modules ?? []).map((mod) => {
          const completed = Boolean(mod.completedAt);
          return (
            <article key={mod.id} className="rounded-2xl border border-partner-line bg-white/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{mod.title}</h3>
                  <p className="mt-1 text-xs uppercase tracking-wide text-partner-muted">{mod.contentType}</p>
                  {mod.body ? <p className="mt-2 line-clamp-3 text-sm text-partner-muted">{mod.body}</p> : null}
                </div>
                {completed ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Lock className="h-5 w-5 shrink-0 text-partner-muted/50" />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {mod.contentUrl ? (
                  <a href={mod.contentUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-partner-line px-3 py-2 text-sm font-semibold">
                    Open content
                  </a>
                ) : null}
                {!completed ? (
                  <PartnerButton type="button" variant="outline" disabled={busyId === mod.id} onClick={() => void complete(mod.id)}>
                    <span className="inline-flex items-center gap-2">
                      <PlayCircle className="h-4 w-4" />
                      {busyId === mod.id ? "Saving…" : "Mark complete"}
                    </span>
                  </PartnerButton>
                ) : (
                  <span className="text-sm font-medium text-emerald-700">Completed</span>
                )}
              </div>
            </article>
          );
        })}
        {data && data.modules.length === 0 ? (
          <p className="rounded-xl bg-partner-line/30 px-4 py-3 text-sm text-partner-muted">
            No published Academy modules yet. You can continue — HQ will assign training before activation if required.
          </p>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-partner-danger">{error}</p> : null}

      <PartnerButton type="button" className="w-full" disabled={loading} onClick={() => void onContinue()}>
        {loading ? "Saving…" : "Continue to review"}
      </PartnerButton>
    </div>
  );
}

"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";

export function ChangesRequestedBanner({
  stepLabel,
  notes,
  onContinue,
}: {
  stepLabel: string;
  notes?: string | null;
  onContinue?: () => void;
}) {
  return (
    <div className="partner-glass mb-6 overflow-hidden rounded-2xl border border-amber-300/80 bg-amber-50/90 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800/80">
              Action required
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-amber-950">
              HQ requested updates
            </h2>
            <p className="mt-1 text-sm text-amber-900/90">
              Please update <span className="font-semibold">{stepLabel}</span> and resubmit your
              application.
            </p>
            {notes ? (
              <p className="mt-2 rounded-lg border border-amber-200/80 bg-white/60 px-3 py-2 text-sm text-amber-950">
                {notes}
              </p>
            ) : null}
          </div>
        </div>
        {onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            Go to {stepLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

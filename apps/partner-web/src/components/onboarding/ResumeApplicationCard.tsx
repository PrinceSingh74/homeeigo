"use client";

import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { formatLastSaved } from "@/lib/onboarding-resume";

type ResumeApplicationCardProps = {
  percentComplete: number;
  resumeLabel: string;
  lastSavedAt?: string | null;
  loading?: boolean;
  mode?: "continue" | "sign-in";
  compact?: boolean;
  onContinue?: () => void;
  onSubmitCredentials?: (email: string, password: string) => void;
};

export function ResumeApplicationCard({
  percentComplete,
  resumeLabel,
  lastSavedAt,
  loading,
  mode = "continue",
  compact = false,
  onContinue,
  onSubmitCredentials,
}: ResumeApplicationCardProps) {
  const saved = formatLastSaved(lastSavedAt);

  if (mode === "sign-in") {
    const form = (
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onSubmitCredentials?.(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
        }}
      >
        <input
          name="email"
          type="email"
          required
          placeholder="Email used during registration"
          className="w-full rounded-xl border border-partner-line bg-white/80 px-3 py-2.5 text-sm outline-none ring-partner-primary focus:ring-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="w-full rounded-xl border border-partner-line bg-white/80 px-3 py-2.5 text-sm outline-none ring-partner-primary focus:ring-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-partner-primary py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Restoring…" : "Continue application"}
          {!loading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </form>
    );

    if (compact) {
      return (
        <details className="mt-8 rounded-2xl border border-partner-line bg-white/50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-partner-primary">
            Already started an application?
          </summary>
          <p className="mt-2 text-xs text-partner-muted">
            Sign in with the email and password from your first visit.
          </p>
          {form}
        </details>
      );
    }

    return (
      <div className="partner-glass mb-6 overflow-hidden rounded-2xl border border-partner-primary/20 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-partner-primary/10 text-partner-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Continue your application</h2>
            <p className="mt-1 text-sm text-partner-muted">
              Sign in with the email and password you used when you started applying.
            </p>
          </div>
        </div>
        {form}
      </div>
    );
  }

  return (
    <div className="partner-glass mb-6 overflow-hidden rounded-2xl border border-partner-primary/20 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-partner-primary">Welcome back</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Continue your application</h2>
          <p className="mt-1 text-sm text-partner-muted">
            <span className="font-semibold text-partner-text">{percentComplete}% complete</span>
            {" · "}
            Continue from {resumeLabel}
          </p>
          {saved ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-partner-muted">
              <Clock className="h-3.5 w-3.5" />
              {saved}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={onContinue}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-partner-primary px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
        >
          {loading ? "Loading…" : "Continue"}
          {!loading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-partner-line">
        <div
          className="h-full rounded-full bg-partner-primary transition-all duration-300"
          style={{ width: `${percentComplete}%` }}
        />
      </div>
    </div>
  );
}

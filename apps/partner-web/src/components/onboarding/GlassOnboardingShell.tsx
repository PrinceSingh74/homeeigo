"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function GlassOnboardingShell({
  title,
  subtitle,
  progress,
  percentComplete,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  progress?: ReactNode;
  percentComplete?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#fafbff] via-[#fcf9f0] to-white px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-partner-muted">HOMEEIGO Partner</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-partner-text md:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm text-partner-muted">{subtitle}</p> : null}
          {typeof percentComplete === "number" ? (
            <div className="mx-auto mt-5 max-w-md">
              <div className="mb-2 flex justify-between text-xs font-medium text-partner-muted">
                <span>Progress</span>
                <span>{percentComplete}% complete</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-partner-line">
                <div
                  className="h-full rounded-full bg-partner-primary transition-all duration-300"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {progress ? (
            <aside className="partner-glass hidden rounded-2xl border border-partner-line p-5 lg:block">{progress}</aside>
          ) : null}
          <div className="partner-glass rounded-2xl border border-partner-line p-6 shadow-partner-card md:p-8">
            {children}
            {footer ? <div className="mt-8 border-t border-partner-line pt-6">{footer}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GlassStepper({
  steps,
  current,
  completed,
}: {
  steps: Array<{ id: string; label: string }>;
  current: string;
  completed: string[];
}) {
  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const done = completed.includes(step.id);
        const active = step.id === current;
        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
              active && "bg-partner-primary/10 font-semibold text-partner-primary",
              done && !active && "text-partner-success",
              !done && !active && "text-partner-muted",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                done ? "bg-partner-success/15 text-partner-success" : active ? "bg-partner-primary text-white" : "bg-partner-line text-partner-muted",
              )}
            >
              {done ? "✓" : steps.findIndex((s) => s.id === step.id) + 1}
            </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

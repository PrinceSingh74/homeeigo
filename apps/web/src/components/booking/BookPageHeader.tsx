"use client";

import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { pageMax, pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

const STEPS = ["Service", "Package", "Schedule", "Payment"] as const;

function BookingStepper({ currentStep }: { currentStep: number }) {
  return (
    <nav
      aria-label="Booking progress"
      className="flex w-full min-w-0 items-center justify-between gap-1 sm:justify-center sm:gap-0"
    >
      {STEPS.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const upcoming = i > currentStep;

        return (
          <div key={label} className="flex min-w-0 flex-1 items-center sm:flex-none">
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:flex-none sm:flex-row sm:gap-2",
                active && "sm:rounded-full sm:bg-primary/8 sm:px-3 sm:py-1.5",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-all duration-300 sm:size-8 sm:text-xs",
                  done && "bg-success text-white shadow-[0_4px_12px_rgb(16_185_129/0.35)]",
                  active &&
                    "bg-aurora text-white shadow-[0_4px_16px_rgb(37_99_235/0.4)] ring-2 ring-primary/20 ring-offset-2 ring-offset-canvas",
                  upcoming && "border border-line bg-surface text-muted",
                )}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "max-w-[4.5rem] truncate text-center text-[10px] font-semibold leading-tight sm:max-w-none sm:text-xs",
                  active ? "text-primary" : done ? "text-success" : "text-muted",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <div
                aria-hidden
                className={cn(
                  "mx-0.5 h-0.5 min-w-[0.75rem] flex-1 rounded-full sm:mx-2 sm:h-px sm:w-8 sm:flex-none md:w-12 lg:w-16",
                  i < currentStep ? "bg-gradient-to-r from-success to-primary" : "bg-line",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function BookPageHeader({ currentStep }: { currentStep: number }) {
  const stepLabel = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <header
      className={cn(
        "sticky z-40 border-b border-line/50",
        "top-[calc(3.5rem+env(safe-area-inset-top,0px))]",
        "bg-canvas/90 backdrop-blur-xl supports-[backdrop-filter]:bg-canvas/75",
        "shadow-[0_8px_32px_-24px_rgb(15_23_42/0.12)]",
      )}
    >
      <div className={cn(pageMax, pagePadX, "py-2.5 sm:py-3.5")}>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Back to home"
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              "border border-line/80 bg-surface/90 text-content shadow-e1",
              "transition hover:border-primary/30 hover:shadow-[0_4px_16px_rgb(37_99_235/0.12)]",
              "sm:size-11 sm:rounded-2xl",
            )}
          >
            <ArrowLeft size={18} className="sm:hidden" />
            <ArrowLeft size={20} className="hidden sm:block" />
          </Link>

          <div className="min-w-0 flex-1">
            <p className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-muted sm:block sm:text-[11px]">
              Secure booking
            </p>
            <h1 className="font-display text-base font-bold tracking-tight text-content sm:text-xl lg:text-2xl">
              Book a <span className="text-aurora">Service</span>
            </h1>
          </div>

          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Step {currentStep + 1} of {STEPS.length}
            </p>
            <p className="font-display text-sm font-bold text-primary">{stepLabel}</p>
          </div>
        </div>

        <div className="mt-2.5 sm:mt-4">
          <div
            className="mb-3 h-1 overflow-hidden rounded-full bg-line/70 sm:hidden"
            role="progressbar"
            aria-valuenow={currentStep + 1}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-label={`Booking step ${currentStep + 1} of ${STEPS.length}: ${stepLabel}`}
          >
            <div
              className="h-full rounded-full bg-aurora transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="rounded-2xl border border-line/60 bg-surface/50 p-2 shadow-e1 backdrop-blur-sm sm:p-3 dark:bg-surface/40">
            <BookingStepper currentStep={currentStep} />
          </div>
        </div>
      </div>
    </header>
  );
}

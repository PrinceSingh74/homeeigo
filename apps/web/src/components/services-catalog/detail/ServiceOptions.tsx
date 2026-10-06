"use client";

import { Check, Minus, Plus } from "lucide-react";
import { formatInr, spokenInr, unitWord, type Addon } from "@/lib/catalog";
import type { QuantityRule } from "@/types/backend";
import { focusRing } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

export type OptionChoice = { id: string; name: string; tag?: string; price: number; priceSuffix?: string };

/**
 * "Choose your option" — either the admin-configured variants or, for services
 * without variants, the price tiers the booking API charges (min / base / max,
 * matching /book's Basic / Standard / Premium).
 */
export function ServiceVariantSelector({
  options,
  value,
  onChange,
  label = "Service option",
}: {
  options: OptionChoice[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex min-h-28 flex-col justify-between gap-4 rounded-2xl border-2 p-4 text-left",
              "motion-safe:transition-[border-color,background-color] motion-safe:duration-200",
              focusRing,
              on
                ? "border-emerald-700 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-500/10"
                : "border-line bg-surface hover:border-emerald-600/50",
            )}
          >
            <span className="flex w-full items-start gap-3">
              {/* A real radio mark: empty ring when off, filled with a tick when on. */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2",
                  on ? "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950" : "border-muted/60",
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={3.5} />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-content">{o.name}</span>
                {o.tag && <span className="block text-sm text-muted">{o.tag}</span>}
              </span>
            </span>
            <span className="flex w-full items-baseline justify-between gap-3">
              <span className="font-display text-2xl font-bold tabular-nums tracking-tight text-content">
                <span aria-hidden>
                  {formatInr(o.price)}
                  {o.priceSuffix && <span className="font-sans text-sm font-medium tracking-normal text-muted"> {o.priceSuffix}</span>}
                </span>
                <span className="sr-only">
                  {spokenInr(o.price)} {o.priceSuffix ?? ""}
                </span>
              </span>
              {on && (
                <span aria-hidden className="text-sm font-semibold text-brand">
                  Selected
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Accessible stepper for UNIT / SEAT / AREA / PACKAGE quantities (bounds from the backend rule). */
export function QuantitySelector({
  rule,
  min,
  max,
  step,
  value,
  onChange,
}: {
  rule: QuantityRule;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const btn = cn(
    "grid size-11 place-items-center rounded-full bg-surface text-content shadow-e1",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none hover:text-brand",
    focusRing,
  );
  const word = unitWord(rule, value);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div
        className="inline-flex items-center gap-2 rounded-full border-2 border-line bg-canvas p-1.5"
        role="group"
        aria-label={`Number of ${rule.unitLabelPlural ?? rule.unitLabel}`}
      >
        <button type="button" className={btn} onClick={() => onChange(value - step)} disabled={value - step < min} aria-label={`Fewer ${rule.unitLabelPlural ?? rule.unitLabel}`}>
          <Minus className="size-4" aria-hidden />
        </button>
        <output className="min-w-28 text-center font-display text-2xl font-bold tabular-nums tracking-tight text-content" aria-live="polite">
          {value} <span className="font-sans text-sm font-medium tracking-normal text-muted">{word}</span>
        </output>
        <button type="button" className={btn} onClick={() => onChange(value + step)} disabled={value + step > max} aria-label={`More ${rule.unitLabelPlural ?? rule.unitLabel}`}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-sm text-muted">
        {min}–{max} {rule.unitLabelPlural ?? rule.unitLabel}
        {step > 1 ? `, in steps of ${step}` : ""}
      </p>
    </div>
  );
}

/** Why the server says an add-on cannot be taken with the current selection. */
const ADDON_REASON: Record<string, string> = {
  ADDON_INCOMPATIBLE: "Not available with the option you chose",
  ADDON_CONFLICT: "Can't be combined with another add-on you picked",
};

/**
 * Add-ons from the service's own catalogue (or the shared one); the server re-prices them.
 * `availability` is the server's verdict for the current selection. An add-on that becomes
 * unavailable while selected stays selected and says why — it is never silently removed.
 */
export function ServiceAddons({
  addons,
  selected,
  onToggle,
  availability,
}: {
  addons: readonly Addon[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  availability?: ReadonlyMap<string, { available: boolean; reason: string | null }>;
}) {
  if (!addons.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {addons.map((a) => {
        const on = selected.has(a.id);
        const verdict = availability?.get(a.id);
        const unavailable = verdict ? !verdict.available : false;
        const reason = unavailable ? (ADDON_REASON[verdict?.reason ?? ""] ?? "Not available right now") : null;
        return (
          <li key={a.id}>
            <button
              type="button"
              aria-pressed={on}
              aria-disabled={unavailable && !on}
              disabled={unavailable && !on}
              aria-describedby={reason ? `addon-reason-${a.id}` : undefined}
              onClick={() => onToggle(a.id)}
              className={cn(
                "flex min-h-16 w-full items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left",
                "motion-safe:transition-[border-color,background-color] motion-safe:duration-200",
                focusRing,
                on
                  ? "border-emerald-700 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-500/10"
                  : "border-line bg-surface hover:border-emerald-600/50",
                unavailable && !on && "cursor-not-allowed opacity-50 hover:border-line",
                unavailable && on && "border-amber-500 dark:border-amber-500",
              )}
            >
              {/* A checkbox mark (square), so it reads differently from the single-choice radios. */}
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-xs border-2",
                  on ? "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950" : "border-muted/60",
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={3.5} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-content">{a.name}</span>
                {a.desc && <span className="block text-sm text-muted">{a.desc}</span>}
                {on && !reason && (
                  <span aria-hidden className="block text-sm font-semibold text-brand">
                    Added
                  </span>
                )}
                {reason && (
                  <span id={`addon-reason-${a.id}`} className="mt-0.5 block text-sm font-medium text-amber-700 dark:text-amber-400">
                    {reason}
                    {on ? " — remove it to continue" : ""}
                  </span>
                )}
              </span>
              <span className="font-display text-lg font-bold tabular-nums text-content">
                <span aria-hidden>+{formatInr(a.price)}</span>
                <span className="sr-only">adds {spokenInr(a.price)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

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
              "relative flex min-h-24 flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-left",
              "motion-safe:transition-[border-color,box-shadow] motion-safe:duration-200",
              focusRing,
              on
                ? "border-emerald-500 bg-emerald-50/60 shadow-e2 ring-1 ring-emerald-500 dark:bg-emerald-500/10"
                : "border-line bg-surface hover:border-emerald-300",
            )}
          >
            <span className="pr-6">
              <span className="block font-semibold text-content">{o.name}</span>
              {o.tag && <span className="block text-xs text-muted">{o.tag}</span>}
            </span>
            <span className="font-display text-lg font-bold tabular-nums text-content">
              <span aria-hidden>
                {formatInr(o.price)}
                {o.priceSuffix && <span className="text-sm font-medium text-muted"> {o.priceSuffix}</span>}
              </span>
              <span className="sr-only">
                {spokenInr(o.price)} {o.priceSuffix ?? ""}
              </span>
            </span>
            {on && (
              <span aria-hidden className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-emerald-600 text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
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
    "grid size-11 place-items-center rounded-full border border-line bg-surface text-content",
    "disabled:cursor-not-allowed disabled:opacity-40 hover:border-emerald-300",
    focusRing,
  );
  const word = unitWord(rule, value);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="inline-flex items-center gap-3" role="group" aria-label={`Number of ${rule.unitLabelPlural ?? rule.unitLabel}`}>
        <button type="button" className={btn} onClick={() => onChange(value - step)} disabled={value - step < min} aria-label={`Fewer ${rule.unitLabelPlural ?? rule.unitLabel}`}>
          <Minus className="size-4" aria-hidden />
        </button>
        <output className="min-w-24 text-center font-display text-lg font-bold tabular-nums text-content" aria-live="polite">
          {value} <span className="text-sm font-medium text-muted">{word}</span>
        </output>
        <button type="button" className={btn} onClick={() => onChange(value + step)} disabled={value + step > max} aria-label={`More ${rule.unitLabelPlural ?? rule.unitLabel}`}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-xs text-muted">
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
                "flex w-full items-center gap-4 rounded-2xl border p-4 text-left",
                "motion-safe:transition-[border-color,background-color] motion-safe:duration-200",
                focusRing,
                on ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-500/10" : "border-line bg-surface hover:border-emerald-300",
                unavailable && !on && "cursor-not-allowed opacity-50 hover:border-line",
                unavailable && on && "border-amber-500",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border",
                  on ? "border-transparent bg-emerald-600 text-white" : "border-line text-muted",
                )}
              >
                {on ? <Check className="size-4" strokeWidth={2.5} /> : <Plus className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-content">{a.name}</span>
                {a.desc && <span className="block text-xs text-muted">{a.desc}</span>}
                {reason && (
                  <span id={`addon-reason-${a.id}`} className="mt-0.5 block text-xs font-medium text-amber-700 dark:text-amber-400">
                    {reason}
                    {on ? " — remove it to continue" : ""}
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums text-content">
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

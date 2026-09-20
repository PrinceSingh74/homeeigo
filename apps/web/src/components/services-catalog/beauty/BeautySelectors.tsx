"use client";

import Link from "next/link";
import { Baby, Sparkle, User, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AUDIENCES,
  BEAUTY_TYPES,
  audienceHref,
  type Audience,
  type BeautyType,
  type ServiceView,
} from "@/lib/catalog";
import type { ProfessionalPreference } from "@/types/backend";
import { focusRing, pillActive, pillBase, pillIdle } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

const AUDIENCE_ICON: Record<Audience, LucideIcon> = {
  women: UserRound,
  men: User,
  girls: Sparkle,
  boys: Baby,
  "senior-women": Users,
  "senior-men": Users,
};

/**
 * "Who is this for?" — the first step of the beauty flow. In link mode each
 * audience is its own page; in select mode it is a radio group.
 */
export function BeautyAudienceSelector({
  active,
  counts,
  mode = "link",
  onSelect,
  heading = "Who is this for?",
  allowed,
}: {
  /** Config-driven eligibility; omit to offer every audience. */
  allowed?: Audience[];
  active?: Audience;
  counts?: Partial<Record<Audience, number>>;
  mode?: "link" | "select";
  onSelect?: (a: Audience) => void;
  heading?: string;
}) {
  const tile = (on: boolean) =>
    cn(
      "group flex min-h-24 flex-col justify-between gap-3 rounded-2xl border p-4 text-left",
      "motion-safe:transition-[border-color,box-shadow,transform] motion-safe:duration-300",
      focusRing,
      on
        ? "border-transparent bg-ink text-white shadow-e3 dark:bg-emerald-400 dark:text-ink"
        : "border-line bg-surface text-content hover:border-rose-200 hover:shadow-e2 motion-safe:hover:-translate-y-0.5",
    );

  const body = (a: (typeof AUDIENCES)[number], on: boolean) => {
    const Icon = AUDIENCE_ICON[a.id];
    return (
      <>
        <Icon className={cn("size-5", on ? "" : "text-rose-600")} aria-hidden strokeWidth={1.75} />
        <span>
          <span className="block font-semibold">{a.name}</span>
          <span className={cn("block text-xs", on ? "opacity-80" : "text-muted")}>
            {a.hint}
            {counts?.[a.id] != null && ` · ${counts[a.id]} services`}
          </span>
        </span>
      </>
    );
  };

  if (mode === "select") {
    return (
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-content">{heading}</legend>
        <div role="radiogroup" aria-label={heading} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {AUDIENCES.filter((a) => !allowed || allowed.includes(a.id)).map((a) => {
            const on = active === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onSelect?.(a.id)}
                className={tile(on)}
              >
                {body(a, on)}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <nav aria-label={heading}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {AUDIENCES.map((a) => {
          const on = active === a.id;
          return (
            <li key={a.id}>
              <Link href={audienceHref(a.id)} prefetch={false} aria-current={on ? "page" : undefined} className={cn(tile(on), "h-full")}>
                {body(a, on)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Second step: Hair / Skin / Waxing / Nails / Makeup / Grooming / Spa / Bridal. */
export function BeautyCategorySelector({
  services,
  active,
  onSelect,
}: {
  services: ServiceView[];
  active?: BeautyType;
  onSelect: (t: BeautyType | undefined) => void;
}) {
  const present = BEAUTY_TYPES.filter((t) => services.some((s) => s.beautyType === t.id));
  if (present.length < 2) return null;
  return (
    <div role="group" aria-label="Service type" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
      <button
        type="button"
        aria-pressed={!active}
        onClick={() => onSelect(undefined)}
        className={cn(pillBase, !active ? pillActive : pillIdle)}
      >
        All
      </button>
      {present.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? undefined : t.id)}
            className={cn(pillBase, on ? pillActive : pillIdle)}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

const PREFERENCE_LABEL: Record<ProfessionalPreference, string> = {
  NO_PREFERENCE: "No preference",
  FEMALE: "Woman professional",
  MALE: "Man professional",
};

/**
 * Professional preference — only the options the server publishes for this
 * service (it strips them while assignment cannot honour a preference). With
 * nothing supported, a plain line says so instead of a disabled choice.
 */
export function BeautyProfessionalSelector({
  options,
  value,
  onChange,
}: {
  options?: ProfessionalPreference[];
  value?: ProfessionalPreference;
  onChange?: (p: ProfessionalPreference) => void;
}) {
  const real = (options ?? []).filter((o) => o !== "NO_PREFERENCE");
  if (!real.length) {
    return <p className="text-sm text-muted">No professional preference available for this service.</p>;
  }
  const all: ProfessionalPreference[] = ["NO_PREFERENCE", ...real];
  const current = value ?? "NO_PREFERENCE";
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-content">Professional preference</legend>
      <div role="radiogroup" aria-label="Professional preference" className="flex flex-wrap gap-2">
        {all.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={current === o}
            onClick={() => onChange?.(o)}
            className={cn(pillBase, "min-h-10", current === o ? pillActive : pillIdle)}
          >
            {PREFERENCE_LABEL[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

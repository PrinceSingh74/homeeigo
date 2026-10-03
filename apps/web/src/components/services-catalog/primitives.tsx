import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { PRICING_MODEL_LABEL, formatInr, spokenInr, type PricingModel } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/* Shared class vocabulary — one definition per visual role. */
export const cardSurface = "rounded-2xl border border-line bg-surface shadow-e1";
export const cardHover =
  "motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300 motion-safe:ease-[var(--ease-out-soft)] hover:border-emerald-200 hover:shadow-e3 motion-safe:hover:-translate-y-1 dark:hover:border-emerald-500/30";
export const eyebrow = "text-xs font-semibold uppercase tracking-[0.14em] text-brand";
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
export const pillBase = cn(
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium",
  "motion-safe:transition-colors motion-safe:duration-200",
  focusRing,
);
export const pillIdle =
  "border-line bg-surface text-content hover:border-emerald-300 hover:text-brand dark:hover:border-emerald-500/40";
export const pillActive =
  "border-transparent bg-ink text-white shadow-e2 dark:bg-emerald-400 dark:text-ink";

export function IconTile({
  icon: Icon,
  tone,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  tone: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("grid place-items-center rounded-xl", className)}
      style={{ backgroundColor: `${tone}14`, color: tone }}
    >
      <Icon className={cn("size-5", iconClassName)} strokeWidth={1.75} />
    </span>
  );
}

/** Large illustrative panel used where a service has no curated photo. */
export function IconArt({ icon: Icon, tone, muted }: { icon: LucideIcon; tone: string; muted?: boolean }) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 grid place-items-center overflow-hidden"
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, ${tone}24 0%, transparent 60%), radial-gradient(100% 80% at 90% 100%, ${tone}1a 0%, transparent 55%)`,
      }}
    >
      <span
        className="absolute size-40 rounded-full border"
        style={{ borderColor: `${tone}26` }}
      />
      <span
        className="absolute size-64 rounded-full border"
        style={{ borderColor: `${tone}14` }}
      />
      <span
        className={cn(
          "relative grid size-16 place-items-center rounded-2xl bg-surface/90 shadow-e2 backdrop-blur-sm",
          "motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105",
          muted && "opacity-80",
        )}
        style={{ color: tone }}
      >
        <Icon className="size-7" strokeWidth={1.6} />
      </span>
    </div>
  );
}

export function ModelChip({ model, className }: { model: PricingModel; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs font-medium text-muted",
        className,
      )}
    >
      {PRICING_MODEL_LABEL[model]}
    </span>
  );
}

/** Amount that re-animates when it changes and is announced politely. */
export function AnimatedPrice({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cn("inline-block tabular-nums", className)} aria-live="polite" aria-atomic>
      <span key={amount} className="inline-block motion-safe:animate-price-tick" aria-hidden>
        {formatInr(amount)}
      </span>
      <span className="sr-only">{spokenInr(amount)}</span>
    </span>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-content/70">
        {items.map((it, i) => (
          <li key={it.label + i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />}
            {it.href ? (
              <Link href={it.href} className={cn("truncate rounded-md hover:text-content", focusRing)}>
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-content">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SectionHeading({
  id,
  kicker,
  title,
  subtitle,
  action,
  as: Tag = "h2",
}: {
  id?: string;
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8">
      <div className="min-w-0 max-w-2xl">
        {kicker && <p className={cn(eyebrow, "mb-2")}>{kicker}</p>}
        <Tag id={id} className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
          {title}
        </Tag>
        {subtitle && <p className="mt-2 text-base leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

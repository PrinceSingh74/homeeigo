import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Clock } from "lucide-react";
import {
  CATEGORY_BY_ID,
  PRICING_MODEL_LABEL,
  audienceSummary,
  formatDuration,
  priceText,
  type ServiceView,
} from "@/lib/catalog";
import { IconArt, cardHover, cardSurface } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

type Badge = { label: string; tone: "brand" | "neutral" | "soon" };

/** At most one badge per card — the most useful fact wins. */
function badgeFor(svc: ServiceView): Badge | null {
  if (svc.status !== "live") return { label: "Coming soon", tone: "soon" };
  if (svc.hourly) return { label: "Hourly", tone: "brand" };
  if (svc.premiumOnly) return { label: "Members", tone: "neutral" };
  if (svc.popular) return { label: "Popular", tone: "brand" };
  return null;
}

const BADGE_STYLE: Record<Badge["tone"], string> = {
  brand: "bg-surface/95 text-brand",
  neutral: "bg-ink/85 text-white",
  soon: "bg-surface/95 text-content",
};

type Props = {
  service: ServiceView;
  /** Shown above the title — defaults to the category (or audience for beauty). */
  context?: string;
  /** First cards on a page load eagerly for LCP. */
  priority?: boolean;
  className?: string;
  /** Override link (e.g. with ?for=<audience>); defaults to the canonical page. */
  href?: string;
};

export const ServiceCard = memo(function ServiceCard({ service: svc, context, priority, className, href }: Props) {
  const live = svc.status === "live";
  const price = priceText(svc);
  const duration = live ? formatDuration(svc.durationMin) : null;
  const badge = badgeFor(svc);
  const label =
    context ??
    (svc.category === "beauty" ? audienceSummary(svc.audiences) : null) ??
    CATEGORY_BY_ID.get(svc.category)?.shortName;

  return (
    <article className={cn("group relative flex h-full flex-col overflow-hidden", cardSurface, cardHover, className)}>
      <div className="relative aspect-[4/3] overflow-hidden bg-canvas">
        {live && svc.image ? (
          <Image
            src={svc.image}
            alt=""
            fill
            priority={priority}
            sizes="(max-width: 640px) 80vw, (max-width: 1024px) 45vw, 300px"
            className="object-cover object-[50%_25%] motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-[var(--ease-out-soft)] motion-safe:group-hover:scale-[1.04]"
          />
        ) : (
          <IconArt icon={svc.icon} tone={svc.tone} muted={!live} />
        )}
        {badge && (
          <span
            className={cn(
              "absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold shadow-e1 backdrop-blur-sm",
              BADGE_STYLE[badge.tone],
            )}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {label && <p className="text-xs font-medium text-muted">{label}</p>}
        <h3 className="mt-1 font-display text-lg font-semibold leading-snug text-content">
          <Link
            href={href ?? svc.href}
            prefetch={false}
            className="rounded-md outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand/60"
          >
            {svc.name}
          </Link>
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{svc.description}</p>

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="min-w-0">
            <p className={cn("tabular-nums", live ? "text-base font-semibold text-content" : "text-sm font-medium text-muted")}>
              <span aria-hidden>{price.label}</span>
              <span className="sr-only">Price: {price.spoken}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span>{PRICING_MODEL_LABEL[svc.pricingModel]}</span>
              {duration && (
                <>
                  <span aria-hidden className="size-0.5 rounded-full bg-muted" />
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden />
                    <span className="sr-only">Duration:</span>
                    {duration}
                  </span>
                </>
              )}
            </p>
          </div>
          <span
            aria-hidden
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full border border-line text-content",
              "motion-safe:transition-colors motion-safe:duration-300",
              live
                ? "group-hover:border-transparent group-hover:bg-emerald-600 group-hover:text-white"
                : "group-hover:border-emerald-300 group-hover:text-brand",
            )}
          >
            <ArrowUpRight className="size-4" />
          </span>
        </div>
      </div>
    </article>
  );
});

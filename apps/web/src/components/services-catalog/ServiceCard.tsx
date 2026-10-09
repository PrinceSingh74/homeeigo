"use client";

import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock } from "lucide-react";
import { trackServiceClick } from "@/lib/analytics/service-click";
import {
  CATEGORY_BY_ID,
  PRICING_MODEL_LABEL,
  audienceSummary,
  formatDuration,
  priceText,
  serviceHrefFor,
  type ServiceView,
} from "@/lib/catalog";
import { IconTile, cardHover } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/** At most one badge per card — the most useful fact wins. */
function badgeFor(svc: ServiceView): string | null {
  if (svc.hourly) return "Hourly";
  if (svc.premiumOnly) return "Members";
  if (svc.popular) return "Popular";
  return null;
}

type Props = {
  service: ServiceView;
  /** Shown above the title — defaults to the category (or audience for beauty). */
  context?: string;
  /** First cards on a page load eagerly for LCP. */
  priority?: boolean;
  className?: string;
  /** Override link (e.g. with ?for=<audience>); defaults to the canonical page. */
  href?: string;
  /** The lead card of a feature layout: larger type, and the photo fills the spare height. */
  feature?: boolean;
};

const cardLink =
  "rounded-md outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand/60";

/**
 * A bookable service is a photo card with its price on a ticket stub. A bookable service
 * without a photo is a text-led card (small icon mark, no empty art panel). A service that
 * is not bookable yet is never a photo card — see `ServiceSoonList`.
 */
export const ServiceCard = memo(function ServiceCard({ service: svc, context, priority, className, href, feature }: Props) {
  const live = svc.status === "live";
  const price = priceText(svc);
  const duration = live ? formatDuration(svc.durationMin) : null;
  const badge = live ? badgeFor(svc) : null;
  const label =
    context ??
    (svc.category === "beauty" ? audienceSummary(svc.audiences) : null) ??
    CATEGORY_BY_ID.get(svc.category)?.shortName;
  const hasMedia = live && Boolean(svc.image || svc.video);

  const title = (
    <h3
      className={cn(
        "font-display font-semibold leading-snug text-content",
        feature ? "text-lg lg:text-2xl" : "text-lg",
      )}
    >
      <Link href={href ?? svc.href} prefetch={false} className={cardLink} onClick={() => trackServiceClick(svc, feature ? "feature-card" : "card")}>
        {svc.name}
      </Link>
    </h3>
  );

  const facts = (
    <p className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-4 text-sm text-muted">
      {live ? (
        <>
          {duration ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-content">
              <Clock className="size-4 text-brand" aria-hidden />
              <span className="sr-only">Duration:</span>
              {duration}
            </span>
          ) : (
            <span />
          )}
          <span>{PRICING_MODEL_LABEL[svc.pricingModel]}</span>
        </>
      ) : (
        <span>Not bookable yet</span>
      )}
    </p>
  );

  const surface = cn(
    "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface",
    cardHover,
    className,
  );

  if (!hasMedia) {
    return (
      <article className={cn(surface, "p-5")}>
        <div className="flex items-start justify-between gap-3">
          <IconTile icon={svc.icon} tone={svc.tone} className="size-11" />
          {badge && <span className="text-xs font-semibold text-brand">{badge}</span>}
        </div>
        {label && <p className="mt-4 text-xs font-medium text-muted">{label}</p>}
        <div className="mt-1">{title}</div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{svc.description}</p>
        {live && (
          <p className="mt-4 font-display text-lg font-bold tabular-nums text-content">
            <span aria-hidden>{price.label}</span>
            <span className="sr-only">Price: {price.spoken}</span>
          </p>
        )}
        {facts}
      </article>
    );
  }

  return (
    <article className={surface}>
      <div className={cn("relative overflow-hidden bg-canvas", feature ? "aspect-[4/3] lg:aspect-auto lg:min-h-72 lg:flex-1" : "aspect-[4/3]")}>
        {svc.image ? (
          <Image
            src={svc.image}
            alt=""
            fill
            priority={priority}
            sizes={
              feature
                ? "(max-width: 640px) 80vw, (max-width: 1024px) 45vw, 620px"
                : "(max-width: 640px) 80vw, (max-width: 1024px) 45vw, 300px"
            }
            className="object-cover object-[50%_25%] motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-[var(--ease-out-soft)] motion-safe:group-hover:scale-[1.03]"
          />
        ) : (
          <video src={svc.video} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
        )}
        {badge && (
          <span className="absolute left-3 top-3 rounded-full bg-surface/95 px-2.5 py-1 text-xs font-semibold text-brand backdrop-blur-sm">
            {badge}
          </span>
        )}
        {/* The stub: a clean tab rising from the card body over the photo's bottom-left corner,
            with one fine dashed tear line (1px, on the pixel grid) before its counterfoil edge. */}
        <p
          className={cn(
            "absolute bottom-0 left-0 rounded-tr-xl bg-surface pl-4 pr-6 pt-2 font-display font-bold tabular-nums text-content",
            "after:absolute after:bottom-0 after:right-2.5 after:top-2 after:border-l after:border-dashed after:border-muted/60",
            feature ? "pb-0.5 text-base lg:pb-1 lg:pl-5 lg:text-xl" : "pb-0.5 text-base",
          )}
        >
          <span aria-hidden>{price.label}</span>
          <span className="sr-only">Price: {price.spoken}</span>
        </p>
      </div>

      <div className={cn("flex flex-1 flex-col p-4", feature && "lg:flex-none lg:p-5")}>
        {label && <p className="text-xs font-medium text-muted">{label}</p>}
        <div className="mt-1">{title}</div>
        <p className={cn("mt-1.5 text-sm leading-relaxed text-muted", feature ? "line-clamp-1 max-w-xl lg:line-clamp-2" : "line-clamp-1")}>
          {svc.description}
        </p>
        {facts}
      </div>
    </article>
  );
});

/**
 * A small job card for one real, bookable service: what it is | what it costs, with the
 * price stub torn off along a perforation. Sits over a hero photo; the caller positions it.
 */
export function ServiceJobCard({ service: svc, className }: { service: ServiceView; className?: string }) {
  const price = priceText(svc);
  const duration = formatDuration(svc.durationMin);
  return (
    <Link
      href={svc.href}
      prefetch={false}
      onClick={() => trackServiceClick(svc, "job-card")}
      className={cn(
        "block rounded-2xl outline-none drop-shadow-xl focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2",
        className,
      )}
    >
      <span className="block overflow-hidden rounded-2xl bg-surface">
        <span className="flex items-center justify-between gap-3 bg-emerald-900 px-4 py-2 text-xs font-semibold text-emerald-50 dark:bg-emerald-950">
          <span className="truncate">{CATEGORY_BY_ID.get(svc.category)?.name}</span>
          <span className="shrink-0 font-medium text-emerald-200">Bookable now</span>
        </span>
        <span className="flex items-stretch">
          <span className="min-w-0 flex-1 px-4 py-3">
            <span className="block truncate font-display text-base font-semibold text-content">{svc.name}</span>
            {duration && (
              <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                <Clock className="size-3.5" aria-hidden />
                <span className="sr-only">Duration:</span>
                {duration}
              </span>
            )}
          </span>
          <span
            className={cn(
              "grid w-[7.5rem] shrink-0 place-items-center border-l border-dashed border-muted/60 px-2 py-3 text-center font-display font-bold leading-tight tabular-nums text-content",
              price.label.length > 7 ? "text-base" : "text-lg",
            )}
          >
            <span>
              <span aria-hidden>{price.label}</span>
              <span className="sr-only">Price: {price.spoken}</span>
            </span>
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * Services that are not bookable yet: a quiet hairline list — a name, one line, and the
 * honest status. Different in kind from the photo cards, so a page never reads as placeholders.
 */
export function ServiceSoonList({
  services,
  label,
  linkAudience,
  columns = 2,
  className,
  statusStated = false,
}: {
  services: ServiceView[];
  label: string;
  linkAudience?: string;
  columns?: 1 | 2 | 3;
  className?: string;
  /** True when the surrounding heading already says these are coming soon: the per-row
   *  status is then spoken to screen readers only, not printed on every row. */
  statusStated?: boolean;
}) {
  if (!services.length) return null;
  return (
    <ul
      aria-label={label}
      className={cn(
        "grid gap-x-10 border-b border-line",
        columns >= 2 && "sm:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        className,
      )}
    >
      {services.map((svc) => (
        <li
          key={svc.slug}
          className="relative flex items-center gap-4 border-t border-line py-3.5 motion-safe:transition-colors hover:bg-emerald-50/60 dark:hover:bg-emerald-500/[0.06]"
        >
          <div className="min-w-0 flex-1">
            <h3 className="font-sans text-base font-semibold tracking-normal text-content">
              <Link
                href={serviceHrefFor(svc, linkAudience)}
                prefetch={false}
                className="outline-none after:absolute after:inset-0 focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-brand/60"
              >
                {svc.name}
              </Link>
            </h3>
            <p className="mt-0.5 hidden truncate text-sm text-muted sm:block">{svc.description}</p>
          </div>
          <span className={cn("shrink-0 text-xs font-medium text-muted", statusStated && "sr-only")}>Not bookable yet</span>
        </li>
      ))}
    </ul>
  );
}

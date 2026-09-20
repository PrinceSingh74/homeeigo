import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categoryHref, type CategoryView } from "@/lib/catalog";
import { IconTile, cardSurface, focusRing } from "@/components/services-catalog/primitives";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { cn } from "@/lib/utils";

/** A whole category that is not bookable yet: what's planned + Notify me. */
export function ComingSoonCard({ category, className }: { category: CategoryView; className?: string }) {
  const { def, services } = category;
  const shown = services.slice(0, 5);
  const more = services.length - shown.length;
  return (
    <article className={cn("flex h-full flex-col p-6", cardSurface, className)}>
      <div className="flex items-start justify-between gap-3">
        <IconTile icon={def.icon} tone={def.tone} className="size-12 rounded-2xl" iconClassName="size-6" />
        <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">Coming soon</span>
      </div>
      <h3 className="mt-5 font-display text-xl font-semibold text-content">{def.name}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{def.tagline}</p>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Planned services</p>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {shown.map((s) => (
          <li key={s.slug} className="rounded-full bg-canvas px-2.5 py-1 text-xs text-content">
            {s.name}
          </li>
        ))}
        {more > 0 && <li className="rounded-full px-2.5 py-1 text-xs text-muted">+{more} more</li>}
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
        <NotifyMeButton sourceKey={`category:${def.id}`} serviceName={def.name} />
        <Link
          href={categoryHref(def.id)}
          prefetch={false}
          className={cn("inline-flex items-center gap-1 rounded-md text-sm font-semibold text-brand hover:underline", focusRing)}
        >
          Explore
          <span className="sr-only"> {def.name}</span>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

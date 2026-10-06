import { categoryHref, type CategoryView } from "@/lib/catalog";
import { SectionActionLink } from "@/components/layout/SectionActionLink";
import { IconTile } from "@/components/services-catalog/primitives";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { cn } from "@/lib/utils";

/**
 * A whole category that is not bookable yet: what's planned + Notify me.
 * A ruled row, not a card — nothing here can be booked, so nothing here looks like a product.
 */
export function ComingSoonCard({ category, className }: { category: CategoryView; className?: string }) {
  const { def, services } = category;
  const shown = services.slice(0, 5);
  const more = services.length - shown.length;
  return (
    <article
      className={cn(
        "grid gap-x-12 gap-y-5 border-t border-line py-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-start",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <IconTile icon={def.icon} tone={def.tone} className="mt-0.5 size-10" />
        <div className="min-w-0">
          <h3 className="font-display text-xl font-semibold leading-tight tracking-tight text-content sm:text-2xl">
            {def.name}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{def.tagline}</p>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm leading-relaxed text-muted">{def.description}</p>
        {shown.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-content">
            <span className="font-semibold">Planned services: </span>
            {shown.map((s) => s.name).join(", ")}
            {more > 0 && ` and ${more} more`}.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:flex-col lg:items-end">
        <NotifyMeButton sourceKey={`category:${def.id}`} serviceName={def.name} />
        <SectionActionLink href={categoryHref(def.id)} className="sm:text-sm">
          Explore
          <span className="sr-only"> {def.name}</span>
        </SectionActionLink>
      </div>
    </article>
  );
}

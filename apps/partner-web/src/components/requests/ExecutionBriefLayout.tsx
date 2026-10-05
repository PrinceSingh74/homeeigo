import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The execution brief's frame: numbered sections a professional reads top to bottom, and the
 * in-page nav that jumps between them. Plain anchors — no scroll listeners, works without JS state.
 */
export type BriefSectionDef = { id: string; title: string; icon: LucideIcon };

/** Sticky under the app header: a wrapping row on desktop, a horizontal chip scroller on a phone. */
export function BriefSectionNav({ sections }: { sections: readonly BriefSectionDef[] }) {
  return (
    <nav
      aria-label="Job sections"
      data-testid="brief-section-nav"
      className="sticky top-[var(--header-height)] z-20 -mx-1 border-b border-partner-line bg-partner-bg/95 px-1 py-2 backdrop-blur"
    >
      <ol className="partner-scroll flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
        {sections.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-partner-line bg-partner-card px-3 text-xs font-semibold text-partner-text transition hover:border-partner-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary"
            >
              <span className="text-partner-muted" aria-hidden="true">{i + 1}</span>
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function BriefSection({
  def,
  number,
  children,
  className,
}: {
  def: BriefSectionDef;
  number: number;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = def.icon;
  return (
    <section
      id={def.id}
      aria-labelledby={`${def.id}-heading`}
      data-testid={def.id}
      // Clears the fixed app header plus the sticky section nav when jumped to.
      className={cn("scroll-mt-[calc(var(--header-height)+5rem)] space-y-3 py-5 first:pt-0 last:pb-0", className)}
    >
      <h2 id={`${def.id}-heading`} className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-partner-text">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-partner-primary/15 text-xs font-bold text-partner-text" aria-hidden="true">
          {number}
        </span>
        <Icon className="h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
        {def.title}
      </h2>
      {children}
    </section>
  );
}

/** A section with nothing recorded says so in words — an empty heading reads as a loading bug. */
export function BriefEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-partner-muted">{children}</p>;
}

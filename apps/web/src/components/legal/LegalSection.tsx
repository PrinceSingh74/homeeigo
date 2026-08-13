import type { ReactNode } from "react";
import type { LegalListItem } from "@/lib/legal/legal-data";

/**
 * A numbered clause of a legal document.
 *
 * Sections are separated by a hairline rule rather than wrapped in individual
 * cards: on a ten-clause policy, stacked cards read as ten unrelated widgets
 * instead of one continuous document. Surfaces are reserved for data blocks
 * (key-point lists, tables) so that a card always means "structured data here".
 */
export function LegalSection({
  id,
  index,
  title,
  children,
}: {
  id: string;
  index: number;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="legal-section" aria-labelledby={`${id}-heading`}>
      <div className="flex items-baseline gap-3">
        <span aria-hidden className="font-mono text-xs font-semibold tabular-nums text-legal-accent">
          {String(index).padStart(2, "0")}
        </span>
        <h2
          id={`${id}-heading`}
          className="font-display text-xl font-bold tracking-tight text-content sm:text-[1.5rem]"
        >
          {title}
        </h2>
      </div>
      {children ? <div className="legal-prose mt-4">{children}</div> : null}
    </section>
  );
}

/**
 * Label / detail pairs rendered as a description list inside a single surface —
 * one data block per clause instead of a grid of tiles.
 */
export function LegalKeyPoints({ items }: { items: readonly LegalListItem[] }) {
  return (
    <dl className="legal-keypoints divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3.5 sm:px-5 sm:py-4">
          <dt className="text-[0.9375rem] font-semibold leading-snug text-content">
            {item.label}
          </dt>
          <dd className="mt-1 text-[0.9375rem] leading-relaxed text-muted">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

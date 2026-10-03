import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type TileCaptionProps = {
  title: string;
  /** Secondary line under the title (category tiles). */
  subtitle?: string;
  /** Inline chip under the title (service tiles show the "From ₹…" price). */
  chip?: ReactNode;
  /** Accent colour for the arrow disc. */
  accent: string;
  className?: string;
};

/**
 * Shared bottom caption for every photo tile on the marketplace wall (Popular
 * Services + Explore by Category). The title is never ellipsised: it wraps to
 * up to three lines on phones (where the arrow disc is hidden and the whole
 * tile is the tap target) and two lines from `lg` where the disc returns.
 */
export function TileCaption({ title, subtitle, chip, accent, className }: TileCaptionProps) {
  return (
    <span
      className={cn(
        "absolute inset-x-3.5 bottom-3 z-20 flex items-end justify-between gap-2",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="line-clamp-3 text-sm font-bold leading-snug text-white drop-shadow-[0_2px_5px_rgb(0_0_0/0.85)] sm:text-base lg:line-clamp-2">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-white/80 drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)]">
            {subtitle}
          </span>
        ) : null}
        {chip ? <span className="mt-1.5 block">{chip}</span> : null}
      </span>
      <span
        aria-hidden
        className="hidden size-9 shrink-0 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/40 transition-transform duration-300 group-hover:translate-x-0.5 lg:grid"
        style={{ background: accent }}
      >
        <ArrowRight size={16} strokeWidth={2.5} />
      </span>
    </span>
  );
}

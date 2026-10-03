"use client";

import type { ReactNode } from "react";
import { useSectionVisibility } from "@/hooks/use-section-visibility";

/**
 * Renders its children only once the section is about to enter the viewport.
 *
 * ── The problem it solves ───────────────────────────────────────────────────
 *
 * `next/dynamic` splits a component into its own chunk, but a dynamic component placed in the
 * initial render tree still downloads and executes immediately — the split changes how the code
 * arrives, not when it runs. A page that dynamic-imports nine panels and renders all nine on mount
 * pays for all nine before the first screen is usable.
 *
 * Measured on /profile: 28 script chunks on first visit and 422-561ms of main-thread blocking, for a
 * page where six of those panels sit below the fold and most visits never scroll to them.
 *
 * ── Why a placeholder, always ───────────────────────────────────────────────
 *
 * The wrapper reserves space before its content exists. Without that, every deferred section would
 * pop in and shove the page down as the reader scrolls toward it — trading main-thread time for
 * layout shift, which is the more annoying of the two. `minHeight` should be a rough guess at the
 * real height; being wrong by a little costs a small settle, being absent costs a jump.
 *
 * `rootMargin` defaults to 200px so the work starts before the section is actually on screen: by the
 * time the reader gets there it has already rendered, and the deferral is invisible.
 */
export function DeferredSection({
  children,
  minHeight = "10rem",
  rootMargin,
  className,
  fallback,
}: {
  children: ReactNode;
  /** Space held while the content is still deferred. Keep it close to the real height. */
  minHeight?: string;
  rootMargin?: string;
  className?: string;
  /** Shown in the reserved space. Defaults to a neutral skeleton. */
  fallback?: ReactNode;
}) {
  const { ref, visible } = useSectionVisibility(rootMargin);

  return (
    <section ref={ref} className={className} style={visible ? undefined : { minHeight }}>
      {visible
        ? children
        : (fallback ?? (
            <div
              className="h-full w-full animate-pulse rounded-2xl bg-surface/50"
              style={{ minHeight }}
              aria-hidden
            />
          ))}
    </section>
  );
}

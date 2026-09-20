"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { CATEGORIES, categoryHref, type CategoryId } from "@/lib/catalog";
import { pageSection } from "@/lib/page-layout";
import { pillActive, pillBase, pillIdle } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/**
 * Sticky, horizontally scrollable category navigation (swipeable pills on
 * mobile). Real links, so every category is a crawlable, shareable page.
 */
export function ServiceCategoryNav({ active }: { active?: CategoryId | "all" }) {
  const scroller = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav
      aria-label="Service categories"
      className="sticky top-[var(--navbar-offset,3.5rem)] z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-xl supports-[backdrop-filter]:bg-canvas/70"
    >
      <div className={cn(pageSection, "relative")}>
        <ul
          ref={scroller}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 py-3 scrollbar-none sm:mx-0 sm:px-0 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-24px),transparent)]"
        >
          <li className="shrink-0">
            <Link
              href="/services"
              prefetch
              aria-current={active === "all" ? "page" : undefined}
              className={cn(pillBase, active === "all" ? pillActive : pillIdle)}
            >
              <LayoutGrid className="size-4" aria-hidden />
              All services
            </Link>
          </li>
          {CATEGORIES.map((c) => {
            const on = active === c.id;
            const Icon = c.icon;
            return (
              <li key={c.id} className="shrink-0">
                <Link
                  href={categoryHref(c.id)}
                  prefetch={false}
                  aria-current={on ? "page" : undefined}
                  className={cn(pillBase, on ? pillActive : pillIdle)}
                >
                  <Icon className="size-4" aria-hidden style={on ? undefined : { color: c.tone }} />
                  {c.shortName}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

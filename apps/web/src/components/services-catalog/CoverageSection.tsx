"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import { useCoverageCities } from "@/hooks/use-coverage";
import { COVERAGE_STATUS_LABEL } from "@/lib/coverage/coverage-types";
import { CoverageSearch } from "@/components/services-page/coverage/CoverageSearch";
import { band, focusRing } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

const CityCoverageModal = dynamic(
  () => import("@/components/services-page/coverage/CityCoverageModal").then((m) => m.CityCoverageModal),
  { ssr: false },
);

/**
 * "Location unavailable?" — hyperlocal coverage check backed by
 * /api/coverage/*. Cities and statuses come from the API; no marketing counts.
 */
export function CoverageSection() {
  const cities = useCoverageCities();
  const [open, setOpen] = useState<{ slug: string; name?: string } | null>(null);
  const list = cities.data?.cities ?? [];

  return (
    <section aria-labelledby="coverage-heading" className={band}>
      <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[0.7fr_1.6fr]">
        <div>
          <h2 id="coverage-heading" className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
            Check if we serve your area
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Search your society, area or pincode. If we&apos;re not there yet, you can ask us to come to you.
          </p>
        </div>
        <div className="min-w-0">
          <div className="max-w-2xl">
            <CoverageSearch variant="light" onOpenCity={(slug) => setOpen({ slug })} />
          </div>
          {list.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Cities">
              {list.map((c) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    onClick={() => setOpen({ slug: c.slug, name: c.name })}
                    className={cn(
                      "inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-content hover:border-emerald-300",
                      focusRing,
                    )}
                  >
                    <MapPin className="size-3.5 text-brand" aria-hidden />
                    {c.name}
                    {c.status !== "AVAILABLE" && (
                      <span className="text-xs text-muted">({COVERAGE_STATUS_LABEL[c.status]})</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {open && <CityCoverageModal citySlug={open.slug} cityName={open.name} onClose={() => setOpen(null)} />}
    </section>
  );
}

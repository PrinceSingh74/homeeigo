"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Users, Building2 } from "lucide-react";
import { partnerApi, type CityCoverageSummary } from "@/services/partner-api";

const STATUS_META: Record<
  CityCoverageSummary["status"],
  { label: string; dot: string; text: string; ring: string }
> = {
  AVAILABLE: { label: "Live", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/20" },
  LIMITED: { label: "Limited", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/20" },
  COMING_SOON: { label: "Coming soon", dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400", ring: "ring-slate-400/20" },
};

const nf = (n: number) => n.toLocaleString("en-IN");

/**
 * Where Homeeigo Operates — read-only network coverage for partners, backed by
 * the same GET /api/coverage/cities source of truth the customer services page
 * and admin console use (admin-managed status flows straight through here).
 */
export function NetworkCitiesSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["partner", "coverage-cities"],
    queryFn: () => partnerApi.coverage.cities(),
    staleTime: 5 * 60_000,
  });

  const cities = data?.cities ?? [];
  const liveCount = cities.filter((c) => c.status === "AVAILABLE").length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-partner-muted">
            Where Homeeigo Operates
          </h2>
          <p className="mt-0.5 text-xs text-partner-muted">
            Live network coverage — same source as the customer app and admin console
          </p>
        </div>
        {cities.length > 0 ? (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {liveCount} live cities
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="partner-card h-24 animate-pulse p-4" />
          ))}
        </div>
      ) : cities.length === 0 ? (
        <p className="partner-card p-5 text-sm text-partner-muted">Coverage data unavailable right now.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => {
            const meta = STATUS_META[city.status];
            return (
              <article key={city.slug} className="partner-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-partner-primary" />
                      <span className="truncate">{city.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-partner-muted">{city.state}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${meta.text} ${meta.ring}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-4 text-xs text-partner-muted">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <strong className="font-bold text-partner-text">{nf(city.activePartners)}</strong> partners
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {city.areaCount} areas
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

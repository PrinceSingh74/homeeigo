"use client";

import { memo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Globe2, MapPinned, Rocket } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { GlassPanel } from "./GlassPanel";
import { Icon3D } from "./Icon3D";
import { IsoBarChart } from "./IsoBarChart";

/**
 * Executive HQ — Coverage Score, city growth heat strip, demand hotspots and
 * expansion priority. Compact board-level cut of /coverage (Operations HQ).
 */
export const ExecutiveCoveragePanel = memo(function ExecutiveCoveragePanel() {
  const intel = useQuery({
    queryKey: ["admin", "coverage", "intelligence"],
    queryFn: () => adminApi.coverage.intelligence(),
    staleTime: 120_000,
  });

  const data = intel.data;
  const scoreTone = (score: number) =>
    score >= 75 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-300";

  return (
    <GlassPanel glow="emerald" className="p-6">
      <div className="exec-section-head">
        <div className="exec-section-head__title">
          <Icon3D icon={MapPinned} tone="success" size="md" />
          <h2 className="text-sm font-semibold leading-none tracking-tight">Coverage Intelligence</h2>
        </div>
        <Link
          href="/coverage"
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-biz-accent)] hover:underline"
        >
          Open coverage <ArrowRight size={12} />
        </Link>
      </div>

      {intel.isError ? (
        <p className="text-sm text-[var(--color-biz-muted)]">Coverage feed unavailable. Retry from Operations HQ.</p>
      ) : intel.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="biz-skeleton h-28 rounded-xl" aria-hidden />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="biz-metric-chip">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Coverage Score
              </p>
              <p className={`text-2xl font-bold leading-none ${scoreTone(data.totals.avgCoverageScore)}`}>
                {data.totals.avgCoverageScore}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]"> /100</span>
              </p>
            </div>
            <div className="biz-metric-chip">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                City Growth
              </p>
              <p className="text-2xl font-bold leading-none text-[var(--color-biz-text)]">
                {data.totals.liveCities}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]">
                  {" "}
                  /{data.totals.cities} live
                </span>
              </p>
            </div>
            <div className="biz-metric-chip">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Area Coverage
              </p>
              <p className="text-2xl font-bold leading-none text-[var(--color-biz-text)]">
                {data.totals.coveragePct}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]">%</span>
              </p>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-5">
            <div className="flex min-w-0 flex-col xl:col-span-3">
              <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                <Icon3D icon={Globe2} tone="success" size="sm" /> Coverage by city
              </p>
              {data.cities.length === 0 ? (
                <div className="biz-metric-chip flex-1 justify-center text-sm text-[var(--color-biz-muted)]">
                  No city coverage samples yet.
                </div>
              ) : (
                <div className="biz-metric-chip flex-1 justify-center">
                  <IsoBarChart
                    data={data.cities.slice(0, 8).map((c) => ({ label: c.name, value: c.coverageScore }))}
                    format={(v) => `${v}`}
                    accent="emerald"
                    height={168}
                    layout="bar"
                  />
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-1">
              <div className="biz-metric-chip justify-start">
                <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                  <Icon3D icon={Flame} tone="warning" size="sm" /> Demand hotspots
                </p>
                {data.demandHotspots.length === 0 ? (
                  <p className="text-xs text-[var(--color-biz-muted)]">No open demand signals.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.demandHotspots.slice(0, 4).map((h) => (
                      <li key={h.label} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-[var(--color-biz-text)]">{h.label}</span>
                        <span className="shrink-0 font-semibold text-orange-300">{h.requests}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="biz-metric-chip justify-start">
                <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                  <Icon3D icon={Rocket} tone="cyan" size="sm" /> Expansion priority
                </p>
                {data.expansionOpportunities.length === 0 ? (
                  <p className="text-xs text-[var(--color-biz-muted)]">All mapped areas live.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.expansionOpportunities.slice(0, 4).map((o) => (
                      <li key={`${o.citySlug}:${o.areaName}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-[var(--color-biz-text)]">
                          {o.areaName}
                          <span className="text-[var(--color-biz-muted)]"> · {o.cityName}</span>
                        </span>
                        <span className="shrink-0 font-semibold text-violet-300">{o.priorityIndex}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {data.requests.new > 0 ? (
            <Link
              href="/coverage"
              className="block rounded-lg border border-[var(--color-biz-accent)]/25 bg-[var(--color-biz-accent-dim)] px-4 py-3 text-xs font-medium text-[var(--color-biz-accent)] transition hover:opacity-90"
            >
              {data.requests.new} new coverage request{data.requests.new === 1 ? "" : "s"} awaiting review →
            </Link>
          ) : null}
        </div>
      )}
    </GlassPanel>
  );
});

"use client";

import { memo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Globe2, MapPinned, Rocket } from "lucide-react";
import { adminApi } from "@/services/admin-api";

const nf = new Intl.NumberFormat("en-IN");

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
  if (intel.isError) return null;

  const scoreTone = (score: number) =>
    score >= 75 ? "text-emerald-300" : score >= 50 ? "text-amber-300" : "text-red-300";
  const heatTone = (score: number) =>
    score >= 75 ? "bg-emerald-400" : score >= 50 ? "bg-amber-400" : "bg-red-400";

  return (
    <section className="biz-glass-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MapPinned size={15} className="text-emerald-400" />
          Coverage Intelligence
        </h2>
        <Link
          href="/coverage"
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-biz-accent)] hover:underline"
        >
          Open <ArrowRight size={12} />
        </Link>
      </div>

      {intel.isLoading || !data ? (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" aria-hidden />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Coverage Score
              </p>
              <p className={`mt-1 text-xl font-bold ${scoreTone(data.totals.avgCoverageScore)}`}>
                {data.totals.avgCoverageScore}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]">/100</span>
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                City Growth
              </p>
              <p className="mt-1 text-xl font-bold text-[var(--color-biz-text)]">
                {data.totals.liveCities}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]">/{data.totals.cities} live</span>
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                Area Coverage
              </p>
              <p className="mt-1 text-xl font-bold text-[var(--color-biz-text)]">
                {data.totals.coveragePct}
                <span className="text-[10px] font-medium text-[var(--color-biz-muted)]">%</span>
              </p>
            </div>
          </div>

          {/* City coverage heat strip */}
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              <Globe2 size={11} /> Coverage heatmap
            </p>
            <div className="flex gap-1" role="img" aria-label="Per-city coverage scores">
              {data.cities.map((c) => (
                <span
                  key={c.slug}
                  title={`${c.name}: ${c.coverageScore}/100 · ${nf.format(c.activePartners)} partners`}
                  className={`h-6 flex-1 rounded ${heatTone(c.coverageScore)}`}
                  style={{ opacity: 0.35 + (c.coverageScore / 100) * 0.65 }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-[var(--color-biz-muted)]">
              <span>{data.cities[0]?.name}</span>
              <span>{data.cities[data.cities.length - 1]?.name}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                <Flame size={11} className="text-orange-400" /> Demand hotspots
              </p>
              {data.demandHotspots.length === 0 ? (
                <p className="text-xs text-[var(--color-biz-muted)]">No open demand signals.</p>
              ) : (
                <ul className="space-y-1">
                  {data.demandHotspots.slice(0, 3).map((h) => (
                    <li key={h.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-[var(--color-biz-text)]">{h.label}</span>
                      <span className="shrink-0 font-semibold text-orange-300">{h.requests}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                <Rocket size={11} className="text-violet-400" /> Expansion priority
              </p>
              {data.expansionOpportunities.length === 0 ? (
                <p className="text-xs text-[var(--color-biz-muted)]">All mapped areas live.</p>
              ) : (
                <ul className="space-y-1">
                  {data.expansionOpportunities.slice(0, 3).map((o) => (
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

          {data.requests.new > 0 && (
            <Link
              href="/coverage"
              className="block rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition hover:bg-blue-500/15"
            >
              {data.requests.new} new coverage request{data.requests.new === 1 ? "" : "s"} awaiting review →
            </Link>
          )}
        </div>
      )}
    </section>
  );
});

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  Globe2,
  MapPinned,
  Rocket,
  Users,
} from "lucide-react";
import { OperationsPage } from "@/components/operations/OperationsPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { Panel } from "@/components/ui/Panel";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { MeterBar } from "@/components/hq/primitives";
import { adminApi } from "@/services/admin-api";
import { formatCount, formatNumber } from "@/lib/format";

export default function CoverageIntelligencePage() {
  const intel = useQuery({
    queryKey: ["admin", "coverage", "intelligence"],
    queryFn: () => adminApi.coverage.intelligence(),
    staleTime: 60_000,
  });
  const d = intel.data;
  const maxScore = Math.max(1, ...(d?.cities ?? []).map((c) => c.coverageScore));

  /**
   * Every per-city metric here is `number | null`, where null means UNMEASURED rather than zero.
   * `formatNumber` would render null as "0" — a measurement the platform did not take — so counts
   * go through `formatCount`, which prints an em dash instead.
   */
  const cityRows = (d?.cities ?? []).map((c) => [
    c.name,
    c.state,
    <StatusBadge key={c.slug} status={c.status.toLowerCase()} />,
    formatCount(c.activePartners),
    formatCount(c.customers),
    formatCount(c.servicesCompleted),
    `${c.coverageScore}`,
  ]);

  return (
    <OperationsPage
      icon={MapPinned}
      title="Coverage Intelligence"
      subtitle="Where we can serve today — live cities, area coverage, demand hotspots, and expansion priority. Numbers come from the coverage engine, not estimates."
    >
      {intel.isError ? (
        <div className="biz-glass-panel p-5" role="alert">
          <p className="text-sm font-semibold">Coverage intelligence could not load.</p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            This page reads GET /api/coverage/intelligence. Empty cities would show zeros — this means the request failed.
          </p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void intel.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="biz-kpi-grid">
            <KpiCard
              label="Coverage score"
              value={d ? String(d.totals.avgCoverageScore) : "—"}
              sub="Average across live cities /100"
              icon={MapPinned}
              loading={intel.isLoading}
            />
            <KpiCard
              label="Live cities"
              value={d ? `${formatNumber(d.totals.liveCities)} / ${formatNumber(d.totals.cities)}` : "—"}
              sub="Cities currently taking jobs"
              icon={Globe2}
              loading={intel.isLoading}
            />
            <KpiCard
              label="Area coverage"
              value={d ? `${d.totals.coveragePct}%` : "—"}
              sub={`${formatNumber(d?.totals.liveAreas ?? 0)} live areas`}
              icon={Rocket}
              loading={intel.isLoading}
              accent="green"
            />
            <KpiCard
              label="Active partners"
              value={d ? formatNumber(d.totals.activePartners) : "—"}
              sub="Lifecycle ACTIVE in covered cities"
              icon={Users}
              loading={intel.isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Coverage by city" hint="Score is 0–100 from the coverage engine" icon={Globe2} iconTone="cyan">
              {intel.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="biz-skeleton h-8 rounded" />
                  ))}
                </div>
              ) : (d?.cities ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(d?.cities ?? []).slice(0, 10).map((c) => (
                    <MeterBar
                      key={c.slug}
                      label={c.activePartners == null ? c.name : `${c.name} · ${formatNumber(c.activePartners)} partners`}
                      value={c.coverageScore}
                      max={maxScore > 100 ? maxScore : 100}
                      suffix=""
                      tone={c.coverageScore >= 70 ? "success" : c.coverageScore >= 40 ? "accent" : "danger"}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState title="No city scores yet" description="City coverage appears once the coverage engine has mapped areas." />
              )}
            </Panel>

            <div className="grid gap-4">
              <Panel title="Demand hotspots" hint="Open coverage requests by area" icon={Flame} iconTone="warning">
                {(d?.demandHotspots ?? []).length > 0 ? (
                  <ul className="space-y-2.5">
                    {d!.demandHotspots.slice(0, 6).map((h) => (
                      <li
                        key={h.label}
                        className="flex items-center justify-between gap-3 border-b border-[var(--color-biz-line)] pb-2 last:border-0"
                      >
                        <span className="min-w-0 truncate text-sm">{h.label}</span>
                        <span className="biz-num shrink-0 text-sm font-semibold">{formatNumber(h.requests)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No open demand signals" description="Hotspots appear when customers request coverage in unmapped areas." />
                )}
              </Panel>
              <Panel title="Expansion priority" hint="Areas ranked for launch" icon={Rocket} iconTone="cyan">
                {(d?.expansionOpportunities ?? []).length > 0 ? (
                  <ul className="space-y-2.5">
                    {d!.expansionOpportunities.slice(0, 6).map((o) => (
                      <li
                        key={`${o.citySlug}:${o.areaName}`}
                        className="flex items-center justify-between gap-3 border-b border-[var(--color-biz-line)] pb-2 last:border-0"
                      >
                        <span className="min-w-0 truncate text-sm">
                          {o.areaName}
                          <span className="text-[var(--color-biz-muted)]"> · {o.cityName}</span>
                        </span>
                        <span className="biz-num shrink-0 text-sm font-semibold">{o.priorityIndex}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="All mapped areas are live" description="Priority rows appear when an area is still limited or coming soon." />
                )}
              </Panel>
            </div>
          </div>

          <DataTable
            title="City coverage"
            hint="Partners are lifecycle ACTIVE in that city, not availability ONLINE. An em dash means unmeasured, not zero."
            icon={MapPinned}
            headers={["City", "State", "Status", "Partners", "Customers", "Completed", "Score"]}
            rows={cityRows}
            loading={intel.isLoading}
            emptyMessage="No coverage cities yet"
            emptyDescription="The coverage engine will list cities once areas and partners are mapped."
          />
        </>
      )}
    </OperationsPage>
  );
}

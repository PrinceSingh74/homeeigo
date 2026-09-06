"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Plus } from "lucide-react";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { GlassKPI } from "@/components/acquisition/GlassKPI";
import { LeadStatusChip } from "@/components/acquisition/LeadStatusChip";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const RANGES = ["7d", "30d", "90d"] as const;

export default function PartnerAcquisitionDashboardPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const dashboard = useQuery({
    queryKey: ["admin", "partner-acquisition", "dashboard", range],
    queryFn: () => adminApi.partnerAcquisition.dashboard(range),
  });
  const data = dashboard.data;
  const maxFunnel = Math.max(1, ...(data?.funnel.map((s) => s.count) ?? [1]));
  const maxLeads = Math.max(1, ...(data?.trends.series?.map((p) => p.leads) ?? [1]));
  const sourceMax = Math.max(1, ...(data?.sources.map((s) => s.leads) ?? [1]));

  const kpis = useMemo(() => {
    if (!data) return [];
    return [
      { label: "Total leads", value: formatNumber(data.kpis.totalLeads), delta: data.kpiDeltas?.leads ?? null, href: "/partner-acquisition/leads", hint: data.historyLimited ? data.historyNote ?? undefined : `vs previous ${range}` },
      { label: "Applications", value: formatNumber(data.kpis.applications), delta: data.kpiDeltas?.applications ?? null, href: "/partner-acquisition/applications", hint: data.historyLimited ? data.historyNote ?? undefined : `vs previous ${range}` },
      { label: "Activated", value: formatNumber(data.kpis.activated), delta: data.kpiDeltas?.activated ?? null, href: "/partner-acquisition/leads?status=ACTIVATED", hint: data.historyLimited ? data.historyNote ?? undefined : `vs previous ${range}` },
      { label: "Follow-up today", value: formatNumber(data.kpis.followUpToday), href: "/partner-acquisition/leads?followUp=today", tone: "accent" as const },
      { label: "Overdue", value: formatNumber(data.kpis.followUpOverdue), href: "/partner-acquisition/leads?followUp=overdue", tone: "danger" as const },
      { label: "Stalled", value: formatNumber(data.kpis.stalled ?? 0), href: "/partner-acquisition/leads?stalled=true" },
    ];
  }, [data, range]);

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="Partner Acquisition"
        subtitle="Lead to activation intelligence — same operating system as Partner Web and Mobile."
        action={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] p-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold uppercase",
                    range === r ? "bg-[var(--color-biz-accent)] text-[#05070d]" : "text-[var(--color-biz-text)]",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Link href="/partner-acquisition/leads" className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-[#05070d]">
              <Plus className="h-4 w-4" /> Add Lead
            </Link>
            <Link href="/partner-acquisition/sources" className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-4 py-2 text-sm font-semibold">
              Sources <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      {dashboard.isError ? (
        <p role="alert" className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-4 py-3 text-sm">
          Could not load acquisition intelligence. Retry after confirming the API is healthy.
        </p>
      ) : dashboard.isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 6 }).map((_, i) => <GlassPanel key={i} className="h-28 min-w-[200px] animate-pulse" />)}
        </div>
      ) : data ? (
        <>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-3 2xl:grid-cols-6">
            {kpis.map((k) => (
              <GlassKPI key={k.label} {...k} />
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <GlassPanel className="p-6">
              <h3 className="text-sm font-semibold">Trend</h3>
              <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Leads created in the selected window. No fabricated history.</p>
              <div className="mt-4 flex h-36 items-end gap-1">
                {(data.trends.series ?? []).map((point) => (
                  <div key={point.date} className="flex-1" title={`${point.date}: ${point.leads} leads`}>
                    <div
                      className="rounded-t bg-[var(--color-biz-accent)]/80"
                      style={{ height: `${Math.max(6, Math.round((point.leads / maxLeads) * 100))}%` }}
                    />
                  </div>
                ))}
              </div>
            </GlassPanel>
            <GlassPanel className="p-6">
              <h3 className="text-sm font-semibold">Follow-up intelligence</h3>
              <div className="mt-4 space-y-2 text-sm">
                <IntelRow href="/partner-acquisition/leads?followUp=today" label="Due today" value={data.kpis.followUpToday} />
                <IntelRow href="/partner-acquisition/leads?followUp=tomorrow" label="Due tomorrow" value={data.kpis.followUpTomorrow ?? 0} />
                <IntelRow href="/partner-acquisition/leads?followUp=overdue" label="Overdue" value={data.kpis.followUpOverdue} />
                <IntelRow href="/partner-acquisition/leads?noNextAction=true" label="No next action" value={data.kpis.noNextAction ?? 0} />
                <IntelRow href="/partner-acquisition/leads?stalled=true" label="Stalled applications" value={data.kpis.stalled ?? 0} />
              </div>
            </GlassPanel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <GlassPanel className="p-6">
              <h3 className="text-sm font-semibold">Acquisition funnel</h3>
              <div className="mt-4 space-y-3">
                {data.funnel.map((stage) => (
                  <div key={stage.key}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--color-biz-muted)]">{stage.label}</span>
                      <span className="font-semibold tabular-nums">{stage.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-biz-line)]">
                      <div className="h-full rounded-full bg-[var(--color-biz-accent)]" style={{ width: `${Math.round((stage.count / maxFunnel) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Source funnel</h3>
                <div className="flex gap-3">
                  <Link href="/partner-acquisition/analytics" className="text-xs font-semibold text-[var(--color-biz-accent)]">Cost</Link>
                  <Link href="/partner-acquisition/sources" className="text-xs font-semibold text-[var(--color-biz-accent)]">View all</Link>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {data.sources.filter((s) => s.leads > 0).slice(0, 5).map((s) => (
                  <div key={s.source}>
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold">{s.source}</span>
                      <span className="tabular-nums">{s.leads} leads · {s.activated} activated</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-biz-line)]">
                      <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${Math.round((s.leads / sourceMax) * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">
                      App {s.applicationRate ?? 0}% · Act {s.activationRate}%
                      {s.costPerActivation != null ? ` · ₹${s.costPerActivation}/activated` : ""}
                    </p>
                  </div>
                ))}
              </div>
              {data.cost && !data.cost.available ? (
                <p className="mt-4 rounded-xl bg-[var(--color-biz-elevated)] px-3 py-2 text-xs text-[var(--color-biz-muted)]">
                  {data.cost.note}
                </p>
              ) : null}
            </GlassPanel>
          </div>

          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold">Recent activity</h3>
            <div className="mt-4 space-y-3">
              {data.recentActivity.map((a) => (
                <Link key={a.id} href={`/partner-acquisition/leads/${a.leadId}`} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-[var(--color-biz-muted)]">{a.leadName}</p>
                  </div>
                  <LeadStatusChip status={a.leadStatus} />
                </Link>
              ))}
            </div>
          </GlassPanel>
        </>
      ) : null}
    </div>
  );
}

function IntelRow({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-[var(--color-biz-elevated)]">
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </Link>
  );
}

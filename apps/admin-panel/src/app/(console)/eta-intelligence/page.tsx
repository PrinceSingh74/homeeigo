"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber, formatPercent } from "@/lib/format";

export default function EtaIntelligencePage() {
  const dashboard = useQuery({
    queryKey: ["eta-dashboard"],
    queryFn: () => adminApi.etaIntelligence.dashboard(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const quality = useQuery({
    queryKey: ["eta-quality"],
    queryFn: () => adminApi.etaIntelligence.quality(),
    staleTime: 60_000,
  });
  const readiness = useQuery({
    queryKey: ["eta-readiness"],
    queryFn: () => adminApi.etaIntelligence.readiness(),
    staleTime: 60_000,
  });
  const google = useQuery({
    queryKey: ["eta-google"],
    queryFn: () => adminApi.etaIntelligence.google(),
    staleTime: 60_000,
  });
  const trips = useQuery({
    queryKey: ["eta-trips"],
    queryFn: () => adminApi.etaIntelligence.trips(25),
    staleTime: 30_000,
  });

  const d = dashboard.data as Record<string, unknown> | undefined;
  const q = quality.data as Record<string, unknown> | undefined;
  const r = readiness.data as Record<string, unknown> | undefined;
  const g = google.data as Record<string, unknown> | undefined;
  const cities = (d?.cities as Array<{ city: string; count: number }>) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            ETA Intelligence
            <span className="mt-1 block text-sm font-normal text-[var(--color-biz-muted)]">
              Label collection platform — Google vs Actual — no ML inference
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            void dashboard.refetch();
            void quality.refetch();
            void readiness.refetch();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          <RefreshCw size={14} className={dashboard.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {dashboard.isLoading ? (
        <div className="flex items-center justify-center py-16 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading ETA intelligence…
        </div>
      ) : dashboard.isError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          Failed to load ETA dashboard. Ensure backend Phase 2 migration is applied.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Trips Collected"
              value={formatNumber(Number(d?.tripsCollected ?? 0))}
              icon={Database}
              sub={`${formatNumber(Number(d?.labelsToday ?? 0))} today`}
            />
            <KpiCard
              label="Training Ready"
              value={formatNumber(Number(d?.trainingReady ?? 0))}
              icon={CheckCircle2}
              sub={`${formatPercent(Number(r?.readinessPct ?? 0) / 100)} of min threshold`}
            />
            <KpiCard
              label="Label Quality"
              value={`${Number(d?.avgQualityScore ?? 100).toFixed(1)}%`}
              icon={Target}
              sub={`${formatNumber(Number(d?.rejected ?? 0))} rejected`}
            />
            <KpiCard
              label="Google vs Actual Gap"
              value={d?.avgGapMinutes != null ? `${Number(d.avgGapMinutes).toFixed(1)} min` : "—"}
              icon={TrendingUp}
              sub="Average prediction gap"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-1">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <Activity size={14} />
                Training Readiness
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Training ready</span>
                  <span className="font-mono text-emerald-400">{formatNumber(Number(r?.trainingReady ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Validated</span>
                  <span className="font-mono">{formatNumber(Number(r?.validated ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Raw</span>
                  <span className="font-mono">{formatNumber(Number(r?.raw ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Min for training</span>
                  <span className="font-mono">{formatNumber(Number(r?.minLabelsForTraining ?? 50))}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, Number(r?.readinessPct ?? 0))}%` }}
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-1">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <Navigation size={14} />
                Google Maps Capture
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Snapshots</span>
                  <span className="font-mono">{formatNumber(Number(g?.snapshotCount ?? 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg latency</span>
                  <span className="font-mono">{Number(g?.avgLatencyMs ?? 0)} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Failure rate</span>
                  <span className={`font-mono ${Number(g?.failureRate ?? 0) > 5 ? "text-amber-400" : ""}`}>
                    {Number(g?.failureRate ?? 0).toFixed(1)}%
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-1">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <Clock size={14} />
                Data Freshness
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Last label</span>
                  <span className="font-mono">
                    {d?.freshnessMinutes != null ? `${Number(d.freshnessMinutes)} min ago` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Overall quality</span>
                  <span className="font-mono">{Number(q?.overallScore ?? 100).toFixed(1)}%</span>
                </div>
              </div>
            </section>
          </div>

          {cities.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <MapPin size={14} />
                Cities
              </h2>
              <div className="flex flex-wrap gap-2">
                {cities.map((c) => (
                  <span
                    key={c.city}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm"
                  >
                    {c.city}{" "}
                    <span className="text-slate-400">({formatNumber(c.count)})</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
              Recent Trips
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="pb-2 pr-4 font-medium">Booking</th>
                    <th className="pb-2 pr-4 font-medium">City</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Quality</th>
                    <th className="pb-2 pr-4 font-medium">Actual</th>
                    <th className="pb-2 pr-4 font-medium">Google</th>
                    <th className="pb-2 font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {((trips.data?.trips as Array<Record<string, unknown>>) ?? []).map((t) => (
                    <tr key={String(t.bookingId)} className="border-b border-white/5">
                      <td className="py-2 pr-4 font-mono text-xs">{String(t.bookingId).slice(0, 12)}…</td>
                      <td className="py-2 pr-4">{String(t.city ?? "—")}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            t.status === "TRAINING_READY"
                              ? "text-emerald-400"
                              : t.status === "REJECTED"
                                ? "text-red-400"
                                : "text-slate-300"
                          }
                        >
                          {String(t.status)}
                        </span>
                      </td>
                      <td className="py-2 pr-4">{Number(t.qualityScore ?? 0).toFixed(0)}%</td>
                      <td className="py-2 pr-4">
                        {t.actualTravelDurationMin != null ? `${Number(t.actualTravelDurationMin)} min` : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {t.googleEtaMinutes != null ? `${Number(t.googleEtaMinutes)} min` : "—"}
                      </td>
                      <td className="py-2">
                        {t.gapMinutes != null ? (
                          <span className={Number(t.gapMinutes) > 5 ? "text-amber-400" : ""}>
                            {Number(t.gapMinutes) > 0 ? "+" : ""}
                            {Number(t.gapMinutes).toFixed(1)} min
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {trips.isSuccess && !(trips.data?.trips as unknown[])?.length && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No ETA labels collected yet. Labels are created when bookings complete.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {((q?.rejectionReasons as Array<{ reason: string; count: number }>) ?? []).length > 0 && (
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-300">
                <XCircle size={14} />
                Quality Rejections
              </h2>
              <div className="flex flex-wrap gap-2">
                {((q?.rejectionReasons as Array<{ reason: string; count: number }>) ?? []).map((item) => (
                  <span key={item.reason} className="rounded-lg bg-amber-500/10 px-3 py-1 text-sm text-amber-200">
                    {item.reason.replace(/_/g, " ")} ({item.count})
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

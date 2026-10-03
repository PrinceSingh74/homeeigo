"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IndianRupee, Flame, Zap, Brain, Cpu, TrendingUp } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";
import { mlRegistryView, registryTiles } from "@/lib/warehouse-availability-view";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading, SparkBars } from "../primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function AiHqDashboard() {
  const revenue = useQuery({
    queryKey: ["hq", "ai", "revenue-forecast"],
    queryFn: () => adminApi.geoIntel.revenueForecast(),
    staleTime: 120_000,
  });
  const demand = useQuery({
    queryKey: ["hq", "ai", "demand-forecast"],
    queryFn: () => adminApi.geoIntel.demandForecast(24),
    staleTime: 120_000,
  });
  const surge = useQuery({
    queryKey: ["hq", "ai", "surge"],
    queryFn: () => adminApi.geoIntel.surge(),
    staleTime: 120_000,
  });
  const mlops = useQuery({
    queryKey: ["hq", "ai", "mlops-health"],
    queryFn: () => adminApi.mlops.health(),
    staleTime: 300_000,
    retry: false,
  });

  const rev = revenue.data?.data;
  /**
   * An expired forecast window is not charted.
   *
   * The warehouse model projects forward from the end of its training data, so once that window has
   * closed these points describe hours that already happened. Sparkbars carry no dates, so they would
   * read as the coming 24 hours. The backend reports `stale`; this dashboard acts on it.
   */
  const demandStale = demand.data?.data?.stale === true;
  // X-84: the source did not answer (`available: false`, data null) — never read that as 0 bookings.
  const demandUnavailable = demand.isError || demand.data?.available === false;
  const demandBars = useMemo(
    () => (demand.data?.data?.stale === true ? [] : (demand.data?.data?.points ?? []).map((p) => num(p.predicted))),
    [demand.data],
  );

  const surgeZones = useMemo(() => {
    const zones = surge.data?.data ?? [];
    return [...zones].sort((a, b) => num(b.predictedSurge) - num(a.predictedSurge)).slice(0, 6);
  }, [surge.data]);

  // X-88: `available: false` (warehouse down) takes the unavailable panel, never "Empty registry".
  const mlView = mlRegistryView(mlops.data, mlops.isError);


  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue / hr (forecast)" value={rev ? inr(rev.forecastHourly) : "—"} icon={IndianRupee} loading={revenue.isLoading} tone="accent" />
        <StatTile label="Revenue / day (forecast)" value={rev ? inr(rev.forecastDaily) : "—"} sub={rev ? `Realized 24h ${inr(rev.realized24h)}` : undefined} icon={TrendingUp} loading={revenue.isLoading} tone="success" />
        <StatTile label="Revenue / wk (forecast)" value={rev ? inr(rev.forecastWeekly) : "—"} icon={TrendingUp} loading={revenue.isLoading} />
        <StatTile label="Demand (next 24h)" value={demand.data?.data && !demandStale && !demandUnavailable ? formatNumber(num(demand.data.data.totalPredicted)) : "—"} sub={demandUnavailable ? "forecast unavailable" : demandStale ? "forecast window expired" : "predicted bookings"} icon={Flame} loading={demand.isLoading} />
      </section>

      <GlassPanel glow="blue" className="p-5">
        <SectionHeading title="Demand Forecast" hint="hourly · next 24h" />
        {demand.isLoading ? (
          <div className="biz-skeleton h-16 w-full rounded" />
        ) : demandUnavailable ? (
          <DataUnavailable title="Demand forecast unavailable" reason="The forecast source did not respond; nothing has been charted." />
        ) : demandStale ? (
          <p className="text-xs text-[var(--color-biz-muted)]">
            The warehouse forecast window ended {demand.data?.data?.forecastWindow?.to ?? "at an unknown time"} and has
            not been charted. It projects forward from the end of training data, so it cannot describe the next 24 hours
            until it is retrained.
          </p>
        ) : demandBars.length > 0 ? (
          <SparkBars data={demandBars} label={`${demandBars.length} hours · confidence bands available`} color="#3b82f6" height={72} />
        ) : (
          <DataUnavailable title="No demand forecast" reason="Demand-forecast endpoint returned no points." />
        )}
      </GlassPanel>

      <GlassPanel className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-[var(--color-biz-accent)]" />
          <h2 className="text-sm font-semibold">Surge Forecast — Top Zones</h2>
        </div>
        {surge.isLoading ? (
          <div className="biz-skeleton h-32 w-full rounded" />
        ) : surgeZones.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {surgeZones.map((z) => (
              <div key={z.zoneId} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{z.name}</p>
                  <p className="text-[10px] text-[var(--color-biz-muted)]">{z.city ?? "—"}</p>
                </div>
                <span className="rounded-md bg-[var(--color-biz-accent-dim)] px-2 py-0.5 font-semibold text-[var(--color-biz-accent)]">
                  {num(z.predictedSurge).toFixed(2)}x
                </span>
              </div>
            ))}
          </div>
        ) : (
          <DataUnavailable title="No surge data" reason="Surge endpoint returned no zones." />
        )}
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[var(--color-biz-accent)]" />
            <h2 className="text-sm font-semibold">ML Model Registry</h2>
          </div>
          {mlops.isLoading ? (
            <div className="biz-skeleton h-20 w-full rounded" />
          ) : mlView.state === "unavailable" ? (
            <DataUnavailable title="MLOps not configured" reason="Model registry (BigQuery) is unavailable — likely GCP/BigQuery is not configured in this environment." />
          ) : mlView.state === "ready" ? (
            // X-91: the registry's own fields under their own names ("Healthy" read fields the API
            // never returns and always showed 0).
            <div className="grid grid-cols-2 gap-3">
              {registryTiles(mlView.health).map((t, i) => (
                <StatTile key={t.label} label={t.label} value={t.value} icon={i === 0 ? Brain : undefined} tone={i === 1 ? "success" : undefined} />
              ))}
            </div>
          ) : (
            // No answer yet — not a claim that the registry is empty (a real empty registry is "Models 0").
            <div className="biz-skeleton h-20 w-full rounded" />
          )}
        </GlassPanel>

        <DataUnavailable
          title="Partner Churn & AI Agent Ops"
          reason="Customer churn is available (Marketplace HQ), but there is no partner-churn model endpoint, and AI chat is customer-scoped only — no admin agent-operations API exists yet."
        />
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, UserX, Scale, MapPin, Gauge } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading, MeterBar } from "../primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function RiskHqDashboard() {
  const riskIntel = useQuery({
    queryKey: ["hq", "risk", "intelligence"],
    queryFn: () => adminApi.riskIntelligence(30),
    staleTime: 120_000,
  });
  const overview = useQuery({
    queryKey: ["hq", "risk", "fraud-overview"],
    queryFn: () => adminApi.fraud.overview(),
    staleTime: 120_000,
  });
  const highRisk = useQuery({
    queryKey: ["hq", "risk", "high-risk"],
    queryFn: () => adminApi.fraud.highRiskUsers(),
    staleTime: 120_000,
  });
  const geoFraud = useQuery({
    queryKey: ["hq", "risk", "geo-fraud"],
    queryFn: () => adminApi.geoIntel.fraud(50),
    staleTime: 120_000,
  });
  const compliance = useQuery({
    queryKey: ["hq", "risk", "compliance"],
    queryFn: () => adminApi.compliance.listRequests(),
    staleTime: 120_000,
  });

  const hr = highRisk.data as unknown;
  const hrObj = (hr ?? {}) as Record<string, unknown>;
  const highRiskUsers = Array.isArray(hr)
    ? (hr as Array<Record<string, unknown>>)
    : Array.isArray(hrObj.users)
      ? (hrObj.users as Array<Record<string, unknown>>)
      : [];
  const geoEvents = geoFraud.data?.data;
  const complianceReqs = compliance.data ?? [];

  const distribution = useMemo(() => {
    const riskDist = ((overview.data ?? {}) as Record<string, unknown>).riskDistribution as
      | Record<string, unknown>
      | undefined;
    const dist = riskDist ?? {};
    return Object.keys(dist).map((k) => ({ label: k, value: num(dist[k]) }));
  }, [overview.data]);
  const distMax = Math.max(...distribution.map((d) => d.value), 1);
  const ri = riskIntel.data;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Unified Trust Score"
          value={ri ? `${ri.unifiedTrustScore.score.toFixed(0)}` : "—"}
          sub="0–100 composite"
          icon={Gauge}
          loading={riskIntel.isLoading}
          tone={ri && ri.unifiedTrustScore.score >= 70 ? "success" : ri ? "danger" : "default"}
        />
        <StatTile label="Fraud Confidence" value={ri ? `${ri.fraudConfidence.score.toFixed(0)}` : "—"} sub={`${ri?.fraudConfidence.highRiskUsers ?? 0} high-risk`} icon={ShieldAlert} loading={riskIntel.isLoading} />
        <StatTile label="Payment Risk" value={ri ? `${ri.paymentRisk.score.toFixed(0)}` : "—"} sub={`CB ${ri?.paymentRisk.chargebackRatioPct.toFixed(2) ?? "—"}%`} icon={Scale} loading={riskIntel.isLoading} />
        <StatTile label="Compliance Risk" value={ri ? `${ri.complianceRisk.score.toFixed(0)}` : "—"} sub={`${ri?.complianceRisk.overdueRequests ?? 0} overdue`} icon={Scale} loading={riskIntel.isLoading} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Fraud Risk Score"
          value={geoEvents ? `${num(geoEvents.riskScore).toFixed(0)}` : "—"}
          sub="GPS anomaly index"
          icon={Gauge}
          loading={geoFraud.isLoading}
          tone={num(geoEvents?.riskScore) > 50 ? "danger" : "success"}
        />
        <StatTile label="High-Risk Users" value={formatNumber(highRiskUsers.length)} icon={UserX} loading={highRisk.isLoading} tone="danger" />
        <StatTile label="GPS Anomalies" value={formatNumber(num(geoEvents?.suspiciousCount))} sub="speed/jump events" icon={MapPin} loading={geoFraud.isLoading} />
        <StatTile label="Compliance Queue" value={formatNumber(complianceReqs.length)} sub="GDPR requests" icon={Scale} loading={compliance.isLoading} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel glow="red" className="p-5">
          <SectionHeading title="Risk Distribution" hint="fraud engine" />
          {overview.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : distribution.length > 0 ? (
            <div className="space-y-3">
              {distribution.map((d) => (
                <MeterBar
                  key={d.label}
                  label={d.label}
                  value={d.value}
                  max={distMax}
                  suffix=""
                  tone={/high|critical/i.test(d.label) ? "danger" : /medium/i.test(d.label) ? "accent" : "success"}
                />
              ))}
            </div>
          ) : (
            <DataUnavailable title="No risk distribution" reason="Fraud overview returned no risk distribution." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <UserX className="h-4 w-4 text-[var(--color-biz-danger)]" />
            <h2 className="text-sm font-semibold">Top High-Risk Users</h2>
          </div>
          {highRisk.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : highRiskUsers.length > 0 ? (
            <div className="space-y-1.5">
              {highRiskUsers.slice(0, 6).map((usr, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate">{String(usr.name ?? usr.userName ?? usr.email ?? usr.userId ?? `User ${i + 1}`)}</span>
                  <span className="font-semibold tabular-nums text-[var(--color-biz-danger)]">
                    {num(usr.riskScore ?? usr.score ?? usr.fraudScore).toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No high-risk users" reason="Fraud engine returned no high-risk users." />
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <SectionHeading title="Risk Timeline" hint="30d" />
        {riskIntel.isLoading ? (
          <div className="biz-skeleton h-32 w-full rounded" />
        ) : ri && ri.riskTimeline.length > 0 ? (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {ri.riskTimeline.slice(0, 20).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                <span className="truncate">{e.title}</span>
                <span className="shrink-0 text-[var(--color-biz-muted)]">{new Date(e.at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <DataUnavailable title="No risk events" reason="No fraud alerts, financial risk events or decisions in the window." />
        )}
      </GlassPanel>
    </div>
  );
}

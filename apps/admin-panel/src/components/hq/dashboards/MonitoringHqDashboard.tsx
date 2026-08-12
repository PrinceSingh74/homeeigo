"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Server, Radio, Layers, CreditCard, Landmark, Bug, Activity, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading, SparkBars } from "../primitives";
import { cn } from "@/lib/cn";

function statusTone(status?: string): "up" | "warn" | "down" {
  const s = (status ?? "").toLowerCase();
  if (["healthy", "up", "ok", "operational", "connected"].some((k) => s.includes(k))) return "up";
  if (["degraded", "warning", "slow", "backlog"].some((k) => s.includes(k))) return "warn";
  if (["down", "error", "unhealthy", "disconnected", "critical"].some((k) => s.includes(k))) return "down";
  return "warn";
}

function ServiceHealthCard({
  label,
  status,
  detail,
  icon: Icon,
}: {
  label: string;
  status?: string;
  detail?: string;
  icon: LucideIcon;
}) {
  const tone = statusTone(status);
  const dot = tone === "up" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : "bg-red-400";
  const glow = tone === "up" ? "shadow-[0_0_8px_rgba(16,185,129,0.6)]" : tone === "warn" ? "shadow-[0_0_8px_rgba(245,158,11,0.6)]" : "shadow-[0_0_8px_rgba(239,68,68,0.6)]";

  return (
    <div className="biz-glass-panel p-4">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-[var(--color-biz-muted)]" />
        <span className={cn("h-2.5 w-2.5 rounded-full", dot, glow)} />
      </div>
      <p className="mt-3 text-sm font-semibold">{label}</p>
      <p className="mt-0.5 text-[11px] capitalize text-[var(--color-biz-muted)]">{status ?? "unknown"}</p>
      {detail ? <p className="mt-1 text-[10px] text-[var(--color-biz-muted)]">{detail}</p> : null}
    </div>
  );
}

export function MonitoringHqDashboard() {
  const recovery = useQuery({
    queryKey: ["hq", "monitoring", "recovery"],
    queryFn: () => adminApi.recoveryStatus(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });
  const health = useQuery({
    queryKey: ["hq", "monitoring", "health"],
    queryFn: () => adminApi.observability.health(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const h = health.data;
  const sh = h?.serviceHealth;
  const rec = recovery.data;

  const traceBars = useMemo(() => {
    const counts = h?.tracing?.domainCounts ?? {};
    return Object.values(counts).map((v) => Number(v) || 0);
  }, [h?.tracing?.domainCounts]);

  return (
    <div className="space-y-6">
      <section>
        <SectionHeading title="Service Health" hint={h ? `instance ${h.instanceId?.slice(0, 8) ?? ""}` : "live"} />
        {health.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="biz-skeleton h-28 rounded-xl" />)}
          </div>
        ) : sh ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <ServiceHealthCard label="Database" status={sh.database.status} detail={sh.database.latencyMs != null ? `${sh.database.latencyMs}ms` : undefined} icon={Database} />
            <ServiceHealthCard label="Redis" status={sh.redis.status} detail={`${sh.redis.connectedClients} clients · ${(sh.redis.hitRate * 100).toFixed(0)}% hit`} icon={Server} />
            <ServiceHealthCard label="WebSocket" status={sh.websocket.status} detail={`${formatNumber(sh.websocket.totalConnections)} conns · ${sh.websocket.totalRooms} rooms`} icon={Radio} />
            <ServiceHealthCard label="Queue" status={sh.queue.status} detail={`${sh.queue.assignmentBacklog} backlog`} icon={Layers} />
            <ServiceHealthCard label="Payments" status={sh.payments.status} detail={`${sh.payments.pending} pending`} icon={CreditCard} />
            <ServiceHealthCard label="Finance" status={sh.finance.status} detail={`${sh.finance.openAlerts} alerts · ${sh.finance.lastIntegrityStatus}`} icon={Landmark} />
          </div>
        ) : (
          <DataUnavailable title="Health unavailable" reason="Observability health endpoint returned no data." />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-4">
        <StatTile label="Sentry" value={h?.sentry.enabled ? "Enabled" : "Disabled"} icon={Bug} tone={h?.sentry.enabled ? "success" : "default"} loading={health.isLoading} />
        <StatTile label="Logs (24h)" value={formatNumber(h?.logs.last24h ?? 0)} sub={`${formatNumber(h?.logs.total ?? 0)} total`} icon={FileText} loading={health.isLoading} />
        <StatTile label="Ops Alerts" value={formatNumber(h?.alerts.opsOpen ?? 0)} icon={Activity} tone={(h?.alerts.opsOpen ?? 0) > 0 ? "danger" : "success"} loading={health.isLoading} />
        <StatTile label="Trace Buffer" value={formatNumber(h?.tracing.bufferSize ?? 0)} sub="spans buffered" icon={Activity} loading={health.isLoading} />
      </div>

      <GlassPanel className="p-5">
        <SectionHeading title="Tracing — spans by domain" hint="live buffer" />
        {traceBars.length > 0 ? (
          <SparkBars data={traceBars} label={`${Object.keys(h?.tracing.domainCounts ?? {}).length} domains`} color="var(--color-biz-accent)" height={64} />
        ) : (
          <DataUnavailable title="No trace spans" reason="Tracing buffer is empty right now." />
        )}
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Backup Health Center" hint={rec?.backup.backupDir ?? "BACKUP_DIR"} />
          {recovery.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : rec ? (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Health" value={rec.backup.health} tone={rec.backup.health === "healthy" ? "success" : rec.backup.health === "degraded" ? "danger" : "default"} />
              <StatTile label="Backups" value={formatNumber(rec.backup.totalBackups)} />
              <StatTile label="Last success" value={rec.backup.lastSuccessAt ? new Date(rec.backup.lastSuccessAt).toLocaleDateString() : "—"} />
              <StatTile label="Success rate" value={rec.backup.successRatePct != null ? `${rec.backup.successRatePct.toFixed(0)}%` : "—"} />
            </div>
          ) : (
            <DataUnavailable title="Recovery status unavailable" reason="GET /api/admin/recovery/status returned no data." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="DR · RPO / RTO" hint="targets from env" />
          {recovery.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : rec ? (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="DR readiness" value={`${rec.disasterRecovery.readinessScore}/100`} tone={rec.disasterRecovery.readinessScore >= 70 ? "success" : "danger"} />
              <StatTile label="RTO target" value={`${Math.round(rec.disasterRecovery.rtoTargetSeconds / 60)} min`} />
              <StatTile label="RPO current" value={rec.disasterRecovery.rpoCurrentSeconds != null ? `${Math.round(rec.disasterRecovery.rpoCurrentSeconds / 3600)}h` : "—"} />
              <StatTile label="Last drill RTO" value={rec.disasterRecovery.rtoLastDrillSeconds != null ? `${Math.round(rec.disasterRecovery.rtoLastDrillSeconds / 60)} min` : "—"} />
            </div>
          ) : (
            <DataUnavailable title="DR metrics unavailable" reason="No restore-validation-report.json or backup evidence." />
          )}
        </GlassPanel>
      </div>
    </div>
  );
}

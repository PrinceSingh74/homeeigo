"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Database, Radio, Server, Shield, Wifi } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function ObservabilityPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "observability", "health"],
    queryFn: () => adminApi.observability.health(),
    refetchInterval: 30_000,
  });

  const validationMut = useMutation({
    mutationFn: () => adminApi.observability.runValidation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "observability"] }),
  });

  const evalMut = useMutation({
    mutationFn: () => adminApi.observability.evaluateAlerts(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "observability"] }),
  });

  const h = data?.serviceHealth;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Observability Dashboard</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Service health, infrastructure, tracing, and production validation
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/observability/email"
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
          >
            Email health
          </Link>
          <Link
            href="/observability/alerts"
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
          >
            View alerts
          </Link>
          <Link
            href="/observability/logs"
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
          >
            Search logs
          </Link>
          <button
            type="button"
            disabled={evalMut.isPending}
            onClick={() => evalMut.mutate()}
            className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {evalMut.isPending ? "Evaluating…" : "Evaluate alerts"}
          </button>
          <button
            type="button"
            disabled={validationMut.isPending}
            onClick={() => validationMut.mutate()}
            className="rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {validationMut.isPending ? "Validating…" : "Run production validation"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Database"
          value={h?.database.status ?? "—"}
          icon={Database}
          loading={isLoading}
          accent={h?.database.status === "healthy" ? "green" : "red"}
        />
        <KpiCard
          label="Redis"
          value={h?.redis.status ?? "—"}
          icon={Server}
          loading={isLoading}
          accent={h?.redis.status === "healthy" ? "green" : "amber"}
        />
        <KpiCard
          label="WebSocket"
          value={`${h?.websocket.totalConnections ?? 0} conn`}
          icon={Wifi}
          loading={isLoading}
        />
        <KpiCard
          label="Open alerts"
          value={String((data?.alerts.opsOpen ?? 0) + (data?.alerts.financeOpen ?? 0))}
          icon={Shield}
          loading={isLoading}
          accent={(data?.alerts.opsOpen ?? 0) > 0 ? "red" : "green"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Activity className="h-4 w-4" /> Service health
          </h2>
          <ul className="space-y-2 text-sm">
            <li>Payments: {h?.payments.status} ({h?.payments.pending} pending)</li>
            <li>Queue: {h?.queue.status} ({h?.queue.assignmentBacklog} backlog)</li>
            <li>Finance: {h?.finance.status} (integrity: {h?.finance.lastIntegrityStatus})</li>
            <li>WS fan-out: {h?.websocket.redisFanout ? "Redis enabled" : "local only"}</li>
            <li>Sentry: {data?.sentry.enabled ? "enabled" : "disabled"}</li>
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Radio className="h-4 w-4" /> Tracing & logs
          </h2>
          <ul className="space-y-2 text-sm">
            <li>Instance: {data?.instanceId ?? "—"}</li>
            <li>WS instance: {data?.wsInstanceId ?? "—"}</li>
            <li>Trace buffer: {data?.tracing.bufferSize ?? 0} spans</li>
            <li>Logs (24h): {data?.logs.last24h ?? 0}</li>
            <li>Logs (total): {data?.logs.total ?? 0}</li>
          </ul>
        </div>
      </div>

      {validationMut.data && (
        <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-2 font-semibold">Production validation result</h2>
          <p className="text-sm">
            Status: <strong>{validationMut.data.status}</strong> — Score: {validationMut.data.score}%
          </p>
          <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
            Infrastructure {validationMut.data.afterScore.infrastructure}/10 · Scalability{" "}
            {validationMut.data.afterScore.scalability}/10 · Overall {validationMut.data.afterScore.overall}/100
          </p>
        </div>
      )}
    </div>
  );
}

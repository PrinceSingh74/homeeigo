"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi, type ObservabilityAlert } from "@/services/admin-api";

export default function ObservabilityAlertsPage() {
  const qc = useQueryClient();
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["admin", "observability", "alerts"],
    queryFn: () => adminApi.observability.alerts({ limit: 50, resolved: false }),
    refetchInterval: 60_000,
  });

  const resolveMut = useMutation({
    mutationFn: ({ source, id }: { source: "ops" | "finance"; id: string }) =>
      adminApi.observability.resolveAlert(source, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "observability", "alerts"] }),
  });

  const rows = (alerts ?? []).map((a: ObservabilityAlert) => [
    a.source,
    a.alertType,
    <StatusBadge key={`sev-${a.id}`} status={a.severity} />,
    a.message.slice(0, 80),
    new Date(a.createdAt).toLocaleString(),
    <button
      key={`resolve-${a.id}`}
      type="button"
      disabled={resolveMut.isPending}
      onClick={() => resolveMut.mutate({ source: a.source, id: a.id })}
      className="text-sm font-medium text-[var(--color-biz-accent)] disabled:opacity-50"
    >
      Resolve
    </button>,
  ]);

  const critical = (alerts ?? []).filter((a) => a.severity === "CRITICAL" || a.severity === "ESCALATION").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Alerts</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Payment, refund, settlement, Redis, queue, webhook, and finance alerts
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Open alerts" value={String(alerts?.length ?? 0)} icon={AlertTriangle} loading={isLoading} />
        <KpiCard
          label="Critical / Escalation"
          value={String(critical)}
          icon={AlertTriangle}
          accent={critical > 0 ? "red" : "green"}
          loading={isLoading}
        />
        <KpiCard label="Sources" value="ops + finance" icon={AlertTriangle} loading={isLoading} />
      </div>

      <DataTable
        title="Alert inbox"
        columns={["Source", "Type", "Severity", "Message", "Created", "Action"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No open alerts"
      />
    </div>
  );
}

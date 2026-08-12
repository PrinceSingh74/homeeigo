"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Scale } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi } from "@/services/admin-api";

export default function FinanceSettlementSyncPage() {
  const qc = useQueryClient();
  const [escalateId, setEscalateId] = useState<string | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "settlement-sync"],
    queryFn: () => adminApi.financeSettlementSync(),
  });

  const { data: health } = useQuery({
    queryKey: ["admin", "finance", "settlement-health"],
    queryFn: () => adminApi.settlementHealthScore(),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "finance", "settlement-sync"] });

  const sync = useMutation({ mutationFn: () => adminApi.runSettlementSync(), onSuccess: invalidate });
  const assignMut = useMutation({ mutationFn: (id: string) => adminApi.assignSettlementDiscrepancy(id), onSuccess: invalidate });
  const resolveMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) => adminApi.resolveSettlementDiscrepancy(id, notes),
    onSuccess: () => { setResolveId(null); invalidate(); },
  });
  const escalateMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.escalateSettlementDiscrepancy(id, reason),
    onSuccess: () => { setEscalateId(null); invalidate(); },
  });

  const metrics = (data?.metrics ?? {}) as Record<string, number>;
  const discrepancies = data?.discrepancies ?? [];
  const runs = data?.runs ?? [];
  const healthData = (health ?? {}) as Record<string, number | null>;

  const discRows = discrepancies.map((d) => {
    const row = d as Record<string, unknown>;
    const id = String(row.id);
    return [
      String(row.type ?? "—"),
      String(row.referenceId ?? "—").slice(0, 16),
      row.expectedAmount != null ? String(row.expectedAmount) : "—",
      row.actualAmount != null ? String(row.actualAmount) : "—",
      <StatusBadge key={`st-${id}`} status={String(row.status ?? "open").toLowerCase()} />,
      <span key={`a-${id}`} className="flex flex-wrap gap-1">
        {!row.resolved && (
          <>
            <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => assignMut.mutate(id)}>Assign</button>
            <button type="button" className="text-[10px] text-green-400" onClick={() => setResolveId(id)}>Resolve</button>
            <button type="button" className="text-[10px] text-red-400" onClick={() => setEscalateId(id)}>Escalate</button>
          </>
        )}
        {row.resolved ? "Resolved" : ""}
      </span>,
    ];
  });

  const runRows = runs.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      new Date(String(row.startedAt ?? row.createdAt)).toLocaleString(),
      String(row.status ?? "—"),
      String(row.settlementsSynced ?? 0),
      String(row.discrepanciesFound ?? (row._count as { discrepancies?: number })?.discrepancies ?? 0),
      row.accuracyPct != null ? `${Number(row.accuracyPct).toFixed(1)}%` : "—",
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settlement Sync</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Reconciliation, resolution workflow, dual approval</p>
        </div>
        <button
          type="button"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
          Run sync
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Settlement accuracy" value={`${metrics.settlementAccuracyPct ?? 100}%`} icon={Scale} loading={isLoading} />
        <KpiCard label="Open discrepancies" value={String(metrics.outstandingVariance ?? 0)} icon={Scale} loading={isLoading} />
        <KpiCard label="Health score" value={`${healthData.healthScore ?? 100}`} icon={Scale} loading={!health} />
        <KpiCard label="Resolution rate" value={`${healthData.resolutionRate ?? 100}%`} icon={Scale} loading={!health} />
      </div>

      <DataTable title="Sync runs" headers={["Started", "Status", "Synced", "Discrepancies", "Accuracy"]} rows={runRows} loading={isLoading} emptyMessage="No sync runs" />
      <DataTable title="Discrepancies" headers={["Type", "Reference", "Expected", "Actual", "Status", "Actions"]} rows={discRows} loading={isLoading} emptyMessage="No discrepancies" />

      <ConfirmDialog
        open={!!resolveId}
        title="Resolve discrepancy"
        description="High-value settlements require dual approval from two different admins."
        reasonLabel="Resolution notes"
        confirmLabel="Resolve"
        isLoading={resolveMut.isPending}
        onClose={() => setResolveId(null)}
        onConfirm={(notes) => { if (resolveId) resolveMut.mutate({ id: resolveId, notes }); }}
      />

      <ConfirmDialog
        open={!!escalateId}
        title="Escalate discrepancy"
        description="Escalation triggers finance alerts for immediate review."
        reasonLabel="Escalation reason"
        reasonRequired
        destructive
        confirmLabel="Escalate"
        isLoading={escalateMut.isPending}
        onClose={() => setEscalateId(null)}
        onConfirm={(reason) => { if (escalateId) escalateMut.mutate({ id: escalateId, reason: reason ?? "" }); }}
      />
    </div>
  );
}

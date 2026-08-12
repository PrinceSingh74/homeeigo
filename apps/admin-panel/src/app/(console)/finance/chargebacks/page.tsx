"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function FinanceChargebacksPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "chargebacks"],
    queryFn: () => adminApi.financeChargebacks(),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "finance", "chargebacks"] });

  const assignMut = useMutation({ mutationFn: (id: string) => adminApi.assignChargeback(id), onSuccess: invalidate });
  const requestEvidenceMut = useMutation({ mutationFn: (id: string) => adminApi.requestChargebackEvidence(id), onSuccess: invalidate });

  const chargebacks = data?.chargebacks ?? [];
  const analytics = (data?.analytics ?? {}) as Record<string, number>;

  const rows = chargebacks.map((c) => {
    const row = c as Record<string, unknown>;
    const id = String(row.id);
    const daysRemaining = row.daysRemaining as number | null;
    const slaBreached = daysRemaining === 0;
    return [
      <Link key={`l-${id}`} href={`/finance/chargebacks/${id}`} className="font-mono text-xs text-[var(--color-biz-accent)] hover:underline">
        {String(row.razorpayDisputeId ?? id).slice(0, 14)}
      </Link>,
      <StatusBadge key={`s-${id}`} status={String(row.displayStatus ?? row.status ?? "OPEN").toLowerCase()} />,
      inr(Number(row.amount ?? 0), true),
      <span key={`d-${id}`} className={slaBreached ? "text-red-400 font-semibold" : ""}>
        {daysRemaining != null ? `${daysRemaining}d` : "—"}
        {slaBreached ? " ⚠" : ""}
      </span>,
      String((row._count as { evidence?: number })?.evidence ?? 0),
      <span key={`a-${id}`} className="flex flex-wrap gap-1">
        <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => assignMut.mutate(id)}>Assign</button>
        <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => requestEvidenceMut.mutate(id)}>Request evidence</button>
        <Link href={`/finance/chargebacks/${id}`} className="text-[10px] text-[var(--color-biz-muted)] hover:text-[var(--color-biz-accent)]">Detail →</Link>
      </span>,
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chargeback Operations</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Dispute workflow, evidence packages, SLA tracking</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Open exposure" value={inr(analytics.openExposure ?? 0, true)} icon={AlertTriangle} loading={isLoading} />
        <KpiCard label="Win rate" value={`${analytics.winRate ?? 0}%`} icon={AlertTriangle} loading={isLoading} />
        <KpiCard label="Loss rate" value={`${analytics.lossRate ?? 0}%`} icon={AlertTriangle} loading={isLoading} />
        <KpiCard label="Recovery" value={inr(analytics.recoveryAmount ?? 0, true)} icon={AlertTriangle} loading={isLoading} />
        <KpiCard label="Chargeback ratio" value={`${analytics.chargebackRatio ?? 0}%`} icon={AlertTriangle} loading={isLoading} />
      </div>

      <DataTable
        title="Active cases"
        headers={["Dispute", "Status", "Amount", "Days left", "Evidence", "Actions"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No chargebacks"
      />
    </div>
  );
}

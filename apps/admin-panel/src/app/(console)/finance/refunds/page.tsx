"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function FinanceRefundsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "refunds"],
    queryFn: () => adminApi.financeRefunds(),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApi.approveRefundRequest(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "refunds"] }),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => adminApi.rejectRefundRequest(id, "Rejected by admin"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "refunds"] }),
  });

  const refunds = data?.refunds ?? [];
  const analytics = (data?.analytics ?? {}) as Record<string, number>;

  const rows = refunds.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      String(row.id ?? "—").slice(0, 10),
      String(row.paymentId ?? "—").slice(0, 10),
      inr(Number(row.amount ?? 0), true),
      String(row.reasonCode ?? "—"),
      <StatusBadge key={`s-${row.id}`} status={String(row.status ?? "requested").toLowerCase()} />,
      ["REQUESTED", "UNDER_REVIEW"].includes(String(row.status)) ? (
        <span key={`a-${row.id}`} className="flex gap-2">
          <button type="button" className="text-xs text-emerald-500" onClick={() => approveMut.mutate(String(row.id))}>
            Approve
          </button>
          <button type="button" className="text-xs text-red-400" onClick={() => rejectMut.mutate(String(row.id))}>
            Reject
          </button>
        </span>
      ) : (
        "—"
      ),
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Refund Operations</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Review queue and approval workflow</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Pending" value={String(analytics.pending ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard label="Completed" value={String(analytics.completed ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard label="Rejected" value={String(analytics.rejected ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard label="Approval rate" value={`${analytics.approvalRatePct ?? 0}%`} icon={RotateCcw} loading={isLoading} />
      </div>

      <DataTable
        title="Refund review queue"
        headers={["Request", "Payment", "Amount", "Reason", "Status", "Actions"]}
        rows={rows}
        isLoading={isLoading}
        emptyMessage="No refund requests"
      />
    </div>
  );
}

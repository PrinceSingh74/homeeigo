"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle, RefreshCw, XCircle } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function FinancePayoutsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectBatchId, setRejectBatchId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "payouts"],
    queryFn: () => adminApi.financePayouts(),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["admin", "finance", "payouts"] });

  const retryMut = useMutation({ mutationFn: (id: string) => adminApi.retryPayout(id), onSuccess: invalidate });
  const createBatchMut = useMutation({
    mutationFn: (ids: string[]) => adminApi.createPayoutBatch(ids),
    onSuccess: () => { setSelected(new Set()); invalidate(); },
  });
  const submitMut = useMutation({ mutationFn: (id: string) => adminApi.submitPayoutBatch(id), onSuccess: invalidate });
  const approveMut = useMutation({ mutationFn: (id: string) => adminApi.approvePayoutBatch(id), onSuccess: invalidate });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rejectPayoutBatch(id, reason),
    onSuccess: () => { setRejectBatchId(null); invalidate(); },
  });
  const processMut = useMutation({ mutationFn: (id: string) => adminApi.processPayoutBatch(id), onSuccess: invalidate });
  const approveWithdrawalMut = useMutation({ mutationFn: (id: string) => adminApi.approveWithdrawal(id), onSuccess: invalidate });
  const processWithdrawalMut = useMutation({ mutationFn: (id: string) => adminApi.processWithdrawal(id), onSuccess: invalidate });

  const queue = useMemo(() => data?.queue ?? [], [data?.queue]);
  const batches = useMemo(() => data?.batches ?? [], [data?.batches]);
  const dashboard = ((data as { dashboard?: Record<string, number | null> } | undefined)?.dashboard ?? {}) as Record<string, number | null>;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const queueRows = queue.map((w) => {
    const row = w as Record<string, unknown>;
    const id = String(row.id);
    const provider = row.provider as { businessName?: string } | undefined;
    const status = String(row.status ?? "REQUESTED");
    return [
      <input
        key={`c-${id}`}
        type="checkbox"
        checked={selected.has(id)}
        onChange={() => toggleSelect(id)}
        disabled={!["REQUESTED", "APPROVED"].includes(status)}
      />,
      String(row.withdrawalNumber ?? id).slice(0, 12),
      provider?.businessName ?? "—",
      inr(Number(row.netAmount ?? row.amount ?? 0), true),
      <StatusBadge key={`s-${id}`} status={status.toLowerCase()} />,
      <span key={`a-${id}`} className="flex flex-wrap gap-1">
        {status === "REQUESTED" && (
          <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => approveWithdrawalMut.mutate(id)}>
            Approve
          </button>
        )}
        {status === "APPROVED" && (
          <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => processWithdrawalMut.mutate(id)}>
            Process
          </button>
        )}
        {status === "FAILED" && (
          <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => retryMut.mutate(id)}>
            Retry
          </button>
        )}
      </span>,
    ];
  });

  const batchRows = batches.map((b) => {
    const row = b as Record<string, unknown>;
    const id = String(row.id);
    const status = String(row.status ?? "DRAFT");
    return [
      String(row.batchNumber ?? id).slice(0, 16),
      <StatusBadge key={`bs-${id}`} status={status.toLowerCase()} />,
      inr(Number(row.totalAmount ?? 0), true),
      String((row._count as { items?: number })?.items ?? row.itemCount ?? 0),
      new Date(String(row.createdAt)).toLocaleDateString(),
      <span key={`ba-${id}`} className="flex flex-wrap gap-1">
        {status === "DRAFT" && (
          <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => submitMut.mutate(id)}>
            Submit
          </button>
        )}
        {status === "UNDER_REVIEW" && (
          <>
            <button type="button" className="text-[10px] text-green-400" onClick={() => approveMut.mutate(id)}>Approve</button>
            <button type="button" className="text-[10px] text-red-400" onClick={() => setRejectBatchId(id)}>Reject</button>
          </>
        )}
        {status === "APPROVED" && (
          <button type="button" className="text-[10px] text-[var(--color-biz-accent)]" onClick={() => processMut.mutate(id)}>
            Process
          </button>
        )}
      </span>,
    ];
  });

  const selectedEligible = useMemo(
    () => queue.filter((w) => selected.has(String((w as Record<string, unknown>).id))).length,
    [queue, selected],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payout Operations</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Batch creation, maker-checker approval, bulk processing</p>
        </div>
        <button
          type="button"
          disabled={selectedEligible === 0 || createBatchMut.isPending}
          onClick={() => createBatchMut.mutate([...selected])}
          className="rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create batch ({selectedEligible})
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Pending" value={String(dashboard.totalPending ?? 0)} icon={Banknote} loading={isLoading} />
        <KpiCard label="Processing" value={String(dashboard.totalProcessing ?? 0)} icon={RefreshCw} loading={isLoading} />
        <KpiCard label="Settled" value={String(dashboard.totalSettled ?? 0)} icon={CheckCircle} accent="green" loading={isLoading} />
        <KpiCard label="Failed" value={String(dashboard.failedPayouts ?? 0)} icon={XCircle} accent="red" loading={isLoading} />
        <KpiCard
          label="Avg settlement"
          value={dashboard.avgSettlementHours != null ? `${dashboard.avgSettlementHours}h` : "—"}
          icon={Banknote}
          loading={isLoading}
        />
      </div>

      <DataTable
        title="Payout queue"
        headers={["", "Withdrawal", "Provider", "Net", "Status", "Actions"]}
        rows={queueRows}
        isLoading={isLoading}
        emptyMessage="No pending payouts"
      />

      <DataTable
        title="Payout batches"
        headers={["Batch", "Status", "Total", "Items", "Created", "Actions"]}
        rows={batchRows}
        isLoading={isLoading}
        emptyMessage="No batches yet"
      />

      <ConfirmDialog
        open={!!rejectBatchId}
        title="Reject payout batch"
        description="Provide a reason for rejection. This action is audited."
        reasonLabel="Rejection reason"
        reasonRequired
        destructive
        confirmLabel="Reject batch"
        isLoading={rejectMut.isPending}
        onClose={() => setRejectBatchId(null)}
        onConfirm={(reason) => { if (rejectBatchId) rejectMut.mutate({ id: rejectBatchId, reason: reason ?? "" }); }}
      />
    </div>
  );
}

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

  // FAILED / INDETERMINATE rows are money the customer is owed with no confirmed outcome; the
  // retry goes through the same idempotent orchestrator path as the original attempt.
  const retryMut = useMutation({
    mutationFn: (bookingId: string) => adminApi.adminRetryBookingRefund(bookingId, "Retried from refund queue"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "refunds"] }),
  });

  const refunds = data?.refunds ?? [];
  const analytics = (data?.analytics ?? {}) as Record<string, number>;

  const rows = refunds.map((r) => {
    const row = r as Record<string, unknown>;
    const status = String(row.status ?? "");
    const bookingId = (row.payment as { bookingId?: string } | undefined)?.bookingId;
    const canRetry = ["FAILED", "INDETERMINATE"].includes(status) && !!bookingId;
    return [
      String(row.id ?? "—").slice(0, 10),
      String(row.paymentId ?? "—").slice(0, 10),
      inr(Number(row.amount ?? 0), true),
      String(row.reasonCode ?? "—"),
      <StatusBadge key={`s-${row.id}`} status={status.toLowerCase() || "requested"} />,
      ["REQUESTED", "UNDER_REVIEW"].includes(status) ? (
        <span key={`a-${row.id}`} className="flex gap-2">
          <button type="button" className="text-xs text-emerald-500" onClick={() => approveMut.mutate(String(row.id))}>
            Approve
          </button>
          <button type="button" className="text-xs text-red-400" onClick={() => rejectMut.mutate(String(row.id))}>
            Reject
          </button>
        </span>
      ) : canRetry ? (
        <button
          key={`r-${row.id}`}
          type="button"
          className="text-xs text-amber-400 disabled:opacity-50"
          disabled={retryMut.isPending}
          onClick={() => retryMut.mutate(String(bookingId))}
        >
          Retry refund
        </button>
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

      <div className="grid gap-4 sm:grid-cols-5">
        <KpiCard label="Pending" value={String(analytics.pending ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard label="Completed" value={String(analytics.completed ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard label="Rejected" value={String(analytics.rejected ?? 0)} icon={RotateCcw} loading={isLoading} />
        <KpiCard
          label="Needs retry"
          // Counted by the backend across every row, not from `refunds` — that array is one capped
          // page. With 303 actionable refunds behind a 100-row page this tile read 100, and the 53
          // INDETERMINATE rows (money with no confirmed outcome) were absent from the count and
          // from the list underneath it.
          value={String(analytics.needsRetry ?? 0)}
          icon={RotateCcw}
          loading={isLoading}
        />
        <KpiCard
          label="Approval rate"
          // No refund requests means the rate is undefined. `?? 0` reported "0% approved", which
          // reads as a platform that rejects everything.
          value={analytics.approvalRatePct == null ? "Not measured" : `${analytics.approvalRatePct}%`}
          icon={RotateCcw}
          loading={isLoading}
        />
      </div>

      {(approveMut.isError || rejectMut.isError || retryMut.isError) && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {/* A rejected money action used to refetch silently; the row simply stayed put with no reason. */}
          The last refund action was refused by the server:{" "}
          {String(((approveMut.error ?? rejectMut.error ?? retryMut.error) as Error | null)?.message ?? "unknown error")}
        </div>
      )}

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

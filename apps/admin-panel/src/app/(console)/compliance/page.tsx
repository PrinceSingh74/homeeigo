"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale, ShieldCheck, UserX } from "lucide-react";
import Link from "next/link";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi, type ComplianceRequest } from "@/services/admin-api";

export default function ComplianceCenterPage() {
  const qc = useQueryClient();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("PENDING");

  const { data: requests, isLoading } = useQuery({
    queryKey: ["admin", "compliance", "requests", statusFilter],
    queryFn: () =>
      adminApi.compliance.listRequests({
        limit: 100,
        status: statusFilter === "ALL" ? "ALL" : statusFilter,
      }),
    refetchInterval: 60_000,
  });

  const { data: retention } = useQuery({
    queryKey: ["admin", "compliance", "retention"],
    queryFn: () => adminApi.compliance.retentionReport(),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApi.compliance.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "compliance"] }),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.compliance.reject(id, reason),
    onSuccess: () => {
      setRejectId(null);
      qc.invalidateQueries({ queryKey: ["admin", "compliance"] });
    },
  });

  const rows = (requests ?? []).map((r: ComplianceRequest) => [
    r.requestType,
    <StatusBadge key={`st-${r.id}`} status={r.status} />,
    r.user?.email ?? r.userId.slice(0, 10),
    new Date(r.submittedAt).toLocaleString(),
    r.dueDateAt ? new Date(r.dueDateAt).toLocaleDateString() : "—",
    r.status === "PENDING" ? (
      <span key={`act-${r.id}`} className="flex gap-2">
        <button
          type="button"
          disabled={approveMut.isPending}
          onClick={() => approveMut.mutate(r.id)}
          className="text-xs font-semibold text-[var(--color-biz-accent)]"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setRejectId(r.id)}
          className="text-xs font-semibold text-red-500"
        >
          Reject
        </button>
      </span>
    ) : (
      "—"
    ),
  ]);

  const pending = (requests ?? []).filter((r) => r.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Compliance Center</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            GDPR / DPDP export and deletion requests — approve, reject, audit
          </p>
        </div>
        <Link
          href="/account-deletions"
          className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
        >
          Deletion audit log
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Pending review" value={String(pending)} icon={Scale} accent={pending > 0 ? "red" : "green"} loading={isLoading} />
        <KpiCard label="Total queue" value={String(requests?.length ?? 0)} icon={ShieldCheck} loading={isLoading} />
        <KpiCard
          label="Retention policies"
          value={String((retention as { policies?: unknown[] })?.policies?.length ?? "—")}
          icon={UserX}
          loading={!retention}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {["PENDING", "APPROVED", "REJECTED", "COMPLETED", "ALL"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              statusFilter === s
                ? "bg-[var(--color-biz-accent)] text-white"
                : "border border-[var(--color-biz-line)] text-[var(--color-biz-muted)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <DataTable
        title="Compliance requests"
        columns={["Type", "Status", "User", "Submitted", "SLA due", "Actions"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No compliance requests in this filter"
      />

      <ConfirmDialog
        open={!!rejectId}
        title="Reject compliance request"
        description="Provide a reason visible in the audit trail."
        confirmLabel="Reject request"
        destructive
        reasonLabel="Rejection reason"
        reasonPlaceholder="Reason for rejection (min 3 characters)"
        isLoading={rejectMut.isPending}
        onClose={() => setRejectId(null)}
        onConfirm={(reason) => {
          if (!rejectId || !reason || reason.trim().length < 3) return;
          rejectMut.mutate({ id: rejectId, reason: reason.trim() });
        }}
      />
    </div>
  );
}

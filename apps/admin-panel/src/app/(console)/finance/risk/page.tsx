"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminApi } from "@/services/admin-api";

export default function FinanceRiskPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "risk"],
    queryFn: () => adminApi.financeRisk(),
  });

  const escalateMut = useMutation({
    mutationFn: (id: string) => adminApi.escalateFraudCase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "risk"] }),
  });

  const liftMut = useMutation({
    mutationFn: (userId: string) => adminApi.liftFinancialHold(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "finance", "risk"] }),
  });

  const cases = data?.cases ?? [];
  const holds = data?.holds ?? [];

  const caseRows = cases.map((c) => {
    const row = c as Record<string, unknown>;
    return [
      String(row.title ?? "—"),
      String(row.category ?? "—"),
      <StatusBadge key={`s-${row.id}`} status={String(row.severity ?? "medium").toLowerCase()} />,
      String(row.status ?? "OPEN"),
      <button
        key={`e-${row.id}`}
        type="button"
        className="text-xs font-semibold text-[var(--color-biz-accent)]"
        onClick={() => escalateMut.mutate(String(row.id))}
      >
        Escalate
      </button>,
    ];
  });

  const holdRows = holds.map((h) => {
    const row = h as Record<string, unknown>;
    return [
      String(row.userId ?? "—").slice(0, 12),
      row.walletFrozen ? "Yes" : "No",
      row.withdrawalsFrozen ? "Yes" : "No",
      row.payoutsFrozen ? "Yes" : "No",
      String(row.reason ?? "").slice(0, 40),
      row.userId ? (
        <button
          key={`l-${row.userId}`}
          type="button"
          className="text-xs font-semibold text-emerald-500"
          onClick={() => liftMut.mutate(String(row.userId))}
        >
          Lift hold
        </button>
      ) : (
        "—"
      ),
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Financial Risk</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Fraud cases, holds, and manual review queue</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard label="Open cases" value={String(cases.length)} icon={ShieldAlert} loading={isLoading} />
        <KpiCard label="Active holds" value={String(holds.length)} icon={ShieldAlert} accent="red" loading={isLoading} />
      </div>

      <DataTable title="Fraud cases" headers={["Title", "Category", "Severity", "Status", "Actions"]} rows={caseRows} isLoading={isLoading} emptyMessage="No open cases" />
      <DataTable title="Financial holds" headers={["User", "Wallet", "Withdrawals", "Payouts", "Reason", "Actions"]} rows={holdRows} isLoading={isLoading} emptyMessage="No active holds" />
    </div>
  );
}

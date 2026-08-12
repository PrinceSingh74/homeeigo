"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function ChargebacksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "chargebacks"],
    queryFn: () => adminApi.chargebacks(),
  });

  const chargebacks = data?.chargebacks ?? [];
  const open = chargebacks.filter((c) => String((c as Record<string, unknown>).status) !== "RESOLVED").length;

  const rows = chargebacks.map((c) => {
    const row = c as Record<string, unknown>;
    return [
      String(row.razorpayDisputeId ?? row.id ?? "—").slice(0, 12),
      <StatusBadge key={`s-${row.id}`} status={String(row.status ?? "OPEN").toLowerCase()} />,
      inr(Number(row.amount ?? 0), true),
      String(row.paymentId ?? "—").slice(0, 10),
      row.receivedAt ? new Date(String(row.receivedAt)).toLocaleString() : "—",
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chargebacks</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Dispute lifecycle and payment reconciliation</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard label="Open disputes" value={String(open)} icon={AlertTriangle} loading={isLoading} />
        <KpiCard label="Total tracked" value={String(chargebacks.length)} icon={AlertTriangle} loading={isLoading} />
      </div>

      <DataTable
        title="Chargeback records"
        headers={["Dispute", "Status", "Amount", "Payment", "Received"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No chargebacks recorded"
      />
    </div>
  );
}

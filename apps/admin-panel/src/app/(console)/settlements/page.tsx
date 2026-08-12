"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function SettlementsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settlements"],
    queryFn: () => adminApi.settlements(),
  });

  const overview = (data?.overview ?? {}) as Record<string, number | string>;
  const batches = data?.batches ?? [];

  const rows = batches.map((b) => {
    const row = b as Record<string, unknown>;
    return [
      String(row.id ?? "—").slice(0, 8),
      String(row.status ?? "—"),
      inr(Number(row.amount ?? 0), true),
      inr(Number(row.netAmount ?? row.amount ?? 0), true),
      row.settledAt ? new Date(String(row.settledAt)).toLocaleDateString() : "—",
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settlements</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Razorpay settlement batches and reconciliation</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total settled"
          value={inr(Number(overview.totalSettledAmount ?? 0), true)}
          icon={Landmark}
          loading={isLoading}
        />
        <KpiCard
          label="Payments settled"
          value={String(overview.paymentsMarkedSettled ?? 0)}
          icon={Landmark}
          loading={isLoading}
        />
        <KpiCard
          label="Open chargebacks"
          value={String(overview.openChargebacks ?? 0)}
          icon={Landmark}
          loading={isLoading}
        />
      </div>

      <DataTable
        title="Settlement batches"
        headers={["ID", "Status", "Gross", "Net", "Settled"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No settlement batches yet"
      />
    </div>
  );
}

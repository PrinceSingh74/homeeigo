"use client";

import { useQuery } from "@tanstack/react-query";
import { Landmark, TrendingUp, Wallet } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { adminKeys } from "@/hooks/use-admin-data";
import { inr } from "@/lib/format";

export default function FinanceDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: adminKeys.financeDashboard(30),
    queryFn: () => adminApi.financeDashboard(30),
  });

  const o = (data?.overview ?? {}) as Record<string, number | { count?: number; amount?: number }>;
  const trend = data?.trend ?? [];
  const settlement = o.settlementPending as { count?: number; amount?: number } | undefined;
  const chargeback = o.chargebackExposure as { count?: number; amount?: number } | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CFO Dashboard</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">GMV, liabilities, and cashflow (30d)</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="GMV" value={inr(Number(o.gmv ?? 0), true)} icon={TrendingUp} loading={isLoading} />
        <KpiCard label="Net revenue" value={inr(Number(o.netRevenue ?? 0), true)} icon={TrendingUp} loading={isLoading} />
        <KpiCard label="MRR" value={inr(Number(o.mrr ?? 0), true)} icon={TrendingUp} loading={isLoading} />
        <KpiCard label="ARR" value={inr(Number(o.arr ?? 0), true)} icon={TrendingUp} loading={isLoading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Wallet liability" value={inr(Number(o.walletLiability ?? 0), true)} icon={Wallet} loading={isLoading} />
        <KpiCard label="Gift card liability" value={inr(Number(o.giftCardLiability ?? 0), true)} icon={Wallet} loading={isLoading} />
        <KpiCard label="Cashback liability" value={inr(Number(o.cashbackLiability ?? 0), true)} icon={Wallet} loading={isLoading} />
        <KpiCard label="Provider payable" value={inr(Number(o.providerPayable ?? 0), true)} icon={Wallet} loading={isLoading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Refund liability" value={inr(Number(o.refundLiability ?? 0), true)} icon={Landmark} loading={isLoading} />
        <KpiCard label="Settlement pending" value={inr(Number(settlement?.amount ?? 0), true)} icon={Landmark} loading={isLoading} />
        <KpiCard label="Chargeback exposure" value={inr(Number(chargeback?.amount ?? 0), true)} icon={Landmark} loading={isLoading} />
      </div>

      <div className="rounded-xl border border-[var(--color-biz-border)] bg-[var(--color-biz-surface)] p-4">
        <h2 className="mb-3 font-semibold">Daily GMV trend</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No payment data in period</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {trend.slice(-14).map((d) => (
              <li key={d.date} className="flex justify-between">
                <span>{d.date}</span>
                <span>{inr(d.amount, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

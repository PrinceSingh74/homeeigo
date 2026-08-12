"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function MembershipCashbackPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "membership", "cashback"],
    queryFn: () => adminApi.subscriptions.cashbackDashboard(),
  });
  const d = data as Record<string, number> | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold">Membership Cashback</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total credited" value={inr(d?.totalCredited ?? 0, true)} icon={Coins} loading={isLoading} />
        <KpiCard label="Pending liability" value={inr(d?.pendingLiability ?? 0, true)} icon={Coins} loading={isLoading} />
        <KpiCard label="This month" value={inr(d?.thisMonthCredited ?? 0, true)} icon={Coins} loading={isLoading} />
      </div>
    </div>
  );
}

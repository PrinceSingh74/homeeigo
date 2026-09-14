"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Pause, Trophy } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";
import { adminApi } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";

type IncentiveRule = {
  id: string;
  code?: string;
  name?: string;
  metric?: string;
  threshold?: number;
  bonusAmount?: number;
  isActive?: boolean;
  period?: string;
};

export default function IncentivesPage() {
  const q = useQuery({
    queryKey: ["admin", "incentives"],
    queryFn: () => adminApi.incentiveRules(),
    staleTime: 30_000,
  });
  const rules = (q.data?.rules ?? []) as IncentiveRule[];
  const active = rules.filter((r) => r.isActive).length;
  const rows = rules.map((r) => [
    r.name || r.code || r.id.slice(0, 8),
    r.metric ?? "—",
    r.threshold != null ? String(r.threshold) : "—",
    r.bonusAmount != null ? inr(r.bonusAmount) : "—",
    r.period ?? "—",
    <StatusBadge key={r.id} status={r.isActive ? "active" : "off"} />,
  ]);

  return (
    <GrowthPage
      icon={Trophy}
      title="Incentives"
      subtitle="Canonical Partner OS bonus rules. Payouts still run through the finance incentive engine — this page does not credit wallets or change job state."
    >
      <CommandCenterRail />
      <div className="grid gap-3.5 sm:grid-cols-3">
        <KpiCard label="Rules" value={formatNumber(rules.length)} sub="Configured bonus rules" icon={Trophy} loading={q.isLoading} />
        <KpiCard label="Active" value={formatNumber(active)} sub="Currently awarding" icon={CheckCircle2} accent="green" loading={q.isLoading} />
        <KpiCard
          label="Paused"
          value={formatNumber(rules.length - active)}
          sub="Not awarding right now"
          icon={Pause}
          accent="amber"
          loading={q.isLoading}
        />
      </div>
      {q.isError ? (
        <div className="biz-glass-panel p-5" role="alert">
          <p className="text-sm font-semibold">Incentive rules need CAMPAIGNS:READ.</p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            This list is read-only. Wallet credits happen only when the finance engine posts an earning.
          </p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <DataTable
          title="Bonus rules"
          hint="Threshold is the metric target. Bonus is the amount the engine may post after the job completes."
          icon={Trophy}
          iconTone="warning"
          columns={["Rule", "Metric", "Threshold", "Bonus", "Period", "Status"]}
          rows={rows}
          loading={q.isLoading}
          emptyMessage="No bonus rules are configured"
          emptyDescription="When operations adds Partner OS incentive rules, they will list here with metric, threshold, and bonus."
        />
      )}
    </GrowthPage>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { SectionHead } from "@/components/hq/SectionHead";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";
import { adminApi } from "@/services/admin-api";

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
  const rows = rules.map((r) => [
    r.name || r.code || r.id.slice(0, 8),
    r.metric ?? "—",
    r.threshold != null ? String(r.threshold) : "—",
    r.bonusAmount != null ? `₹${r.bonusAmount}` : "—",
    r.period ?? "—",
    <StatusBadge key={r.id} status={r.isActive ? "active" : "off"} />,
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <CommandCenterRail />
      <SectionHead
        icon={Trophy}
        tone="warning"
        title="Incentives"
        subtitle="Canonical Partner OS bonus rules. Payouts still run through the Section 04 incentive engine — this page does not credit wallets."
        as="h1"
      />
      {q.isError ? (
        <div className="biz-glass-panel p-4" role="alert">
          <p className="text-sm">Incentive rules need CAMPAIGNS:READ.</p>
          <button type="button" className="biz-btn mt-3 text-xs" onClick={() => void q.refetch()}>Retry</button>
        </div>
      ) : (
        <DataTable
          title="Bonus rules"
          columns={["Rule", "Metric", "Threshold", "Bonus", "Period", "Status"]}
          rows={rows}
          loading={q.isLoading}
          emptyMessage="No bonus rules are configured."
        />
      )}
    </div>
  );
}

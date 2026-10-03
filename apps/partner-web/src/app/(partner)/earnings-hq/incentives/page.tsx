"use client";

import { Award } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerIncentivesQuery } from "@/hooks/use-partner-os";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function IncentivesPage() {
  const incentives = usePartnerIncentivesQuery();
  const rules = incentives.data?.rules ?? [];
  const loading = incentives.isLoading && !incentives.data;
  const error =
    incentives.isError && !incentives.data
      ? incentives.error instanceof Error
        ? incentives.error.message
        : "Incentive rules could not be loaded."
      : null;

  return (
    <HqPageShell
      title="Incentives Center"
      description="Daily, weekly, monthly bonuses and streak rewards from admin-configured incentive rules."
      icon={Award}
      loading={loading}
      error={error}
      onRetry={() => void incentives.refetch()}
      stats={
        incentives.data
          ? rules.slice(0, 4).map((r) => ({
              label: r.name,
              value: `${r.current}/${r.threshold}`,
              hint: r.paid
                ? `Paid · ${inr(r.payoutAmount ?? r.bonusAmount)}`
                : r.eligible
                  ? `Eligible · ${inr(r.bonusAmount)}`
                  : `Bonus ${inr(r.bonusAmount)}`,
            }))
          : undefined
      }
    >
      {incentives.data ? (
        <>
          <section className="space-y-3">
            {rules.length === 0 ? (
              <p className="partner-card p-5 text-sm text-partner-muted">
                No incentive rules are active yet. Completing jobs still posts earnings to your wallet.
              </p>
            ) : (
              rules.map((rule) => (
                <article key={rule.id} className="partner-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{rule.name}</p>
                      <p className="text-xs text-partner-muted">
                        {rule.period} · {rule.metric}
                      </p>
                    </div>
                    <p className="font-display text-lg font-bold">{inr(rule.bonusAmount)}</p>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-partner-surface">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#f6f1d6] to-[#d8ead7] dark:from-partner-primary dark:to-partner-accent"
                      style={{ width: `${rule.progressPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-partner-muted">
                    {rule.progressPct}% · {rule.paid ? "Paid" : rule.eligible ? "Eligible" : "In progress"}
                  </p>
                </article>
              ))
            )}
          </section>
          <p className="text-sm text-partner-muted">Streak: {incentives.data.streakDays} active days (7-day window)</p>
        </>
      ) : null}
    </HqPageShell>
  );
}

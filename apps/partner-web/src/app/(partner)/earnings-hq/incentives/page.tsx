"use client";

import { Award } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerIncentivesQuery } from "@/hooks/use-partner-os";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function IncentivesPage() {
  const incentives = usePartnerIncentivesQuery();
  const rules = incentives.data?.rules ?? [];

  return (
    <HqPageShell
      title="Incentives Center"
      description="Daily, weekly, monthly bonuses and streak rewards from admin-configured incentive rules."
      icon={Award}
      stats={rules.slice(0, 4).map((r) => ({
        label: r.name,
        value: `${r.current}/${r.threshold}`,
        hint: r.eligible ? `Eligible · ${inr(r.bonusAmount)}` : `Bonus ${inr(r.bonusAmount)}`,
      }))}
    >
      <section className="space-y-3">
        {rules.map((rule) => (
          <article key={rule.id} className="partner-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{rule.name}</p>
                <p className="text-xs text-partner-muted">{rule.period} · {rule.metric}</p>
              </div>
              <p className="font-display text-lg font-bold">{inr(rule.bonusAmount)}</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-partner-surface">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#f6f1d6] to-[#d8ead7] dark:from-partner-primary dark:to-partner-accent"
                style={{ width: `${rule.progressPct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-partner-muted">{rule.progressPct}% · {rule.eligible ? "Eligible" : "In progress"}</p>
          </article>
        ))}
      </section>
      <p className="text-sm text-partner-muted">Streak: {incentives.data?.streakDays ?? 0} active days (7-day window)</p>
    </HqPageShell>
  );
}

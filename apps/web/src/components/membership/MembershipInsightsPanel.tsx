"use client";

import { Crown, Percent, Sparkles, Wallet } from "lucide-react";
import { useMembershipInsights } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function MembershipInsightsPanel({ className }: { className?: string }) {
  const { data, isLoading } = useMembershipInsights();

  if (isLoading) {
    return (
      <div className={cn("rounded-2xl border border-line bg-surface p-4 text-sm text-muted", className)}>
        Loading membership insights…
      </div>
    );
  }

  if (!data?.entitlements.hasMembership) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-emerald-500/40 bg-emerald-500/5 p-4", className)}>
        <p className="text-sm font-medium text-content">Unlock premium insights</p>
        <p className="mt-1 text-xs text-muted">
          Upgrade to see cashback history, benefit usage, and quota tracking.
        </p>
      </div>
    );
  }

  const { entitlements, recentBenefitUsage, cashbackSummary } = data;

  return (
    <section className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InsightPill icon={Percent} label="Discount" value={`${entitlements.discountPct}%`} />
        <InsightPill icon={Wallet} label="Cashback" value={`${entitlements.cashbackPct}%`} />
        <InsightPill
          icon={Sparkles}
          label="Cashback earned"
          value={inr(cashbackSummary.totalCredited)}
        />
        <InsightPill icon={Crown} label="Plan" value={entitlements.planName ?? "Premium"} />
      </div>

      {recentBenefitUsage.length > 0 && (
        <div className="rounded-xl border border-line bg-surface/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Benefit usage</p>
          <ul className="mt-2 space-y-1.5">
            {recentBenefitUsage.slice(0, 5).map((u) => (
              <li key={`${u.benefitType}-${u.period}`} className="flex justify-between text-xs">
                <span className="text-content">{u.benefitType.replace(/_/g, " ")}</span>
                <span className="text-muted">
                  {u.count}× · {inr(u.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function InsightPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Crown;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface/80 p-3">
      <Icon size={14} className="text-emerald-700" aria-hidden />
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-sm font-bold text-content">{value}</p>
    </div>
  );
}

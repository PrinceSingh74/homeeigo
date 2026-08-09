"use client";

import { Crown } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerRewardsOsQuery } from "@/hooks/use-partner-os";
import Link from "next/link";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function RewardsPage() {
  const rewards = usePartnerRewardsOsQuery();
  const data = rewards.data;

  return (
    <HqPageShell
      title="Rewards HQ"
      description="Badges, milestones, referrals, and incentive earnings."
      icon={Crown}
      stats={[
        { label: "Badges", value: data?.badges.length ?? 0 },
        { label: "Referrals", value: data?.referralCount ?? 0 },
        { label: "Incentive earnings", value: inr(data?.incentiveEarnings ?? 0) },
        { label: "Milestones hit", value: data?.milestones.filter((m) => m.achieved).length ?? 0 },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/rewards/badges" className="partner-card partner-card-hover p-4">Badges</Link>
        <Link href="/rewards/referrals" className="partner-card partner-card-hover p-4">Referrals</Link>
      </div>
      <section className="mt-4 space-y-2">
        {(data?.milestones ?? []).map((m) => (
          <div key={m.label} className="partner-card p-4">
            <div className="flex justify-between text-sm font-semibold">
              <span>{m.label}</span>
              <span>{m.achieved ? "Achieved" : `${m.progressPct}%`}</span>
            </div>
          </div>
        ))}
      </section>
    </HqPageShell>
  );
}

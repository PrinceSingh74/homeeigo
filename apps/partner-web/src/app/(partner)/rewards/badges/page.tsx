"use client";

import { Award } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerRewardsOsQuery } from "@/hooks/use-partner-os";

const BADGE_LABELS: Record<string, string> = {
  super_star: "Super Star",
  expert: "Expert",
  trusted: "Trusted",
  quick_responder: "Quick Responder",
  punctual: "Punctual",
};

export default function RewardsBadgesPage() {
  const rewards = usePartnerRewardsOsQuery();
  const badges = rewards.data?.badges ?? [];

  return (
    <HqPageShell
      title="Badges"
      description="Achievement badges from provider profile — computed server-side from ratings and volume."
      icon={Award}
      stats={[{ label: "Earned badges", value: badges.length }]}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {badges.length === 0 ? (
          <p className="text-sm text-partner-muted">Complete more jobs with high ratings to unlock badges.</p>
        ) : (
          badges.map((badge) => (
            <article key={badge} className="partner-card p-4 text-center">
              <Award className="mx-auto h-8 w-8 text-amber-500" />
              <p className="mt-2 font-semibold">{BADGE_LABELS[badge] ?? badge}</p>
            </article>
          ))
        )}
      </div>
    </HqPageShell>
  );
}

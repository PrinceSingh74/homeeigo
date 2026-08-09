"use client";

import { Trophy } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerRankingsQuery } from "@/hooks/use-partner-os";

export default function RankingsPage() {
  const rankings = usePartnerRankingsQuery();
  const data = rankings.data;

  return (
    <HqPageShell
      title="Rankings"
      description="City, area, and category rankings from provider performance composite scores."
      icon={Trophy}
      stats={[
        { label: "City Rank", value: data ? `#${data.cityRank} / ${data.cityTotal}` : "—", hint: data?.city },
        { label: "Area Rank", value: data ? `#${data.areaRank} / ${data.areaTotal}` : "—", hint: data?.areaName },
        { label: "Composite Score", value: data?.compositeScore ?? "—" },
        { label: "Categories", value: data?.categoryRanks.length ?? 0 },
      ]}
    >
      <section className="partner-card p-4">
        <h2 className="font-semibold">Category rankings</h2>
        <div className="mt-3 space-y-2">
          {(data?.categoryRanks ?? []).map((row) => (
            <div key={row.category} className="flex justify-between rounded-lg border border-partner-line px-3 py-2 text-sm">
              <span>{row.category}</span>
              <span className="font-semibold">#{row.rank} / {row.total}</span>
            </div>
          ))}
        </div>
      </section>
    </HqPageShell>
  );
}

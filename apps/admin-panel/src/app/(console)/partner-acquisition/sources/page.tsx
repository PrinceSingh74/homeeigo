"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { adminApi } from "@/services/admin-api";
import { cn } from "@/lib/cn";

const RANGES = ["7d", "30d", "90d"] as const;

export default function PartnerAcquisitionSourcesPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const sources = useQuery({
    queryKey: ["admin", "partner-acquisition", "sources", range],
    queryFn: () => adminApi.partnerAcquisition.sources(range),
  });

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Source Performance"
        subtitle="Which acquisition channels produce the best active partners? Cost columns appear only when spend is recorded."
        action={
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] p-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold uppercase",
                    range === r ? "bg-[var(--color-biz-accent)] text-[#05070d]" : "text-[var(--color-biz-text)]",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Link
              href="/partner-acquisition/analytics"
              className="rounded-xl border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold"
            >
              Cost analytics
            </Link>
          </div>
        }
      />
      <GlassPanel className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-[var(--color-biz-elevated)] text-left text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">
              <tr>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Leads</th>
                <th className="px-4 py-3">Applications</th>
                <th className="px-4 py-3">KYC</th>
                <th className="px-4 py-3">Activated</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">App %</th>
                <th className="px-4 py-3">Activation %</th>
                <th className="px-4 py-3">Cost / activated</th>
              </tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((s) => (
                <tr key={s.source} className="border-t border-[var(--color-biz-line)]">
                  <td className="px-4 py-3 font-semibold">{s.source}</td>
                  <td className="px-4 py-3 tabular-nums">{s.leads}</td>
                  <td className="px-4 py-3 tabular-nums">{s.applications}</td>
                  <td className="px-4 py-3 tabular-nums">{s.kycStarted}</td>
                  <td className="px-4 py-3 tabular-nums">{s.activated}</td>
                  <td className="px-4 py-3 tabular-nums">{s.active}</td>
                  <td className="px-4 py-3 tabular-nums">{s.applicationRate ?? 0}%</td>
                  <td className="px-4 py-3 font-semibold tabular-nums text-[var(--color-biz-success)]">{s.activationRate}%</td>
                  <td className="px-4 py-3 tabular-nums">{s.costPerActivation != null ? `₹${s.costPerActivation}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}

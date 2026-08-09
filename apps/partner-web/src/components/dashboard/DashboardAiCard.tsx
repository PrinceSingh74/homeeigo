"use client";

import Link from "next/link";
import { Bot, Sparkles, Star, Route, Clock } from "lucide-react";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { partnerLayout } from "@/lib/partner-layout";
import { formatInr } from "@/lib/format";
import { cn } from "@/lib/cn";

function buildSuggestions(args: {
  pending: number;
  todayEarnings: number;
  acceptanceRate: number;
  rating: number;
}): Array<{ id: string; icon: typeof Star; text: string }> {
  const out: Array<{ id: string; icon: typeof Star; text: string }> = [];
  if (args.pending > 0) {
    out.push({
      id: "pending",
      icon: Sparkles,
      text: `${args.pending} pending request${args.pending === 1 ? "" : "s"} — respond within 5 minutes for higher acceptance.`,
    });
  }
  if (args.acceptanceRate < 0.85) {
    out.push({
      id: "acc",
      icon: Star,
      text: "Your acceptance rate is below 85% — bonuses unlock at 90%+.",
    });
  }
  if (args.rating > 0 && args.rating < 4.7) {
    out.push({
      id: "rating",
      icon: Star,
      text: "Lift your rating above 4.7 to qualify for the perfect-rating bonus.",
    });
  }
  out.push({
    id: "route",
    icon: Route,
    text: "Cluster nearby jobs to save travel time and boost ₹/hour.",
  });
  out.push({
    id: "clock",
    icon: Clock,
    text: "Peak demand 10AM–2PM and 6PM–9PM in most zones.",
  });
  return out.slice(0, 3);
}

export function DashboardAiCard() {
  const { data, isLoading } = usePartnerDashboardQuery();

  const todayEarnings = data?.earnings.today ?? 0;
  const pending = data?.counts.pendingRequests ?? 0;
  const rating = data?.rating ?? 0;
  const acceptanceRate = data?.rates.acceptanceRate ?? 0;

  const headline =
    pending > 0
      ? `${pending} new request${pending === 1 ? "" : "s"} waiting. Accept fast to lift acceptance rate.`
      : todayEarnings > 0
        ? `You've earned ${formatInr(todayEarnings)} today. Keep momentum going through peak hours.`
        : "Go online to start receiving live job requests in your zone.";

  const suggestions = buildSuggestions({
    pending,
    todayEarnings,
    acceptanceRate,
    rating,
  });

  return (
    <div
      className={cn(
        "partner-ai-gradient flex h-full flex-col",
        partnerLayout.cardRadius,
        partnerLayout.cardPad,
      )}
    >
      <div className={partnerLayout.sectionHeader}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-partner-purple/25">
            <Bot className="h-5 w-5 text-partner-purple" />
          </div>
          <h2 className={partnerLayout.sectionTitle}>AI Assistant</h2>
          <span className="rounded-md bg-partner-purple/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-partner-purple">
            Live
          </span>
        </div>
      </div>

      <p className="flex gap-2.5 text-xs leading-relaxed text-partner-text-secondary">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-partner-purple" />
        {isLoading ? "Analysing your day…" : headline}
      </p>

      <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wider text-partner-muted">
        Tips for you
      </p>
      <ul className={cn(partnerLayout.listGap, "flex-1")}>
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-xs font-medium text-partner-text-secondary"
          >
            <s.icon className="h-3.5 w-3.5 shrink-0 text-partner-success" />
            {s.text}
          </li>
        ))}
      </ul>

      <Link
        href="/ai"
        className="mt-5 inline-block text-xs font-semibold text-partner-primary transition hover:underline"
      >
        Open full assistant →
      </Link>
    </div>
  );
}

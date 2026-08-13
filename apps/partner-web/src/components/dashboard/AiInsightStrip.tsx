"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, ChevronRight, Route, Star, TrendingUp } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { formatInr } from "@/lib/format";

export function AiInsightStrip() {
  const { data, isLoading } = usePartnerDashboardQuery();
  const pending = data?.counts.pendingRequests ?? 0;
  const todayEarnings = data?.earnings.today ?? 0;
  const acceptanceRate = Math.round(data?.rates.acceptanceRate ?? 0);

  const cards = [
    {
      id: "pending",
      icon: TrendingUp,
      title:
        pending > 0
          ? `${pending} pending request${pending === 1 ? "" : "s"}`
          : "No pending requests",
      body:
        pending > 0
          ? "Accept within 5 minutes to keep your rate above 90%."
          : "You're caught up. Stay online for new requests.",
    },
    {
      id: "earnings",
      icon: Bot,
      title: `Today: ${formatInr(todayEarnings)}`,
      body:
        todayEarnings > 0
          ? "Keep accepting clustered jobs to boost ₹/hour."
          : "Go online to start earning today.",
    },
    {
      id: "acceptance",
      icon: Route,
      title: `Acceptance ${acceptanceRate}%`,
      body:
        acceptanceRate >= 90
          ? "Excellent — qualifies for perfect-acceptance bonus."
          : "Lift above 90% to unlock weekly bonus.",
    },
    {
      id: "rating",
      icon: Star,
      title: `Rating ${(data?.rating ?? 0).toFixed(1)}`,
      body:
        (data?.rating ?? 0) >= 4.7
          ? "Top-tier rating — keep doing what you're doing."
          : "Aim for 4.7+ for perfect-rating bonus.",
    },
  ];

  return (
    <PartnerCard glass className="border-partner-primary/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-partner-primary/20">
            <Bot className="h-5 w-5 text-partner-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-partner-primary">
              AI Insight
            </p>
            <p className="mt-1 font-semibold">
              {isLoading ? "Analysing your day…" : cards[0].title}
            </p>
            <p className="mt-1 text-sm text-partner-muted">
              {isLoading ? "" : cards[0].body}
            </p>
          </div>
        </div>
        <Link
          href="/ai"
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-partner-primary hover:underline"
        >
          More <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 partner-scroll">
        {cards.map((insight, i) => (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="min-w-[200px] shrink-0 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2"
          >
            <insight.icon className="mb-1 h-4 w-4 text-partner-primary" />
            <p className="text-xs font-semibold">{insight.title}</p>
          </motion.div>
        ))}
      </div>
    </PartnerCard>
  );
}

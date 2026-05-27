"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, ChevronRight, Route, TrendingUp } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { DEMO_AI_INSIGHTS_LIST } from "@/lib/partner-data";

const icons = {
  earn: TrendingUp,
  schedule: Bot,
  route: Route,
};

export function AiInsightStrip() {
  const top = DEMO_AI_INSIGHTS_LIST[0];

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
            <p className="mt-1 font-semibold">{top.title}</p>
            <p className="mt-1 text-sm text-partner-muted">{top.body}</p>
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
        {DEMO_AI_INSIGHTS_LIST.map((insight, i) => {
          const Icon = icons[insight.type];
          return (
            <motion.div
              key={insight.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="min-w-[200px] shrink-0 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2"
            >
              <Icon className="mb-1 h-4 w-4 text-partner-primary" />
              <p className="text-xs font-semibold">{insight.title}</p>
            </motion.div>
          );
        })}
      </div>
    </PartnerCard>
  );
}

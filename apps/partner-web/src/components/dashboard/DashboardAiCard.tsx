"use client";

import Link from "next/link";
import { Bot, Sparkles, Star, Route, Clock } from "lucide-react";
import { DEMO_AI_INSIGHTS } from "@/lib/partner-data";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

const iconMap = {
  star: Star,
  route: Route,
  clock: Clock,
} as const;

export function DashboardAiCard() {
  return (
    <div
      className={cn(
        "partner-ai-gradient flex h-full flex-col",
        partnerLayout.cardRadius,
        partnerLayout.cardPad
      )}
    >
      <div className={partnerLayout.sectionHeader}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-partner-purple/25">
            <Bot className="h-5 w-5 text-partner-purple" />
          </div>
          <h2 className={partnerLayout.sectionTitle}>AI Assistant</h2>
          <span className="rounded-md bg-partner-purple/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-partner-purple">
            New
          </span>
        </div>
      </div>

      <p className="flex gap-2.5 text-xs leading-relaxed text-partner-text-secondary">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-partner-purple" />
        {DEMO_AI_INSIGHTS.headline}
      </p>

      <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wider text-partner-muted">
        Suggestions for you
      </p>
      <ul className={cn(partnerLayout.listGap, "flex-1")}>
        {DEMO_AI_INSIGHTS.suggestions.map((s) => {
          const Icon = iconMap[s.icon];
          return (
            <li
              key={s.id}
              className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-xs font-medium text-partner-text-secondary"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-partner-success" />
              {s.text}
            </li>
          );
        })}
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

"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Lightbulb,
  Snowflake,
  TrendingDown,
  UtensilsCrossed,
} from "lucide-react";
import { profilePanelPad, profilePanelShell } from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { PROFILE_INSIGHTS } from "@/lib/profile-dashboard";
import { useAppStore } from "@/stores/app-store";

const INSIGHT_ICONS = {
  snowflake: Snowflake,
  chef: UtensilsCrossed,
  trending: TrendingDown,
} as const;

export function AIInsights() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className={cn(profilePanelShell, profilePanelPad)}
    >
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-content sm:text-lg">
          <Lightbulb size={15} className="shrink-0 text-primary sm:size-4" />
          <span className="truncate">AI Home Insights</span>
        </h2>
        <button
          type="button"
          onClick={() => showToast("More insights coming soon", "info")}
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          View All
        </button>
      </div>

      <ul className="flex flex-col gap-3">
        {PROFILE_INSIGHTS.map((insight, i) => {
          const Icon = INSIGHT_ICONS[insight.icon as keyof typeof INSIGHT_ICONS];
          return (
            <motion.li
              key={insight.id}
              initial={reduce ? false : { opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
            >
              <button
                type="button"
                onClick={() =>
                  showToast("Opening AI insight — book from AI Assistant", "info")
                }
                className={cn(
                  "group flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition duration-200 hover:translate-x-0.5 sm:gap-4 sm:p-4 sm:hover:translate-x-1",
                  insight.bg,
                  insight.border,
                )}
              >
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-[10px] text-white",
                    insight.iconBg,
                  )}
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold text-content">
                    {insight.title}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-muted">
                    {insight.description}
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-muted opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                />
              </button>
            </motion.li>
          );
        })}
      </ul>
    </motion.section>
  );
}

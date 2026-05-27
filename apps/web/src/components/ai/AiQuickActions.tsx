"use client";

import Link from "next/link";
import {
  Bot,
  Calendar,
  Droplets,
  Shield,
  Sparkles,
  SprayCan,
  Thermometer,
} from "lucide-react";
import { motion } from "framer-motion";
import { AI_SMART_ACTIONS } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import { cn } from "@/lib/utils";
import { aiCard3d, aiSection, aiSmartActionsGrid } from "@/components/ai/ai-page-layout";
import { fadeUp } from "@/components/ai/ai-motion";

const ACTION_ICONS = [SprayCan, Thermometer, Droplets, Shield, Calendar, Bot] as const;

export function AiQuickActions() {
  const { onSmartAction } = useAiPageActions();

  return (
    <section id={AI_SECTION_IDS.smartActions} className={cn(aiSection, "scroll-mt-24")}>
      <AiSectionHeader
        title="Smart Actions"
        subtitle="One-tap shortcuts for booking, diagnosis, and AI-powered home care."
      />
      <div className={cn("mt-3 sm:mt-5", aiSmartActionsGrid)}>
        {AI_SMART_ACTIONS.map((action, i) => {
          const Icon = ACTION_ICONS[i] ?? Sparkles;
          const lines = action.title.split("\n");
          const inner = (
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              custom={i}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.96 }}
              className={cn(
                aiCard3d,
                "flex h-[104px] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center min-[380px]:h-[112px] sm:h-[120px] sm:gap-3 sm:rounded-[18px] sm:p-4 lg:h-[140px] lg:p-5",
                "hover:border-primary/30 hover:bg-gradient-to-br hover:from-[#EFF6FF]/90 hover:to-[#F0F9FF]/90",
                "dark:hover:border-indigo-400/30 dark:hover:from-indigo-950/80 dark:hover:to-slate-900/80",
              )}
            >
              <span
                className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br sm:size-12 lg:size-14 ${action.gradient} text-white shadow-[0_4px_12px_rgb(0_0_0/0.1)]`}
              >
                <Icon size={22} strokeWidth={2} className="sm:hidden" />
                <Icon size={24} strokeWidth={2} className="hidden sm:block lg:hidden" />
                <Icon size={28} strokeWidth={2} className="hidden lg:block" />
              </span>
              <span className="font-display text-sm font-bold leading-tight tracking-tight text-ink dark:text-slate-100">
                {lines.map((line, idx) => (
                  <span key={idx} className="block">
                    {line}
                  </span>
                ))}
              </span>
            </motion.div>
          );

          if ("href" in action && action.href) {
            return (
              <Link key={action.id} href={action.href} className="min-w-0">
                {inner}
              </Link>
            );
          }

          return (
            <button
              key={action.id}
              type="button"
              className="min-w-0 text-left"
              onClick={() =>
                onSmartAction({
                  id: action.id,
                  prompt: "prompt" in action ? action.prompt : undefined,
                  href:
                    "href" in action && typeof action.href === "string"
                      ? action.href
                      : undefined,
                })
              }
            >
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}

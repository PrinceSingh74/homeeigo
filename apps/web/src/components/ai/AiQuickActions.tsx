"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Calendar,
  Droplets,
  Shield,
  Sparkles,
  SprayCan,
  Thermometer,
} from "lucide-react";
import { m as motion } from "framer-motion";
import { AI_SMART_ACTIONS } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import { cn } from "@/lib/utils";
import { aiSection, aiSmartActionsGrid } from "@/components/ai/ai-page-layout";
import { fadeUp } from "@/components/ai/ai-motion";

const ACTION_ICONS = [SprayCan, Thermometer, Droplets, Shield, Calendar, Bot] as const;

/**
 * Smart Actions as dark "command console" tiles matching the Neural Command
 * Deck hero — mono index, emerald icon ring, corner arrow, glow on hover.
 * Same actions/handlers as before; only the visual shell changed.
 */
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
                "group relative flex h-[104px] flex-col justify-between overflow-hidden rounded-2xl p-3 text-left",
                "min-[380px]:h-[112px] sm:h-[124px] sm:rounded-[18px] sm:p-4 lg:h-[142px]",
                "bg-[linear-gradient(155deg,#07281f_0%,#041a13_100%)] ring-1 ring-emerald-400/15",
                "shadow-[0_14px_34px_-16px_rgb(3_35_26/0.8),inset_0_1px_0_rgb(255_255_255/0.06)]",
                "transition-[box-shadow,ring-color] duration-300",
                "hover:ring-emerald-400/45 hover:shadow-[0_20px_44px_-16px_rgb(16_185_129/0.45),inset_0_1px_0_rgb(255_255_255/0.08)]",
              )}
            >
              {/* Corner glow that wakes on hover */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-emerald-400/0 blur-2xl transition-colors duration-300 group-hover:bg-emerald-400/25"
              />
              {/* Mono index + arrow */}
              <span className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1">
                <span className="font-mono text-[9px] font-semibold tracking-[0.18em] text-emerald-300/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <ArrowUpRight
                  size={13}
                  className="text-emerald-300/0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-emerald-300"
                  aria-hidden
                />
              </span>

              <span
                className={cn(
                  "grid size-9 place-items-center rounded-xl text-emerald-200 sm:size-10 lg:size-11",
                  "bg-emerald-400/10 ring-1 ring-emerald-400/30",
                  "transition-transform duration-300 group-hover:scale-110",
                )}
              >
                <Icon size={18} strokeWidth={2} className="sm:hidden" />
                <Icon size={20} strokeWidth={2} className="hidden sm:block" />
              </span>

              <span className="font-display text-[13px] font-bold leading-tight tracking-tight text-emerald-50 sm:text-sm">
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

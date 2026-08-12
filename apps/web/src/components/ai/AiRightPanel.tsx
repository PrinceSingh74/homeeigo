"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Droplets,
  Leaf,
  Shield,
  Sparkles,
  SprayCan,
  Thermometer,
  Zap,
} from "lucide-react";
import { m as motion, useReducedMotion } from "framer-motion";
import {
  AI_INSIGHTS,
  AI_PREDICTIONS,
  AI_RECOMMENDED,
} from "@/lib/ai-dashboard";
import { AiLiveTrackingCard } from "@/components/ai/AiLiveTrackingCard";
import { AiRightPanelBlockHeader } from "@/components/ai/AiRightPanelBlockHeader";
import {
  aiRightBlock,
  aiRightBrandStrip,
  aiRightInsightCard,
  aiRightPredictionsGrid,
  aiRightRail,
  aiRightShell,
} from "@/components/ai/ai-page-layout";
import { fadeUp } from "@/components/ai/ai-motion";
import { cn } from "@/lib/utils";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";

const INSIGHT_ICONS = [Thermometer, Leaf, Droplets, Sparkles] as const;
const PREDICTION_ICONS = [SprayCan, Droplets, Thermometer, Shield] as const;

function RightBrandHeader() {
  return (
    <div className={aiRightBrandStrip}>
      <div
        className="pointer-events-none absolute -right-4 -top-4 size-24 rounded-full bg-white/20 blur-2xl"
        aria-hidden
      />
      <div className="relative flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
          <Sparkles size={20} className="text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">
            HOMEEIGO Intelligence
          </p>
          <p className="font-display text-base font-bold tracking-tight">AI Insights Hub</p>
        </div>
      </div>
      <p className="relative mt-2 text-[11px] leading-relaxed text-white/85">
        Personalized actions for your home — updated in real time.
      </p>
    </div>
  );
}

export function AiRightPanel() {
  const reduce = useReducedMotion();
  const {
    runInsightAction,
    runPredictionAction,
    viewAllInsights,
    viewAllPredictions,
  } = useAiPageActions();

  return (
    <aside className={aiRightRail} aria-label="AI insights sidebar">
      <div className={aiRightShell}>
        <RightBrandHeader />

        {/* Live tracking — desktop sidebar only (mobile block is in main column) */}
        <section className={cn(aiRightBlock, "hidden xl:block")}>
          <AiRightPanelBlockHeader
            title="Live Tracking"
            href="/bookings"
            actionLabel="Details"
          />
          <AiLiveTrackingCard embedded />
        </section>

        {/* AI Home Insights */}
        <section className={aiRightBlock}>
          <AiRightPanelBlockHeader
            title="AI Home Insights"
            actionLabel="View All"
            onAction={viewAllInsights}
          />
          <ul className="flex flex-col gap-2.5">
            {AI_INSIGHTS.map((item, i) => {
              const Icon = INSIGHT_ICONS[i] ?? Sparkles;
              return (
                <motion.li
                  key={item.id}
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true }}
                  custom={i}
                  className={cn(
                    aiRightInsightCard,
                    item.bg,
                    item.border,
                    "cursor-pointer",
                  )}
                  onClick={() => runInsightAction(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      runInsightAction(item.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-[0_4px_12px_rgb(0_0_0/0.12)]",
                      item.gradient,
                    )}
                  >
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold leading-tight text-ink">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-[1.4] text-slate">{item.description}</p>
                    {"cta" in item && item.cta && (
                      <span className="mt-2 inline-flex items-center gap-0.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                        {item.cta}
                        <ArrowRight size={10} />
                      </span>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </section>

        {/* Recommended */}
        <section className={aiRightBlock}>
          <AiRightPanelBlockHeader
            title="Recommended for You"
            href="/services"
            actionLabel="View All"
          />
          <motion.article
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            whileHover={reduce ? undefined : { y: -2 }}
            className="ai-card-3d overflow-hidden rounded-2xl border border-emerald-400/15 transition hover:border-emerald-400/35"
          >
            <div className="relative h-36 w-full bg-emerald-950/60">
              <Image
                src={AI_RECOMMENDED.image}
                alt={AI_RECOMMENDED.title}
                fill
                className="object-cover"
                sizes="(max-width: 1280px) 100vw, 340px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
              <span className="absolute left-3 top-3 rounded-full bg-violet px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-md">
                {AI_RECOMMENDED.tag}
              </span>
            </div>
            <div className="space-y-2.5 p-3.5">
              <h4 className="font-display text-sm font-bold leading-tight text-ink">
                {AI_RECOMMENDED.title}
              </h4>
              <p className="flex items-center gap-1 text-[11px] text-slate">
                <Zap size={12} className="text-amber-500" />
                {AI_RECOMMENDED.rating} ({AI_RECOMMENDED.reviews}) · {AI_RECOMMENDED.provider}
              </p>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <p className="font-display text-lg font-bold text-ink">
                    ₹{AI_RECOMMENDED.price}
                    <span className="ml-1.5 text-xs font-normal text-slate line-through">
                      ₹{AI_RECOMMENDED.originalPrice}
                    </span>
                  </p>
                </div>
              </div>
              <Link
                href={AI_RECOMMENDED.href}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-semibold text-white shadow-[0_4px_14px_rgb(16_185_129/0.4)] transition hover:opacity-95"
              >
                Book Instantly
                <ArrowRight size={16} />
              </Link>
            </div>
          </motion.article>
        </section>

        {/* AI Predictions */}
        <section className={aiRightBlock}>
          <AiRightPanelBlockHeader
            title="AI Predictions"
            actionLabel="View All"
            onAction={viewAllPredictions}
          />
          <div className={aiRightPredictionsGrid}>
            {AI_PREDICTIONS.map((p, i) => {
              const Icon = PREDICTION_ICONS[i] ?? Sparkles;
              return (
                <motion.button
                  key={p.id}
                  type="button"
                  variants={fadeUp}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true }}
                  custom={i}
                  whileHover={reduce ? undefined : { scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => runPredictionAction(p.id)}
                  className={cn(
                    "ai-card-3d flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border border-white/50 p-2.5 text-center dark:border-white/10",
                    "hover:border-primary/30 dark:hover:border-indigo-400/30",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-11 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm",
                      p.gradient,
                    )}
                  >
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <span className="text-[10px] font-semibold leading-[1.25] text-ink">{p.label}</span>
                </motion.button>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}

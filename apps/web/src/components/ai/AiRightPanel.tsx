"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Droplets,
  Shield,
  Sparkles,
  SprayCan,
  Thermometer,
} from "lucide-react";
import { m as motion, useReducedMotion } from "framer-motion";
import { AI_PREDICTIONS, AI_RECOMMENDED } from "@/lib/ai-dashboard";
import { AiLiveTrackingCard } from "@/components/ai/AiLiveTrackingCard";
import { AiRightPanelBlockHeader } from "@/components/ai/AiRightPanelBlockHeader";
import {
  aiRightBlock,
  aiRightBrandStrip,
  aiRightPredictionsGrid,
  aiRightRail,
  aiRightShell,
} from "@/components/ai/ai-page-layout";
import { fadeUp } from "@/components/ai/ai-motion";
import { cn } from "@/lib/utils";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";

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
            HOMEEIGO
          </p>
          <p className="font-display text-base font-bold tracking-tight">Tracking &amp; shortcuts</p>
        </div>
      </div>
      <p className="relative mt-2 text-[11px] leading-relaxed text-white/85">
        Your live visit, and quick ways to book a service.
      </p>
    </div>
  );
}

/**
 * The /ai sidebar: live tracking for a real visit, and booking shortcuts.
 *
 * The "AI Home Insights" list is gone — "AC service due in 7 days", "save up to ₹450", "water usage
 * 18% lower" were constants shown to every customer. The remaining blocks are labelled as what they
 * are: links to a service's booking page, not predictions or personal recommendations.
 */
export function AiRightPanel() {
  const reduce = useReducedMotion();
  const { runPredictionAction } = useAiPageActions();

  return (
    <aside className={aiRightRail} aria-label="Tracking and shortcuts sidebar">
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

        {/* One service shortcut */}
        <section className={aiRightBlock}>
          <AiRightPanelBlockHeader
            title="Book a service"
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
            </div>
            <div className="space-y-2.5 p-3.5">
              <h4 className="font-display text-sm font-bold leading-tight text-ink">
                {AI_RECOMMENDED.title}
              </h4>
              <Link
                href={AI_RECOMMENDED.href}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-semibold text-white shadow-[0_4px_14px_rgb(16_185_129/0.4)] transition hover:opacity-95"
              >
                See options &amp; price
                <ArrowRight size={16} />
              </Link>
            </div>
          </motion.article>
        </section>

        {/* Service shortcuts */}
        <section className={aiRightBlock}>
          <AiRightPanelBlockHeader
            title="More services"
            href="/services"
            actionLabel="View All"
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

"use client";

import Image from "next/image";
import { Mic, Activity, ChevronRight } from "lucide-react";
import { m as motion } from "framer-motion";
import { AI_HERO_STATS, AI_USER, getTimeGreeting } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { AiParticles } from "@/components/ai/AiParticles";
import { scaleIn } from "@/components/ai/ai-motion";
import { cn } from "@/lib/utils";

/**
 * Next-gen "Neural Command Deck" hero — deep emerald-black cinematic glass with
 * a neural grid, aurora bloom, HUD status rail and a rotating-ring voice orb.
 * All existing actions (voice capture, hero-stat taps) stay wired as before.
 */
export function AiHeroSection() {
  const { runHeroStatAction, toggleVoiceCapture, isRecording } = useAiPageActions();
  const isMobile = useIsMobile();
  const firstName = AI_USER.name.split(" ")[0];

  return (
    <motion.section
      variants={scaleIn}
      initial="hidden"
      animate="show"
      className={cn(
        "relative overflow-hidden rounded-[22px] text-white ring-1 ring-emerald-400/20",
        "shadow-[0_40px_90px_-30px_rgb(4_60_45/0.8),inset_0_1px_0_rgb(255_255_255/0.08)]",
        "sm:rounded-[26px] lg:rounded-[30px]",
      )}
    >
      {/* ---- Deck canvas: deep emerald-black radial + aurora bloom ---- */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_150%_at_82%_-10%,#0e4a38_0%,#07281f_46%,#031712_100%)]"
      />
      {/* Neural grid */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(52 211 153 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(52 211 153 / 0.35) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(120% 100% at 50% 0%, black 30%, transparent 78%)",
        }}
      />
      {/* Aurora blooms — GPU-cheap, slow drift */}
      <span aria-hidden className="pointer-events-none absolute -left-24 top-1/3 size-80 rounded-full bg-emerald-400/25 blur-3xl animate-aurora" />
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-teal-300/20 blur-3xl animate-[aurora_24s_ease-in-out_infinite]" />
      {/* Horizon line glow at the base */}
      <span aria-hidden className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

      <AiParticles count={isMobile ? 14 : 36} />

      <div className="relative z-[2] flex flex-col gap-5 p-4 sm:gap-6 sm:p-6 lg:p-9">
        {/* ---- HUD status line ---- */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-950/50 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300 backdrop-blur-md sm:text-[11px]">
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            Systems nominal
          </span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-200/60 sm:text-[11px]"
            suppressHydrationWarning
          >
            {getTimeGreeting()}, {firstName}
          </span>
        </div>

        {/* ---- Main deck: robot · headline · voice orb ---- */}
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-8 lg:gap-12">
          {/* Robot on emerald light pedestal */}
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="relative order-2 h-[120px] w-[104px] shrink-0 md:order-1 md:h-[190px] md:w-[165px] lg:h-[225px] lg:w-[190px]"
          >
            <span
              aria-hidden
              className="absolute inset-x-2 bottom-0 h-5 rounded-[50%] bg-emerald-400/40 blur-xl"
            />
            <Image
              src="/robot-3d.png"
              alt="HOMEEIGO AI robot"
              fill
              className="object-contain drop-shadow-[0_16px_40px_rgb(16_185_129/0.45)]"
              sizes="(max-width: 768px) 104px, 190px"
              priority
              quality={95}
            />
          </motion.div>

          {/* Headline */}
          <div className="order-1 min-w-0 flex-1 text-center md:order-2 md:text-left">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.32em] text-emerald-300/90 sm:text-xs">
              Homeeigo Intelligence
            </p>
            <h2 className="mt-2 font-display text-[clamp(1.6rem,5.2vw,3.4rem)] font-bold leading-[1.06] tracking-tight">
              Your home,
              <br />
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-emerald-400 bg-clip-text text-transparent">
                thinking ahead.
              </span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-100/75 sm:text-base md:mx-0">
              All systems monitored in real time — ask anything, or just tap to talk.
            </p>
          </div>

          {/* Voice orb — rotating conic ring + pulse halo */}
          <div className="order-3 flex shrink-0 flex-col items-center gap-2.5 md:gap-3">
            <motion.button
              type="button"
              aria-label="Tap to speak"
              onClick={toggleVoiceCapture}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              className="relative grid place-items-center"
            >
              {/* Pulse halo */}
              <motion.span
                aria-hidden
                className="absolute size-[118px] rounded-full border border-emerald-300/25 sm:size-[142px] lg:size-[164px]"
                animate={{ scale: [1, 1.28, 1], opacity: [0.55, 0.05, 0.55] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* Rotating conic ring */}
              <span
                aria-hidden
                className="absolute size-[104px] rounded-full bg-[conic-gradient(from_0deg,#34d399,#0d9488,#a7f3d0,#10b981,#34d399)] opacity-90 blur-[1px] animate-[spin_7s_linear_infinite] sm:size-[124px] lg:size-[146px]"
              />
              {/* Inner glass disc */}
              <span
                className={cn(
                  "relative grid size-[92px] place-items-center rounded-full sm:size-[112px] lg:size-[132px]",
                  "bg-[radial-gradient(circle_at_35%_30%,#0f5c46_0%,#063826_60%,#032018_100%)]",
                  "ring-1 ring-emerald-300/40 shadow-[inset_0_2px_10px_rgb(167_243_208/0.25),0_18px_44px_-12px_rgb(16_185_129/0.6)]",
                )}
              >
                <motion.span
                  animate={{ scale: isRecording ? [1, 1.18, 1] : [1, 1.06, 1] }}
                  transition={{ duration: isRecording ? 0.9 : 2.2, repeat: Infinity }}
                >
                  <Mic className="size-8 text-emerald-100 sm:size-10 lg:size-11" strokeWidth={1.8} />
                </motion.span>
              </span>
            </motion.button>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-200/80 sm:text-[11px]">
              {isRecording ? "Listening…" : "Tap to speak"}
            </p>
          </div>
        </div>

        {/* ---- HUD stat rail ---- */}
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-950/40 px-2 py-1 backdrop-blur-md sm:px-3">
          <div className="grid grid-cols-3 divide-x divide-emerald-400/15">
            {AI_HERO_STATS.map((stat) => (
              <button
                key={stat.id}
                type="button"
                onClick={() => runHeroStatAction(stat.id)}
                className="group flex min-w-0 flex-col items-center gap-0.5 px-2 py-2.5 text-center transition-colors hover:bg-emerald-400/5 sm:flex-row sm:justify-between sm:gap-3 sm:px-4 sm:text-left"
              >
                <span className="order-2 flex items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase leading-tight tracking-[0.18em] text-emerald-200/60 sm:order-1 sm:text-[10px]">
                  <Activity size={11} className="hidden shrink-0 text-emerald-400/80 sm:block" aria-hidden />
                  {stat.label}
                </span>
                <span className="order-1 flex items-center gap-1 sm:order-2">
                  <span className="font-display text-lg font-bold tracking-tight text-emerald-50 sm:text-xl">
                    {stat.value}
                  </span>
                  <ChevronRight
                    size={13}
                    className="text-emerald-400/0 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-300"
                    aria-hidden
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

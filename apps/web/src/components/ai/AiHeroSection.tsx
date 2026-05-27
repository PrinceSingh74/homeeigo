"use client";

import Image from "next/image";
import { Heart, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { AI_HERO_STATS, AI_USER, getTimeGreeting } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { AiParticles } from "@/components/ai/AiParticles";
import { scaleIn } from "@/components/ai/ai-motion";
import { cn } from "@/lib/utils";

const STAT_ICONS = [ShieldCheck, Heart, Sparkles] as const;

export function AiHeroSection() {
  const { runHeroStatAction, toggleVoiceCapture, isRecording } = useAiPageActions();
  const isMobile = useIsMobile();

  return (
    <motion.section
      variants={scaleIn}
      initial="hidden"
      animate="show"
      className={cn(
        "ai-hero-3d relative flex flex-col gap-4 overflow-hidden rounded-[20px] p-4 text-white",
        "sm:gap-6 sm:rounded-[24px] sm:p-6",
        "md:min-h-[280px] md:flex-row md:items-center md:gap-8 md:p-8",
        "lg:min-h-[320px] lg:rounded-[28px] lg:gap-10 lg:p-10",
      )}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary via-violet to-cyan"
        animate={{ opacity: [1, 0.95, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />
      <AiParticles count={isMobile ? 20 : 48} />

      {/* Mobile / tablet: compact top row */}
      <div className="relative z-[2] flex items-start gap-3 sm:gap-4 md:shrink-0 md:items-center">
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          whileHover={{ scale: 1.05 }}
          className="ai-robot-stage relative h-[100px] w-[84px] shrink-0 sm:h-[160px] sm:w-[130px] md:h-[200px] md:w-[180px] lg:h-[240px] lg:w-[200px]"
        >
          <span className="ai-robot-pedestal" aria-hidden />
          <Image
            src="/robot-3d.png"
            alt="HOMIGO AI robot"
            fill
            className="object-contain"
            sizes="(max-width: 640px) 84px, (max-width: 1024px) 160px, 240px"
            priority
            quality={95}
          />
        </motion.div>

        <div className="min-w-0 flex-1 pt-0.5 md:hidden">
          <p
            className="text-xs font-medium tracking-wide text-white/90 sm:text-sm"
            suppressHydrationWarning
          >
            {getTimeGreeting()}, {AI_USER.name.split(" ")[0]} 👋
          </p>
          <h2 className="mt-1 font-display text-[clamp(1.25rem,6vw,1.75rem)] font-bold leading-[1.12] tracking-tight sm:mt-2">
            I&apos;m your HOMIGO AI
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-white/85 sm:text-sm">
            Your home systems are running smoothly.
          </p>
        </div>
      </div>

      {/* Desktop: center copy */}
      <div className="relative z-[2] hidden min-w-0 flex-1 md:block">
        <p className="text-sm font-medium tracking-wide text-white/90" suppressHydrationWarning>
          {getTimeGreeting()}, {AI_USER.name.split(" ")[0]} 👋
        </p>
        <h2 className="mt-2 font-display text-[clamp(1.75rem,4vw,3rem)] font-bold leading-[1.15] tracking-tight">
          I&apos;m your HOMIGO AI
        </h2>
        <p className="mt-2 max-w-md text-base leading-relaxed text-white/85">
          Your home systems are running smoothly.
        </p>

        <div className="mt-5 hidden flex-wrap gap-3 lg:flex lg:gap-4">
          {AI_HERO_STATS.map((stat, i) => {
            const Icon = STAT_ICONS[i] ?? Sparkles;
            return (
              <motion.button
                key={stat.id}
                type="button"
                whileHover={{ scale: 1.02 }}
                onClick={() => runHeroStatAction(stat.id)}
                className="ai-stat-glass-3d flex min-w-[140px] flex-col gap-1 rounded-xl border border-white/25 bg-white/15 px-4 py-3 text-left backdrop-blur-md"
              >
                <Icon size={16} className="text-white/90" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-white/70">
                  {stat.label}
                </span>
                <span className="font-display text-lg font-bold tracking-tight">{stat.value}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Stats — full-width grid on mobile/tablet */}
      <div className="relative z-[2] grid w-full grid-cols-3 gap-2 sm:gap-3 lg:hidden">
        {AI_HERO_STATS.map((stat, i) => {
          const Icon = STAT_ICONS[i] ?? Sparkles;
          return (
            <motion.button
              key={stat.id}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => runHeroStatAction(stat.id)}
              className="ai-stat-glass-3d flex min-w-0 flex-col gap-0.5 rounded-xl border border-white/25 bg-white/15 px-2 py-2.5 text-left backdrop-blur-md sm:gap-1 sm:px-3 sm:py-3"
            >
              <Icon size={14} className="text-white/90 sm:size-4" />
              <span className="line-clamp-2 text-[8px] font-medium uppercase leading-tight tracking-wide text-white/70 sm:text-[10px]">
                {stat.label}
              </span>
              <span className="font-display text-sm font-bold tracking-tight sm:text-lg">
                {stat.value}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Voice orb */}
      <div className="relative z-[3] flex items-center justify-center gap-2 sm:gap-3 md:absolute md:right-8 md:top-1/2 md:-translate-y-1/2 md:flex-col lg:right-10">
        <motion.button
          type="button"
          aria-label="Tap to talk"
          onClick={toggleVoiceCapture}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="ai-voice-orb-3d relative grid size-[88px] shrink-0 place-items-center rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.85)_0%,rgba(37,99,235,0.65)_100%)] sm:size-[108px] md:size-[120px] lg:size-[140px]"
        >
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-white/30"
            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            animate={{ scale: isRecording ? [1, 1.15, 1] : [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Mic size={32} className="text-white sm:hidden" strokeWidth={2} />
            <Mic size={36} className="hidden text-white sm:block md:hidden" strokeWidth={2} />
            <Mic size={40} className="hidden text-white md:block lg:hidden" strokeWidth={2} />
            <Mic size={48} className="hidden text-white lg:block" strokeWidth={2} />
          </motion.span>
        </motion.button>
        <p className="text-xs font-semibold tracking-wide text-white/90 sm:text-sm">Tap to Talk</p>
      </div>
    </motion.section>
  );
}

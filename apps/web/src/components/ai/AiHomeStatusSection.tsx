"use client";

import {
  Activity,
  CheckCircle2,
  Droplets,
  Home,
  Shield,
  Sparkles,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { m as motion, useReducedMotion } from "framer-motion";
import { AI_HOME_STATUS, type AiHomeStatusItem, type AiStatusTone } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import {
  aiSection,
  aiStatusCard,
  aiStatusCardWrap,
  aiStatusGrid,
  aiStatusShell,
  aiStatusSummaryCell,
  aiStatusSummaryGrid,
} from "@/components/ai/ai-page-layout";
import { cn } from "@/lib/utils";

const STATUS_ICONS: LucideIcon[] = [
  CheckCircle2,
  Thermometer,
  Zap,
  Droplets,
  Shield,
  Sparkles,
];

const STATUS_SUMMARY = [
  {
    id: "health",
    label: "Overall health",
    value: "95%",
    tone: "text-emerald-300",
  },
  {
    id: "systems",
    label: "Systems online",
    value: "6/6",
    tone: "text-emerald-300",
  },
  { id: "alerts", label: "Active alerts", value: "0", tone: "text-slate dark:text-slate-300" },
] as const;

const TONE_CHIP: Record<AiStatusTone, string> = {
  success: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  info: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  warning: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  cyan: "bg-teal-400/15 text-teal-300 ring-teal-400/30",
  violet: "bg-teal-400/15 text-teal-300 ring-teal-400/30",
};

const TONE_BAR: Record<AiStatusTone, string> = {
  success: "from-emerald-400 to-teal-500",
  info: "from-emerald-500 to-teal-500",
  warning: "from-amber-400 to-orange-500",
  cyan: "from-teal-400 to-teal-600",
  violet: "from-teal-500 to-emerald-500",
};

const TONE_RING: Record<AiStatusTone, string> = {
  success: "#10b981",
  info: "#34d399",
  warning: "#f59e0b",
  cyan: "#14b8a6",
  violet: "#2dd4bf",
};

/** Reserved ring column keeps value row aligned on every card */
const RING_SLOT = "size-9 shrink-0 sm:size-10";

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/30">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      Live
    </span>
  );
}

function StatusRing({
  progress,
  tone,
  reduce,
}: {
  progress: number;
  tone: AiStatusTone;
  reduce: boolean;
}) {
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn(RING_SLOT, "relative")} aria-hidden>
      <svg className="size-full -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-emerald-900/70"
          strokeWidth="2.5"
        />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={TONE_RING[tone]}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduce ? { strokeDashoffset: offset } : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[8px] font-bold leading-none text-slate">
        {progress}%
      </span>
    </div>
  );
}

function RingPlaceholder() {
  return <span className={cn(RING_SLOT, "invisible")} aria-hidden />;
}

function StatusCard({
  card,
  index,
  reduce,
  onPress,
}: {
  card: AiHomeStatusItem;
  index: number;
  reduce: boolean;
  onPress: (id: string) => void;
}) {
  const Icon = STATUS_ICONS[index] ?? Sparkles;
  const showRing = card.progress != null && card.progress > 0 && card.progress < 100;
  const trendUp = card.trend?.startsWith("+");

  return (
    <div className={aiStatusCardWrap} role="listitem">
      <motion.button
        type="button"
        initial={reduce ? false : { opacity: 0, y: 12 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-24px" }}
        transition={{ delay: index * 0.04, type: "spring", damping: 18, stiffness: 160 }}
        whileHover={reduce ? undefined : { y: -2 }}
        onClick={() => onPress(card.id)}
        className={cn(
          aiStatusCard,
          card.hoverGlow,
          "w-full cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br opacity-[0.08] blur-2xl transition-opacity group-hover:opacity-15",
            card.iconGradient,
          )}
          aria-hidden
        />

        <div className="relative flex h-full min-h-0 flex-col">
          {/* Icon + chip */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br text-white shadow-[0_3px_10px_rgb(0_0_0/0.1)]",
                card.iconGradient,
              )}
            >
              <Icon size={16} strokeWidth={2.25} />
            </span>
            <span
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase leading-none tracking-wide ring-1",
                TONE_CHIP[card.tone],
              )}
            >
              {card.chip}
            </span>
          </div>

          {/* Label — wrap, no truncate */}
          <p className="mb-2 text-[10px] font-semibold uppercase leading-[1.35] tracking-wide text-slate">
            {card.label}
          </p>

          {/* Value + ring slot (always same grid) */}
          <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem]">
            <p
              className={cn(
                "font-display text-[1.35rem] font-bold leading-none tracking-tight sm:text-[1.5rem]",
                card.valueColor,
              )}
            >
              {card.value}
            </p>
            {showRing && card.progress != null ? (
              <StatusRing progress={card.progress} tone={card.tone} reduce={reduce} />
            ) : (
              <RingPlaceholder />
            )}
          </div>

          {/* Description */}
          <p className="mb-1 min-h-[2rem] text-[10px] leading-[1.4] text-slate sm:text-[11px]">
            {card.description}
          </p>

          {/* Trend — fixed height for row alignment */}
          <div className="mb-2 min-h-[1.125rem]">
            {card.trend ? (
              <p
                className={cn(
                  "flex items-start gap-0.5 text-[9px] font-semibold leading-[1.35] sm:text-[10px]",
                  trendUp
                    ? "text-emerald-600 dark:text-emerald-300"
                    : card.tone === "violet"
                      ? "text-teal-600 dark:text-teal-300"
                      : "text-slate dark:text-slate-400",
                )}
              >
                {card.trend.startsWith("↓") && (
                  <TrendingDown size={10} className="mt-px shrink-0" />
                )}
                {trendUp && <TrendingUp size={10} className="mt-px shrink-0" />}
                <span className="min-w-0 break-words">{card.trend}</span>
              </p>
            ) : null}
          </div>

          {/* Health footer — pinned bottom */}
          {card.progress != null && (
            <div className="mt-auto border-t border-[#F1F5F9] pt-2.5 dark:border-white/10">
              <div className="mb-1 flex items-center justify-between text-[9px] font-medium text-slate">
                <span>Health</span>
                <span>{card.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#F1F5F9] dark:bg-slate-700/80">
                <motion.div
                  className={cn("h-full rounded-full bg-gradient-to-r", TONE_BAR[card.tone])}
                  initial={reduce ? { width: `${card.progress}%` } : { width: 0 }}
                  whileInView={{ width: `${card.progress}%` }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.85,
                    ease: [0.22, 1, 0.36, 1],
                    delay: 0.12 + index * 0.04,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </motion.button>
    </div>
  );
}

export function AiHomeStatusSection() {
  const reduce = useReducedMotion();
  const { runStatusAction, onSummaryStatClick } = useAiPageActions();

  return (
    <section
      id={AI_SECTION_IDS.homeStatus}
      className={cn(aiSection, "scroll-mt-24")}
      aria-labelledby="home-status-heading"
    >
      <div className={aiStatusShell}>
        <AiSectionHeader
          title="Home Status Overview"
          subtitle="Real-time health across cleaning, climate, energy & safety — powered by HOMEEIGO AI."
          meta="Updated just now"
          badge={<LiveBadge />}
        />

        <div className={aiStatusSummaryGrid}>
          {STATUS_SUMMARY.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSummaryStatClick(item.id)}
              className={cn(
                aiStatusSummaryCell,
                "cursor-pointer text-left transition hover:border-emerald-400/35 hover:shadow-[0_4px_16px_rgb(16_185_129/0.2)]",
              )}
            >
              <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate">
                {item.id === "health" && <Home size={12} className="text-emerald-400" />}
                {item.id === "systems" && <Activity size={12} className="text-emerald-400" />}
                {item.id === "alerts" && <Shield size={12} className="text-slate" />}
                {item.label}
              </span>
              <span
                className={cn(
                  "font-display text-lg font-bold tracking-tight sm:text-xl",
                  item.tone,
                )}
              >
                {item.value}
              </span>
            </button>
          ))}
        </div>

        <div className={aiStatusGrid} role="list">
          {AI_HOME_STATUS.map((card, i) => (
            <StatusCard
              key={card.id}
              card={card}
              index={i}
              reduce={!!reduce}
              onPress={runStatusAction}
            />
          ))}
        </div>

        <p className="mt-2.5 text-center text-[10px] font-medium text-slate min-[430px]:hidden">
          Swipe for all systems →
        </p>
      </div>
    </section>
  );
}

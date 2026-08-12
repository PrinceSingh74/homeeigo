"use client";

import type { LucideIcon } from "lucide-react";
import { memo } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { ConversionSectionHeader } from "@/components/services-page/sections/ConversionSectionHeader";
import { AI_SCHEDULING_FEATURES } from "@/lib/services-marketplace-data";
import { useSectionVisibility } from "@/hooks/use-section-visibility";
import {
  servicesSection,
  svcConversionCardDark,
  svcConversionSectionPad,
} from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

function AiNetworkBackground({
  active,
  reduceMotion,
}: {
  active: boolean;
  reduceMotion: boolean | null;
}) {
  const nodes = [
    { cx: 12, cy: 20 },
    { cx: 28, cy: 45 },
    { cx: 45, cy: 18 },
    { cx: 62, cy: 38 },
    { cx: 78, cy: 22 },
    { cx: 88, cy: 55 },
    { cx: 35, cy: 72 },
    { cx: 58, cy: 68 },
    { cx: 72, cy: 82 },
  ];

  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 4],
    [4, 5],
    [1, 6],
    [3, 7],
    [5, 7],
    [6, 7],
    [7, 8],
  ];

  return (
    <svg
      className={cn(
        "pointer-events-none absolute inset-0 size-full opacity-50",
        active && !reduceMotion && "svc-ai-network-active",
      )}
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {edges.map(([a, b], i) => {
        const from = nodes[a]!;
        const to = nodes[b]!;
        return (
          <line
            key={i}
            x1={from.cx}
            y1={from.cy}
            x2={to.cx}
            y2={to.cy}
            stroke="url(#svc-ai-line)"
            strokeWidth="0.2"
            className="svc-ai-line"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        );
      })}
      {nodes.map((node, i) => (
        <circle
          key={i}
          cx={node.cx}
          cy={node.cy}
          r="0.75"
          fill="#34d399"
          className="svc-ai-node"
          style={{ animationDelay: `${i * 0.25}s` }}
        />
      ))}
      <defs>
        <linearGradient id="svc-ai-line" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#6ee7b7" stopOpacity="1" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.35" />
        </linearGradient>
      </defs>
    </svg>
  );
}

type FeatureCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  index: number;
  reduceMotion: boolean | null;
};

const FeatureCard = memo(function FeatureCard({
  title,
  description,
  icon: Icon,
  index,
  reduceMotion,
}: FeatureCardProps) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08, duration: 0.5 }}
      className={cn(svcConversionCardDark, "group p-7 sm:p-8")}
    >
      <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/35 sm:mb-6 sm:size-14">
        <Icon className="size-6 sm:size-7" aria-hidden />
      </div>
      <h3 className="font-display text-xl font-bold leading-snug text-white sm:text-[1.35rem]">
        {title}
      </h3>
      <p className="mt-3 text-[15px] leading-[1.7] text-slate-300 sm:mt-4 sm:text-base sm:leading-[1.75]">
        {description}
      </p>
    </motion.div>
  );
});

export const AiSchedulingSection = memo(function AiSchedulingSection() {
  const reduceMotion = useReducedMotion();
  const { ref, visible } = useSectionVisibility("280px 0px");

  return (
    <section
      ref={ref}
      className={servicesSection(
        cn(
          svcConversionSectionPad,
          "relative overflow-hidden border-y border-slate-800 bg-gradient-to-br from-[#020617] via-slate-950 to-[#0f172a]",
        ),
      )}
    >
      <AiNetworkBackground active={visible} reduceMotion={reduceMotion} />

      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 50% 0%, rgb(16 185 129 / 0.14), transparent 62%)",
        }}
      />

      <div className="relative z-10">
        <ConversionSectionHeader
          dark
          eyebrow="Intelligent Operations"
          title="AI Powered Scheduling Engine"
          subtitle="Every booking is intelligently optimized before assignment."
        />

        {visible ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3 lg:gap-8">
            {AI_SCHEDULING_FEATURES.map((feature, i) => (
              <FeatureCard
                key={feature.title}
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
                index={i}
                reduceMotion={reduceMotion}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3 lg:gap-8">
            {AI_SCHEDULING_FEATURES.slice(0, 3).map((feature) => (
              <div
                key={feature.title}
                className="h-48 animate-pulse rounded-[20px] bg-slate-800/70"
                aria-hidden
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

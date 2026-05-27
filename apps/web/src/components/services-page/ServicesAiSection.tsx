"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Brain, Sparkles, TrendingUp, Zap } from "lucide-react";
import { ServicesSectionHeader } from "@/components/services-page/ServicesSectionHeader";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  servicesSection,
  svcCardPremium,
  svcSplitAside,
  svcSplitMain,
} from "@/components/services-page/services-page-layout";
import { AI_RECOMMENDATIONS } from "@/lib/services-page-data";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

const badgeStyles = {
  "AI Recommended":
    "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  Popular: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  Urgent: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

function AiInsightPanel({ onOpenAi }: { onOpenAi: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenAi}
      className={cn(
        svcCardPremium,
        svcSplitAside,
        "flex w-full flex-col gap-4 border border-line/80 bg-gradient-to-br from-violet-500/10 via-surface to-sky-500/5 p-5 text-left transition hover:border-primary/40 sm:gap-5 sm:p-6 lg:top-28",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-aurora text-white shadow-glow-blue sm:size-12">
          <Brain size={20} className="sm:hidden" aria-hidden />
          <Brain size={22} className="hidden sm:block" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted sm:text-xs">
            HOMIGO AI
          </p>
          <p className="font-display text-base font-bold text-content sm:text-lg">
            Smart matching
          </p>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        Our AI learns your home patterns and suggests the right service at the
        right time — saving you up to 20% with bundled bookings.
      </p>
      <ul className="space-y-2.5 text-sm text-content sm:space-y-3">
        <li className="flex items-center gap-2">
          <TrendingUp size={16} className="shrink-0 text-primary" aria-hidden />
          2.4k smarter bookings this week
        </li>
        <li className="flex items-center gap-2">
          <Zap size={16} className="shrink-0 text-violet-600" aria-hidden />
          Instant expert matching
        </li>
      </ul>
      <span className="mt-auto block text-center text-sm font-semibold text-primary">
        Open AI Assistant →
      </span>
    </button>
  );
}

export function ServicesAiSection() {
  const nav = useServicesNavigation();

  return (
    <section className={servicesSection()}>
      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:items-start lg:gap-10">
        <div className={cn(svcSplitMain, "order-2 lg:order-1")}>
          <ServicesSectionHeader
            title="AI Recommendations for You"
            subtitle="Personalized picks based on your home, season, and booking history."
            onViewAll={nav.openAiRecommendations}
            linkLabel="View All"
            linkLabelShort="View All"
            icon={Sparkles}
          />
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5">
            {AI_RECOMMENDATIONS.map((rec, i) => {
              const Icon = rec.icon;
              return (
                <motion.article
                  key={rec.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                  className="min-w-0"
                >
                  <Link
                    href={bookUrl({ service: rec.serviceId })}
                    className={cn(
                      svcCardPremium,
                      "group flex h-full min-w-0 flex-col gap-2.5 border border-line/80 bg-gradient-to-br p-4 sm:gap-3 sm:p-5",
                      "from-[#F9FAFB] to-white hover:border-primary/50 dark:from-slate-900 dark:to-slate-800/90",
                      rec.gradient,
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-aurora text-white shadow-glow-blue sm:size-12">
                        <Icon size={22} className="sm:hidden" aria-hidden />
                        <Icon size={24} className="hidden sm:block" aria-hidden />
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase",
                          badgeStyles[rec.badge],
                        )}
                      >
                        {rec.badge}
                      </span>
                    </div>
                    <h3 className="font-display text-sm font-bold leading-snug text-content">
                      {rec.title}
                    </h3>
                    <p className="flex-1 text-xs leading-[1.5] text-[#64748B] dark:text-muted">
                      {rec.description}
                    </p>
                    <span className="text-xs font-semibold text-[#2563EB] group-hover:underline">
                      Book Now →
                    </span>
                  </Link>
                </motion.article>
              );
            })}
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <AiInsightPanel onOpenAi={nav.openAiRecommendations} />
        </div>
      </div>
    </section>
  );
}

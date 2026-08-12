"use client";

import { m as motion } from "framer-motion";
import { Shield, Sparkles, Star, Zap } from "lucide-react";
import { servicesShell, servicesPadX } from "@/components/services-page/services-page-layout";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { useStatsOverview } from "@/hooks/use-core-data";
import { cn } from "@/lib/utils";

const nf = (n: number) => n.toLocaleString("en-IN");

export function ServicesPremiumStrip() {
  const nav = useServicesNavigation();
  const { data: stats } = useStatsOverview();

  // Real numbers from the backend stats endpoint; "Avg. arrival" is a service
  // promise (no live metric exists for it) and stays as a target, not fake data.
  const STATS = [
    {
      icon: Star,
      label: stats?.averageRating != null ? `${stats.averageRating}/5` : "New",
      sub: "Avg. rating",
      action: "reviews" as const,
    },
    {
      icon: Shield,
      label: stats ? nf(stats.activeProviders) : "—",
      sub: "Verified pros",
      action: "how" as const,
    },
    { icon: Zap, label: "~60 min", sub: "Avg. arrival", action: "tracking" as const },
    {
      icon: Sparkles,
      label: stats ? nf(stats.completedBookings) : "—",
      sub: "Jobs completed",
      action: "premium" as const,
    },
  ];

  const onStat = (action: (typeof STATS)[number]["action"]) => {
    switch (action) {
      case "reviews":
        nav.openReviews();
        break;
      case "how":
        nav.openHowItWorks();
        break;
      case "tracking":
        nav.openBookingsWithTracking();
        break;
      case "premium":
        nav.openPremium();
        break;
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={cn(servicesShell, servicesPadX, "relative z-10 -mt-3 mb-1 sm:-mt-6 sm:mb-2")}
    >
      <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-line/80 bg-surface/80 p-3 shadow-[0_8px_32px_rgb(37_99_235/0.1)] backdrop-blur-md sm:grid-cols-4 sm:gap-3 sm:p-4 md:gap-4 md:p-5 dark:bg-slate-900/70">
        {STATS.map(({ icon: Icon, label, sub, action }) => (
          <button
            key={sub}
            type="button"
            onClick={() => onStat(action)}
            className="svc-stat-pill flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:opacity-90 sm:gap-3 sm:px-3 sm:py-2.5 md:px-4 md:py-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/15 to-violet-500/15 text-primary sm:size-10 sm:rounded-xl">
              <Icon size={16} className="sm:hidden" aria-hidden />
              <Icon size={18} className="hidden sm:block" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold leading-none text-content sm:text-lg">
                {label}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-muted sm:text-[11px]">
                {sub}
              </p>
            </div>
          </button>
        ))}
      </div>
    </motion.section>
  );
}

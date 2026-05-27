"use client";

import { motion } from "framer-motion";
import { TrendingUp, Briefcase, Bell, Star } from "lucide-react";
import { CircularProgress } from "@/components/ui/CircularProgress";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { DEMO_DASHBOARD, formatInr } from "@/lib/partner-data";
import { usePartnerStore } from "@/stores/partner-store";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

export function DashboardStatsRow() {
  const pending = usePartnerStore((s) => s.requests.length);
  const d = DEMO_DASHBOARD;

  const cards = [
    {
      key: "earnings",
      featured: true,
      content: (
        <>
          <p className="text-xs font-medium tracking-wide text-white/80">
            Today&apos;s Earnings
          </p>
          <p className="font-display text-[2.5rem] font-bold leading-none tracking-[-0.03em] text-white">
            {formatInr(d.todayEarnings)}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-white/90">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
            <span className="font-semibold">+{d.todayEarningsChange}%</span>
            <span className="text-white/70">vs yesterday</span>
          </p>
          <div className="mt-auto pt-1">
            <Sparkline data={d.sparkline} height={40} className="opacity-90" />
          </div>
        </>
      ),
    },
    {
      key: "jobs",
      icon: Briefcase,
      iconClass: "text-partner-warning",
      label: "Completed Jobs",
      value: String(d.completedToday),
      sub: `↑ ${d.completedTodayDelta} vs yesterday`,
      subClass: "text-partner-success",
    },
    {
      key: "pending",
      icon: Bell,
      iconClass: "text-partner-warning",
      label: "Pending Requests",
      value: String(pending),
      sub: "New requests",
      subClass: "text-partner-warning",
    },
    {
      key: "rating",
      icon: Star,
      iconClass: "text-amber-400",
      label: "Rating",
      value: d.rating.toFixed(1),
      sub: "⭐ Excellent",
      subClass: "text-partner-success",
    },
    {
      key: "acceptance",
      label: "Acceptance Rate",
      value: `${d.acceptanceRate}%`,
      sub: "Excellent",
      subClass: "text-partner-success",
      ring: true,
    },
  ];

  return (
    <section className={partnerLayout.statsGrid}>
      {cards.map((card, i) => (
        <motion.div
          key={card.key}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.06, type: "spring", damping: 16, stiffness: 260 }}
          className={cn(
            partnerLayout.cardRadius,
            card.featured
              ? cn("partner-earnings-gradient", partnerLayout.statCardFeatured)
              : cn("partner-card", partnerLayout.statCard),
            partnerLayout.cardPad
          )}
        >
          {card.featured ? (
            card.content
          ) : (
            <>
              <div className="flex items-start justify-between">
                {card.ring ? (
                  <CircularProgress value={d.acceptanceRate} size={56} strokeWidth={4}>
                    <span className="font-display text-xs font-bold text-partner-success">
                      {d.acceptanceRate}%
                    </span>
                  </CircularProgress>
                ) : (
                  card.icon && (
                    <card.icon className={cn("h-8 w-8", card.iconClass)} strokeWidth={1.75} />
                  )
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-partner-text-secondary">{card.label}</p>
                <p className="partner-stat-value text-partner-text">{card.value}</p>
                <p className={cn("text-[11px] font-medium", card.subClass)}>{card.sub}</p>
              </div>
            </>
          )}
        </motion.div>
      ))}
    </section>
  );
}

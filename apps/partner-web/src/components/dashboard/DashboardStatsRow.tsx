"use client";

import { motion } from "framer-motion";
import { TrendingUp, Briefcase, Bell, Star } from "lucide-react";
import { CircularProgress } from "@/components/ui/CircularProgress";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { usePartnerEarningsStream } from "@/hooks/use-partner-earnings-stream";
import { formatInr, formatNumber } from "@/lib/format";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

export function DashboardStatsRow() {
  const { data, isLoading } = usePartnerDashboardQuery();
  // Realtime tile updates — REST query stays authoritative; the stream only
  // patches the displayed numbers while it has a fresher snapshot than REST.
  const { snapshot: liveEarnings } = usePartnerEarningsStream();

  const todayEarnings = liveEarnings?.todayEarnings ?? data?.earnings.today ?? 0;
  const todayChange = data?.earnings.todayChange ?? 0;
  const completedToday =
    liveEarnings?.completedBookings ?? data?.counts.completedToday ?? 0;
  const completedDelta = data?.counts.completedTodayDelta ?? 0;
  const pendingRequests = data?.counts.pendingRequests ?? 0;
  const rating = data?.rating ?? 0;
  const acceptanceRate = Math.round((data?.rates.acceptanceRate ?? 0) * 100);
  const sparklineValues = (data?.earnings.sparkline ?? []).map((d) => d.amount);

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
            {isLoading ? "—" : formatInr(todayEarnings)}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-white/90">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
            <span className="font-semibold">
              {todayChange >= 0 ? `+${todayChange}` : todayChange}%
            </span>
            <span className="text-white/70">vs yesterday</span>
          </p>
          <div className="mt-auto pt-1">
            {sparklineValues.length > 1 ? (
              <Sparkline data={sparklineValues} height={40} className="opacity-90" />
            ) : null}
          </div>
        </>
      ),
    },
    {
      key: "jobs",
      icon: Briefcase,
      iconClass: "text-partner-warning",
      label: "Completed Jobs",
      value: isLoading ? "—" : formatNumber(completedToday),
      sub:
        completedDelta === 0
          ? "Same as yesterday"
          : `${completedDelta > 0 ? "↑" : "↓"} ${Math.abs(completedDelta)} vs yesterday`,
      subClass: completedDelta >= 0 ? "text-partner-success" : "text-partner-danger",
    },
    {
      key: "pending",
      icon: Bell,
      iconClass: "text-partner-warning",
      label: "Pending Requests",
      value: isLoading ? "—" : formatNumber(pendingRequests),
      sub: pendingRequests > 0 ? "Tap to review" : "All caught up",
      subClass: pendingRequests > 0 ? "text-partner-warning" : "text-partner-success",
    },
    {
      key: "rating",
      icon: Star,
      iconClass: "text-amber-400",
      label: "Rating",
      value: isLoading ? "—" : rating.toFixed(1),
      sub:
        rating >= 4.7
          ? "⭐ Excellent"
          : rating >= 4.0
            ? "Solid"
            : rating > 0
              ? "Needs improvement"
              : "No ratings yet",
      subClass: rating >= 4.0 ? "text-partner-success" : "text-partner-warning",
    },
    {
      key: "acceptance",
      label: "Acceptance Rate",
      value: isLoading ? "—" : `${acceptanceRate}%`,
      sub:
        acceptanceRate >= 85
          ? "Excellent"
          : acceptanceRate >= 70
            ? "Good"
            : "Below target",
      subClass:
        acceptanceRate >= 85
          ? "text-partner-success"
          : acceptanceRate >= 70
            ? "text-partner-warning"
            : "text-partner-danger",
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
            partnerLayout.cardPad,
          )}
        >
          {card.featured ? (
            card.content
          ) : (
            <>
              <div className="flex items-start justify-between">
                {card.ring ? (
                  <CircularProgress value={acceptanceRate} size={56} strokeWidth={4}>
                    <span className="font-display text-xs font-bold text-partner-success">
                      {acceptanceRate}%
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

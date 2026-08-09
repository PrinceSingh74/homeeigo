"use client";

import { motion } from "framer-motion";
import { Briefcase, IndianRupee, Star, Zap } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerDashboardQuery, usePartnerMeQuery } from "@/hooks/use-partner-data";
import { formatInr, formatNumber } from "@/lib/format";

export function DashboardHero() {
  const dashboard = usePartnerDashboardQuery();
  const me = usePartnerMeQuery();

  const stats = [
    {
      label: "Today",
      value: dashboard.isLoading ? "—" : formatInr(dashboard.data?.earnings.today ?? 0),
      sub: "earnings",
      icon: IndianRupee,
      accent: "text-partner-primary",
    },
    {
      label: "Jobs",
      value: dashboard.isLoading ? "—" : formatNumber(dashboard.data?.counts.completedToday ?? 0),
      sub: "completed today",
      icon: Briefcase,
      accent: "text-partner-success",
    },
    {
      label: "Requests",
      value: dashboard.isLoading ? "—" : formatNumber(dashboard.data?.counts.pendingRequests ?? 0),
      sub: "pending",
      icon: Zap,
      accent: "text-partner-warning",
    },
    {
      label: "Rating",
      value: me.isLoading ? "—" : (me.data?.rating ?? 0).toFixed(2),
      sub: "avg",
      icon: Star,
      accent: "text-amber-400",
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
        >
          <PartnerCard className="relative overflow-hidden">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-partner-primary/10 blur-2xl" />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-partner-muted">{s.label}</p>
                <p className="font-display mt-1 text-2xl font-bold tracking-tight">
                  {s.value}
                </p>
                <p className="text-xs text-partner-muted">{s.sub}</p>
              </div>
              <s.icon className={`h-8 w-8 opacity-80 ${s.accent}`} />
            </div>
          </PartnerCard>
        </motion.div>
      ))}
    </section>
  );
}

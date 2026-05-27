"use client";

import { motion } from "framer-motion";
import { IndianRupee, Briefcase, Zap, Star } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { DEMO_DASHBOARD } from "@/lib/partner-data";
import { usePartnerStore } from "@/stores/partner-store";

function formatInr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export function DashboardHero() {
  const vendor = usePartnerStore((s) => s.vendor);
  const pending = usePartnerStore((s) => s.requests.length);

  const stats = [
    {
      label: "Today",
      value: formatInr(DEMO_DASHBOARD.todayEarnings),
      sub: "earnings",
      icon: IndianRupee,
      accent: "text-partner-primary",
    },
    {
      label: "Jobs",
      value: String(DEMO_DASHBOARD.completedToday),
      sub: "completed",
      icon: Briefcase,
      accent: "text-partner-success",
    },
    {
      label: "Requests",
      value: String(pending),
      sub: "pending",
      icon: Zap,
      accent: "text-partner-warning",
    },
    {
      label: "Rating",
      value: vendor.rating.toFixed(2),
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
              <s.icon className={cnIcon(s.accent)} />
            </div>
          </PartnerCard>
        </motion.div>
      ))}
    </section>
  );
}

function cnIcon(accent: string) {
  return `h-8 w-8 opacity-80 ${accent}`;
}

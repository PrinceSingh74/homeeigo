"use client";

import Link from "next/link";
import { m as motion, useReducedMotion } from "framer-motion";
import { ChevronRight, CheckCircle, Gift, MapPin, Wallet } from "lucide-react";
import { profilePanelShell, profileStatsGrid } from "@/components/profile/profile-page-layout";
import { cn } from "@/lib/utils";
import { useProfileDerived } from "@/hooks/use-derived-selectors";
import { useAppStore } from "@/stores/app-store";

const ICONS = {
  wallet: Wallet,
  bookings: CheckCircle,
  addresses: MapPin,
  referral: Gift,
} as const;

export function StatsCards() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const { quickStats } = useProfileDerived();

  return (
    <div className={profileStatsGrid}>
      {quickStats.map((card, i) => {
        const Icon = ICONS[card.id as keyof typeof ICONS];
        const inner = (
          <>
            <div className="flex items-start justify-between">
              <span
                className={cn(
                  "grid size-10 place-items-center rounded-[10px] bg-gradient-to-br text-white",
                  card.gradient,
                )}
              >
                <Icon size={20} />
              </span>
              {card.notify && (
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(16_185_129/0.4)]" />
              )}
            </div>
            <p className="text-xs font-medium text-muted">{card.label}</p>
            <p
              className="font-display font-bold tracking-tight text-content"
              style={{ fontSize: "clamp(1.375rem, 5vw, 1.75rem)" }}
            >
              {card.value}
            </p>
            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600">
              {card.link}
              <ChevronRight size={14} />
            </span>
          </>
        );

        const className = cn(
          profilePanelShell,
          "group flex min-w-0 flex-col gap-2.5 p-4 transition duration-250 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgb(16_185_129/0.12)] sm:gap-3 sm:p-5",
        );

        return (
          <motion.div
            key={card.id}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.06, type: "spring", damping: 10 }}
          >
            {"href" in card && card.href ? (
              <Link href={card.href} className={className}>
                {inner}
              </Link>
            ) : (
              <button
                type="button"
                className={cn(className, "w-full text-left")}
                onClick={() => {
                  if (card.action === "location") openOverlay("location");
                  else showToast("Invite friends & earn ₹200 per referral!", "info");
                }}
              >
                {inner}
              </button>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

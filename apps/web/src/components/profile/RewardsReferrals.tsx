"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Gift, Star } from "lucide-react";
import {
  REFERRAL_CURRENT,
  REFERRAL_TARGET,
} from "@/lib/profile-dashboard";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const PCT = Math.round((REFERRAL_CURRENT / REFERRAL_TARGET) * 100);

export function RewardsReferrals() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-xl border border-[#DBEAFE] bg-gradient-to-br from-[#F0FDF4] to-[#DBEAFE]",
        "p-4 shadow-[0_4px_12px_rgb(0_0_0/0.04)]",
        "dark:border-primary/20 dark:from-emerald-500/10 dark:to-primary/10",
        "sm:rounded-2xl sm:p-6",
      )}
    >
      <h2 className="mb-4 font-display text-base font-bold text-content sm:mb-6 sm:text-lg">
        Rewards & Referrals
      </h2>

      <div className="grid flex-1 grid-cols-1 gap-5 sm:gap-6">
        <div>
          <p className="text-xs font-medium text-muted">Referral Earnings</p>
          <p
            className="mt-1 font-display font-bold tracking-tight text-content"
            style={{ fontSize: "clamp(1.5rem, 6vw, 2rem)" }}
          >
            ₹{REFERRAL_CURRENT.toLocaleString("en-IN")}
          </p>

          <p className="mb-2 mt-4 text-xs text-muted">Your Progress</p>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-success to-cyan"
              initial={{ width: 0 }}
              whileInView={{ width: `${PCT}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.5, delay: 0.2, ease: "easeOut" }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted">
            <span>₹{REFERRAL_CURRENT.toLocaleString("en-IN")}</span>
            <span>₹{REFERRAL_TARGET.toLocaleString("en-IN")}</span>
          </div>

          <button
            type="button"
            onClick={() => showToast("Referral link copied to clipboard!", "success")}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#1D4ED8] sm:max-w-[11.5rem]"
          >
            <Gift size={16} />
            Refer Now
          </button>
        </div>

        <div className="flex flex-col items-center justify-center text-center">
          <motion.span
            whileHover={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 2 }}
            className="grid size-[60px] place-items-center rounded-full bg-gradient-to-br from-gold to-[#FDB022] text-white shadow-[0_8px_24px_rgb(212_175_55/0.3)]"
          >
            <Star size={28} fill="currentColor" />
          </motion.span>
          <p className="mt-3 font-display text-base font-bold text-content">Level 2</p>
          <p className="text-xs text-muted">Premium Member Tier</p>
          <div className="mt-4 w-full max-w-[200px]">
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-violet to-pink"
                initial={{ width: 0 }}
                whileInView={{ width: `${PCT}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              ₹{REFERRAL_CURRENT.toLocaleString("en-IN")} / ₹
              {REFERRAL_TARGET.toLocaleString("en-IN")} ({PCT}%)
            </p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

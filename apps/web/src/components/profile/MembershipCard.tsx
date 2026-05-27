"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  Clock,
  Crown,
  Gift,
  Headphones,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import { profilePremiumFeaturesRail } from "@/components/profile/profile-page-layout";
import { PROFILE_PREMIUM_FEATURES } from "@/lib/profile-dashboard";
import { useAppStore } from "@/stores/app-store";

const FEATURE_ICONS = {
  clock: Clock,
  users: Users,
  gift: Gift,
  zap: Zap,
  headphones: Headphones,
} as const;

export function MembershipCard() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const isPremium = useAppStore((s) => s.isPremium);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
      className="relative min-h-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet to-[#C026D3] p-4 text-white shadow-[0_12px_40px_rgb(124_58_237/0.28)] sm:rounded-[20px] sm:p-6 sm:shadow-[0_16px_48px_rgb(124_58_237/0.3)] lg:relative lg:p-8"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet to-[#C026D3]"
        animate={reduce ? undefined : { opacity: [1, 0.95, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      {!reduce &&
        Array.from({ length: 12 }).map((_, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="pointer-events-none absolute size-1 rounded-full bg-white/40"
            style={{
              left: `${(i * 17) % 100}%`,
              top: `${(i * 23) % 100}%`,
            }}
            animate={{
              y: [0, -20, 0],
              opacity: [0.2, 0.8, 0.2],
            }}
            transition={{
              duration: 20 + (i % 10),
              repeat: Infinity,
              delay: i * 0.4,
              ease: "easeInOut",
            }}
          />
        ))}

      <div className="relative flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <motion.div
            animate={reduce ? undefined : { y: [0, -2, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Crown size={36} className="text-gold sm:size-12" fill="currentColor" aria-hidden />
          </motion.div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2
              className="font-display font-bold tracking-wide"
              style={{ fontSize: "clamp(1.25rem, 4.5vw, 1.75rem)" }}
            >
              HOMIGO PREMIUM
            </h2>
            {isPremium && (
              <span className="rounded-lg bg-success/90 px-2 py-0.5 text-[9px] font-bold sm:rounded-xl sm:text-[10px]">
                ACTIVE
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-white/85 sm:text-sm">You are enjoying premium benefits</p>

          <div className={profilePremiumFeaturesRail}>
            {PROFILE_PREMIUM_FEATURES.map((f) => {
              const Icon = FEATURE_ICONS[f.icon];
              return (
                <div
                  key={f.label}
                  className="flex w-[72px] shrink-0 snap-start flex-col items-center gap-1 text-center sm:w-auto sm:shrink sm:snap-normal"
                >
                  <Icon size={20} className="opacity-90 sm:size-6" strokeWidth={1.75} />
                  <span className="max-w-[72px] text-[10px] font-semibold leading-tight opacity-85 sm:text-[11px]">
                    {f.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => openOverlay("premium")}
          className="flex min-h-11 w-full shrink-0 items-center justify-center gap-2 self-stretch rounded-[10px] bg-white px-4 text-[13px] font-semibold text-violet shadow-[0_4px_12px_rgb(0_0_0/0.15)] transition hover:-translate-y-0.5 sm:w-auto sm:self-start sm:px-5 sm:text-sm lg:absolute lg:bottom-6 lg:right-6"
        >
          <Settings size={14} />
          Manage Membership
        </button>
      </div>
    </motion.section>
  );
}

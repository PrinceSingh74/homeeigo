"use client";

import { useEffect } from "react";
import Link from "next/link";
import { m as motion, useReducedMotion } from "framer-motion";
import { Check, Crown, Settings } from "lucide-react";
import { useMySubscription } from "@/hooks/use-subscription";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useAppStore } from "@/stores/app-store";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function MembershipCard() {
  const reduce = useReducedMotion();
  const setPremium = useAppStore((s) => s.setPremium);
  const { data: mine } = useMySubscription();
  const { data: entitlements } = useEntitlements();

  const active = mine?.active ?? null;

  // Keep the global premium flag in sync with server entitlements (source of truth).
  useEffect(() => {
    if (entitlements) setPremium(entitlements.hasMembership);
    else if (mine) setPremium(active !== null);
  }, [mine, active, entitlements, setPremium]);

  const benefits = active?.plan.benefits ?? [];

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
      className="relative min-h-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-[0_12px_40px_rgb(16_185_129/0.28)] sm:rounded-[20px] sm:p-6 sm:shadow-[0_16px_48px_rgb(16_185_129/0.3)] lg:relative lg:p-8"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-600"
        animate={reduce ? undefined : { opacity: [1, 0.95, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

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
              HOMEEIGO PREMIUM
            </h2>
            {active && (
              <span className="rounded-lg bg-white/20 px-2 py-0.5 text-[9px] font-bold uppercase sm:rounded-xl sm:text-[10px]">
                Active
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-white/85 sm:text-sm">
            {active
              ? `${active.plan.name} · active until ${active.expiresAt ? fmtDate(active.expiresAt) : "—"}`
              : "Unlock cashback, priority support & free rescheduling."}
          </p>

          {benefits.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {benefits.slice(0, 4).map((b) => (
                <li key={b.id} className="flex items-center gap-1.5 text-[11px] font-medium text-white/90 sm:text-xs">
                  <Check size={13} strokeWidth={3} className="text-gold" />
                  {b.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          href="/membership"
          className="flex min-h-11 w-full shrink-0 items-center justify-center gap-2 self-stretch rounded-[10px] bg-white px-4 text-[13px] font-semibold text-emerald-700 shadow-[0_4px_12px_rgb(0_0_0/0.15)] transition hover:-translate-y-0.5 sm:w-auto sm:self-start sm:px-5 sm:text-sm lg:absolute lg:bottom-6 lg:right-6"
        >
          <Settings size={14} />
          {active ? "Manage membership" : "View plans"}
        </Link>
      </div>
    </motion.section>
  );
}

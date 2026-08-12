"use client";

import Link from "next/link";
import { m as motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarClock, Sparkles, Wallet } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useBookingsQuery, useWalletBalanceQuery } from "@/hooks/use-core-data";
import { bookUrl } from "@/lib/booking-url";
import { pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

/**
 * Personalized dashboard strip shown only to signed-in users at the top of Home
 * (Phase 3). Every value is live from the backend — active bookings + wallet —
 * with quick links into the rest of the ecosystem.
 */
export function AccountSummaryStrip() {
  const reduce = useReducedMotion();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { data: bookingsData, isLoading: bookingsLoading } = useBookingsQuery();
  const { data: walletData, isLoading: walletLoading } = useWalletBalanceQuery();

  if (status !== "authenticated") return null;

  const activeBookings = (bookingsData?.bookings ?? []).filter((b) =>
    ["pending", "accepted", "in_progress"].includes(b.status),
  ).length;
  const balance = walletData?.balance ?? 0;
  const name = user?.firstName?.trim() || "there";

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn(pageSection, "mt-6 sm:mt-8")}
    >
      <div className="rounded-2xl glass-card p-4 sm:rounded-3xl sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-display text-base font-bold text-content sm:text-lg">
            Welcome back, {name} 👋
          </p>
          <Link
            href={bookUrl({})}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[linear-gradient(120deg,#10b981_0%,#0d9488_100%)] px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_rgb(16_185_129/0.5)] transition hover:-translate-y-0.5 sm:text-sm"
          >
            <Sparkles size={14} />
            Book a service
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/bookings"
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-3 transition hover:border-emerald-500/40 sm:p-4"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400">
              <CalendarClock size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-muted">Active bookings</span>
              <span className="block font-display text-lg font-bold text-content">
                {bookingsLoading ? "—" : activeBookings}
              </span>
            </span>
            <ArrowRight size={16} className="text-muted transition group-hover:translate-x-0.5" />
          </Link>

          <Link
            href="/wallet"
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-3 transition hover:border-emerald-500/40 sm:p-4"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-500/15 to-emerald-500/15 text-teal-600 dark:text-teal-400">
              <Wallet size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-muted">Wallet balance</span>
              <span className="block font-display text-lg font-bold text-content">
                {walletLoading
                  ? "—"
                  : `₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              </span>
            </span>
            <ArrowRight size={16} className="text-muted transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

"use client";

import { useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { Copy, Gift, Users, Wallet } from "lucide-react";
import { useReferralSummary, useReferralWithdraw } from "@/hooks/use-referrals";
import { ReferralDashboardModal } from "@/components/profile/ReferralDashboardModal";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function RewardsReferrals() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const { data: summary } = useReferralSummary();
  const withdraw = useReferralWithdraw();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const code = summary?.code ?? null;
  const count = summary?.referralCount ?? 0;
  const balance = summary?.balance ?? 0;
  const earned = summary?.totalEarned ?? 0;

  const copyCode = () => {
    if (!code) {
      showToast("No referral code yet", "info");
      return;
    }
    void navigator.clipboard?.writeText(code);
    showToast("Referral code copied!", "success");
  };

  const doWithdraw = async () => {
    if (balance <= 0 || busy) return;
    setBusy(true);
    await withdraw(balance);
    setBusy(false);
  };

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-xl border border-[#DBEAFE] bg-gradient-to-br from-[#F0FDF4] to-[#DBEAFE]",
        "p-4 shadow-[0_4px_12px_rgb(0_0_0/0.04)]",
        "dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-primary/10",
        "sm:rounded-2xl sm:p-6",
      )}
    >
      <div className="mb-4 flex items-center justify-between sm:mb-6">
        <h2 className="font-display text-base font-bold text-content sm:text-lg">Rewards &amp; Referrals</h2>
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-emerald-600 hover:underline">
          View details
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-muted">Your referral code</p>
          {code ? (
            <button type="button" onClick={copyCode} className="mt-1 flex items-center gap-2 text-left">
              <span className="font-display text-2xl font-bold tracking-wide text-content sm:text-3xl">{code}</span>
              <Copy size={16} className="text-muted" />
            </button>
          ) : (
            <p className="mt-1 font-display text-lg font-bold text-muted">Not available</p>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Users size={14} />
            {count} friend{count === 1 ? "" : "s"} joined · earn {inr(summary?.commissionPerReferral ?? 100)} each
          </div>
        </div>

        <div className="rounded-xl bg-surface/60 p-3 ring-1 ring-line/60">
          <p className="text-xs text-muted">Referral earnings</p>
          <p className="mt-0.5 font-display text-2xl font-bold text-content">{inr(balance)}</p>
          <p className="text-[11px] text-muted">{inr(earned)} earned all-time · withdraw to your wallet anytime.</p>
          {balance > 0 && (
            <button
              type="button"
              onClick={() => void doWithdraw()}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Wallet size={13} />
              {busy ? "Moving…" : `Withdraw ${inr(balance)} to wallet`}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={copyCode}
          className="mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-emerald-600 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700"
        >
          <Gift size={16} />
          Share code
        </button>
      </div>

      <ReferralDashboardModal open={open} onClose={() => setOpen(false)} />
    </motion.section>
  );
}

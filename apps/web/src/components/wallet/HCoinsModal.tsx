"use client";

import { useState } from "react";
import { Coins, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useHCoinHistory, useHCoinRedeem, useHCoinSummary } from "@/hooks/use-hcoins";
import { cn } from "@/lib/utils";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function HCoinsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: summary } = useHCoinSummary();
  const { data: history } = useHCoinHistory(open);
  const redeem = useHCoinRedeem();
  const [busy, setBusy] = useState(false);

  const balance = summary?.balance ?? 0;
  const minRedeem = summary?.minRedeem ?? 100;
  const canRedeem = balance >= minRedeem;

  const doRedeem = async () => {
    if (!canRedeem || busy) return;
    setBusy(true);
    await redeem(balance);
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="H-Coins" size="sm">
      <div className="flex flex-col gap-4">
        {/* Balance */}
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-br from-[#FFFBEB] to-[#FEF3C7] p-5 text-center dark:from-amber-500/10 dark:to-amber-500/5">
          <Coins size={28} className="text-[#D4AF37]" />
          <p className="font-display text-3xl font-extrabold text-content">{balance.toLocaleString("en-IN")}</p>
          <p className="text-xs text-muted">≈ ₹{(summary?.redeemableValue ?? 0).toLocaleString("en-IN")} redeemable · 1 coin = ₹{summary?.coinValue ?? 0.1}</p>
        </div>

        <button
          type="button"
          onClick={() => void doRedeem()}
          disabled={!canRedeem || busy}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <Wallet size={15} />
          {busy ? "Redeeming…" : canRedeem ? `Redeem ${balance} coins → ₹${summary?.redeemableValue ?? 0} wallet` : `Earn ${minRedeem - balance} more to redeem`}
        </button>

        <p className="rounded-lg bg-canvas px-3 py-2 text-[11px] text-muted dark:bg-charcoal/60">
          Earn coins on every completed booking, review &amp; referral. Redeem to your wallet, usable on any service or membership.
        </p>

        {/* History */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">Activity</p>
          {!history || history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-5 text-center text-xs text-muted">
              No H-Coin activity yet.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {history.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-content">{t.description}</p>
                    <p className="text-[11px] text-muted">{fmt(t.createdAt)}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-bold", t.type === "EARN" ? "text-success" : "text-muted")}>
                    {t.type === "EARN" ? "+" : "−"}
                    {t.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

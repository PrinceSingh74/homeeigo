"use client";

import Link from "next/link";
import { ArrowUpRight, IndianRupee, Plus, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import {
  WALLET_BALANCE,
  WALLET_TRANSACTIONS,
  formatBalance,
  formatWalletAmount,
} from "@/lib/wallet";

export function WalletModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const isPremium = useAppStore((s) => s.isPremium);

  return (
    <Modal open={open} onClose={closeOverlay} title="HOMIGO Wallet" size="md">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3a8a] via-[#4f46e5] to-[#7b61ff] p-6 text-white shadow-[0_16px_48px_rgb(79_70_229/0.35)]">
        <p className="text-sm font-medium text-white/75">Available balance</p>
        <p className="mt-1 flex items-center gap-1 font-display text-4xl font-bold tracking-tight">
          <IndianRupee size={28} strokeWidth={2.5} />
          {formatBalance(WALLET_BALANCE)}
        </p>
        {isPremium && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">
            <Sparkles size={12} /> Premium cashback active
          </p>
        )}
      </div>

      <ul className="mt-6 flex flex-col gap-2">
        {WALLET_TRANSACTIONS.slice(0, 3).map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded-2xl border border-line px-4 py-3"
          >
            <span>
              <span className="block text-sm font-bold text-content">{t.label}</span>
              <span className="text-xs text-muted">{t.time}</span>
            </span>
            <span
              className={
                t.type === "credit"
                  ? "text-sm font-bold text-success"
                  : "text-sm font-bold text-content"
              }
            >
              {formatWalletAmount(t.amount)}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/wallet"
        onClick={closeOverlay}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line text-sm font-bold text-content transition hover:bg-primary/5"
      >
        View full wallet
        <ArrowUpRight size={16} />
      </Link>

      <button
        type="button"
        onClick={() => {
          showToast("Add money — UPI & cards coming soon", "info");
        }}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-aurora text-sm font-bold text-white"
      >
        <Plus size={18} />
        Add money
        <ArrowUpRight size={16} />
      </button>
    </Modal>
  );
}

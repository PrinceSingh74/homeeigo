"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, IndianRupee, Plus, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { formatBalance, formatWalletAmount } from "@/lib/wallet";
import {
  useAddMoneyMutation,
  useWalletBalanceQuery,
  useWalletTransactionsQuery,
} from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";

const QUICK_AMOUNTS = [200, 500, 1000, 2000];

export function WalletModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const isPremium = useAppStore((s) => s.isPremium);

  const balanceQuery = useWalletBalanceQuery();
  const txnsQuery = useWalletTransactionsQuery();
  const addMoney = useAddMoneyMutation();
  const { openCheckout } = useRazorpayCheckout();
  const [busy, setBusy] = useState(false);

  const balance = balanceQuery.data?.balance ?? 0;
  const txns = (txnsQuery.data?.transactions ?? []).slice(0, 3);

  async function handleTopup(amount: number) {
    if (busy) return;
    setBusy(true);
    try {
      const order = await addMoney.mutateAsync(amount);
      await openCheckout({
        key: (order as { key?: string }).key ?? "",
        orderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        name: "HOMEEIGO Wallet",
        description: "Wallet top-up",
        onSuccess: () => {
          showToast(`₹${amount} added to wallet`, "success");
        },
        onDismiss: () => {
          showToast("Top-up cancelled", "info");
        },
      });
    } catch {
      // mutation handles toast
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={closeOverlay} title="HOMEEIGO Wallet" size="md">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3a8a] via-[#4f46e5] to-[#7b61ff] p-6 text-white shadow-[0_16px_48px_rgb(79_70_229/0.35)]">
        <p className="text-sm font-medium text-white/75">Available balance</p>
        <p className="mt-1 flex items-center gap-1 font-display text-4xl font-bold tracking-tight">
          <IndianRupee size={28} strokeWidth={2.5} />
          {balanceQuery.isLoading ? "—" : formatBalance(balance)}
        </p>
        {isPremium && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">
            <Sparkles size={12} /> Premium cashback active
          </p>
        )}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Quick add</p>
        <div className="grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              disabled={busy}
              onClick={() => void handleTopup(amount)}
              className="rounded-2xl border border-line px-3 py-2.5 text-sm font-bold text-content transition hover:bg-primary/5 disabled:opacity-60"
            >
              ₹{amount}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-6 flex flex-col gap-2">
        {txnsQuery.isLoading ? (
          <li className="rounded-2xl border border-line px-4 py-3 text-sm text-muted">Loading…</li>
        ) : txns.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            No recent transactions
          </li>
        ) : (
          txns.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-2xl border border-line px-4 py-3"
            >
              <span>
                <span className="block text-sm font-bold text-content">
                  {t.description ?? t.reason ?? "Transaction"}
                </span>
                <span className="text-xs text-muted">
                  {new Date(t.createdAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
              </span>
              <span
                className={
                  t.type === "credit"
                    ? "text-sm font-bold text-success"
                    : "text-sm font-bold text-content"
                }
              >
                {formatWalletAmount(t.type === "credit" ? t.amount : -t.amount)}
              </span>
            </li>
          ))
        )}
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
        disabled={busy}
        onClick={() => void handleTopup(500)}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-aurora text-sm font-bold text-white disabled:opacity-70"
      >
        <Plus size={18} />
        {busy ? "Opening checkout…" : "Add money"}
      </button>
    </Modal>
  );
}

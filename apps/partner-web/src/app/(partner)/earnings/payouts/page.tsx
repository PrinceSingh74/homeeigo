"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Clock, TrendingUp, Wallet } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import { usePartnerPayoutsQuery } from "@/hooks/use-partner-data";
import { formatDate } from "@/lib/format";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function PartnerPayoutsPage() {
  const { data, isLoading } = usePartnerPayoutsQuery();
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const withdrawals = data?.withdrawals ?? [];
  const available = data?.availableBalance ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/earnings"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-partner-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to earnings
        </Link>
        <h1 className="font-display text-2xl font-bold">Request payout</h1>
        <p className="text-sm text-partner-muted">Withdraw to your bank — real backend processing</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PartnerCard className="!p-4">
          <div className="flex items-center gap-2 text-partner-muted">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium">Available balance</span>
          </div>
          <p className="font-display mt-2 text-2xl font-bold">
            {isLoading ? "…" : inr(available)}
          </p>
          <PartnerButton className="mt-4 w-full" disabled={available <= 0} onClick={() => setWithdrawOpen(true)}>
            Request withdrawal
          </PartnerButton>
        </PartnerCard>
        <PartnerCard className="!p-4">
          <div className="flex items-center gap-2 text-partner-muted">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-medium">Pending</span>
          </div>
          <p className="font-display mt-2 text-2xl font-bold">
            {isLoading ? "…" : inr(data?.pendingBalance ?? 0)}
          </p>
        </PartnerCard>
        <PartnerCard className="!p-4">
          <div className="flex items-center gap-2 text-partner-muted">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Lifetime earnings</span>
          </div>
          <p className="font-display mt-2 text-2xl font-bold">
            {isLoading ? "…" : inr(data?.lifetimeEarnings ?? 0)}
          </p>
        </PartnerCard>
        <PartnerCard className="!p-4">
          <div className="flex items-center gap-2 text-partner-muted">
            <Banknote className="h-4 w-4" />
            <span className="text-xs font-medium">Next payout</span>
          </div>
          <p className="mt-2 text-sm font-semibold">
            {data?.nextPayoutDate
              ? formatDate(String(data.nextPayoutDate))
              : "No pending payout"}
          </p>
        </PartnerCard>
      </div>

      <PartnerCard className="overflow-hidden !p-0">
        <div className="border-b border-partner-line px-4 py-3">
          <h2 className="font-semibold">Payout history</h2>
        </div>
        {withdrawals.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-partner-muted">No payouts yet</p>
        ) : (
          <ul className="divide-y divide-partner-line">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{w.reference}</p>
                  <p className="text-partner-muted capitalize">
                    {w.status}
                    {w.bank ? ` · ${w.bank}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{inr(w.netAmount)}</p>
                  <p className="text-xs text-partner-muted">
                    {w.settlementDate ? formatDate(String(w.settlementDate)) : "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PartnerCard>

      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        walletBalance={available}
      />
    </div>
  );
}

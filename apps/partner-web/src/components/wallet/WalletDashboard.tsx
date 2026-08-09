"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, BookOpen, IndianRupee, Loader2, Wallet } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { WithdrawModal } from "@/components/wallet/WithdrawModal";
import {
  usePartnerMeQuery,
  usePartnerPayoutsQuery,
  useWalletBalanceQuery,
  useWalletTransactionsQuery,
} from "@/hooks/use-partner-data";
import { usePartnerEarningsStream } from "@/hooks/use-partner-earnings-stream";
import { formatDate, formatInr, formatTime } from "@/lib/format";

export function WalletDashboard() {
  const me = usePartnerMeQuery();
  const balanceQuery = useWalletBalanceQuery();
  const payoutsQuery = usePartnerPayoutsQuery();
  const transactionsQuery = useWalletTransactionsQuery({ page: 1, limit: 20 });
  // Live wallet + earnings tiles. REST queries remain the source of truth;
  // the stream only overlays a fresher snapshot when one is available.
  const { snapshot: liveEarnings } = usePartnerEarningsStream();

  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const totalBalance =
    liveEarnings?.walletBalance ??
    payoutsQuery.data?.currentBalance ??
    balanceQuery.data?.balance ??
    me.data?.walletBalance ??
    0;
  const available =
    payoutsQuery.data?.availableBalance ?? totalBalance;
  const reserved = Math.max(0, totalBalance - available);
  const availablePct = totalBalance > 0 ? (available / totalBalance) * 100 : 0;

  const transactions = transactionsQuery.data?.transactions ?? [];

  return (
    <div className="space-y-4">
      <PartnerCard className="relative overflow-hidden bg-gradient-to-br from-partner-primary/25 to-partner-card">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-partner-primary/20 blur-3xl" />
        <div className="flex items-center gap-2 text-partner-muted">
          <Wallet className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">Total balance</span>
        </div>
        <motion.p
          key={totalBalance}
          className="font-display mt-2 text-4xl font-bold tracking-tight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {balanceQuery.isLoading && payoutsQuery.isLoading ? "—" : formatInr(totalBalance)}
        </motion.p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-partner-muted">Available</p>
            <p className="font-semibold">{formatInr(available)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-partner-muted">Reserved</p>
            <p className="font-semibold">{formatInr(reserved)}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/20">
          <div
            className="h-full rounded-full bg-white/90 transition-all"
            style={{ width: `${Math.min(100, availablePct)}%` }}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <PartnerButton
            disabled={available <= 0 || balanceQuery.isLoading}
            onClick={() => setWithdrawOpen(true)}
          >
            <ArrowUpRight className="h-4 w-4" />
            Withdraw
          </PartnerButton>
          <Link
            href="/earnings/payouts"
            className="inline-flex items-center rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold hover:bg-partner-bg/40"
          >
            Payout history
          </Link>
        </div>
      </PartnerCard>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/wallet/ledger" className="block">
          <PartnerCard className="h-full transition hover:border-partner-primary/40">
            <BookOpen className="h-4 w-4 text-partner-primary" />
            <p className="mt-2 text-sm font-semibold">View full ledger</p>
            <p className="text-xs text-partner-muted">Paginated transaction history</p>
          </PartnerCard>
        </Link>
        <Link href="/earnings" className="block">
          <PartnerCard className="h-full transition hover:border-partner-primary/40">
            <IndianRupee className="h-4 w-4 text-partner-success" />
            <p className="mt-2 text-sm font-semibold">Earnings analytics</p>
            <p className="text-xs text-partner-muted">Charts, breakdown & settlements</p>
          </PartnerCard>
        </Link>
      </div>

      <PartnerCard>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Recent transactions</p>
          {transactionsQuery.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" />
          ) : null}
        </div>
        {transactionsQuery.isLoading ? (
          <ul className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-lg bg-partner-bg/60"
              />
            ))}
          </ul>
        ) : transactionsQuery.isError ? (
          <p className="mt-3 text-sm text-partner-danger">
            Failed to load transactions.
          </p>
        ) : transactions.length === 0 ? (
          <p className="mt-3 text-sm text-partner-muted">
            No transactions yet. Complete your first job to start earning.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {transactions.map((tx) => {
              const isCredit = tx.type === "credit" || tx.amount > 0;
              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between border-b border-partner-line py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-partner-text">
                      {tx.description || tx.transactionNumber || "Transaction"}
                    </p>
                    <p className="text-[10px] text-partner-muted">
                      {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                    </p>
                  </div>
                  <span
                    className={
                      isCredit ? "text-partner-success" : "text-partner-danger"
                    }
                  >
                    {isCredit ? "+" : "-"}
                    {formatInr(Math.abs(tx.amount))}
                  </span>
                </li>
              );
            })}
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

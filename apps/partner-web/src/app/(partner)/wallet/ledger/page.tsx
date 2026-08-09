"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { useWalletTransactionsQuery } from "@/hooks/use-partner-data";
import { formatDate, formatInr, formatTime } from "@/lib/format";

const PAGE_SIZE = 25;

export default function WalletLedgerPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useWalletTransactionsQuery({
    page,
    limit: PAGE_SIZE,
  });

  const transactions = data?.transactions ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/wallet"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-partner-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to wallet
        </Link>
        <h1 className="font-display text-2xl font-bold">Transaction ledger</h1>
        <p className="text-sm text-partner-muted">Complete wallet history from the backend</p>
      </div>

      <PartnerCard>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">All transactions</p>
          {isFetching && !isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" />
          ) : null}
        </div>

        {isLoading ? (
          <ul className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-12 animate-pulse rounded-lg bg-partner-bg/60" />
            ))}
          </ul>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-sm text-partner-muted">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-partner-line">
            {transactions.map((tx) => {
              const isCredit = tx.type === "credit" || tx.amount > 0;
              return (
                <li key={tx.id} className="flex items-center justify-between py-3 text-sm">
                  <div className="min-w-0 pr-4">
                    <p className="truncate font-medium">
                      {tx.description || tx.transactionNumber || "Transaction"}
                    </p>
                    <p className="text-[10px] text-partner-muted">
                      {tx.transactionNumber ? `${tx.transactionNumber} · ` : ""}
                      {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={
                        isCredit ? "font-semibold text-partner-success" : "font-semibold text-partner-danger"
                      }
                    >
                      {isCredit ? "+" : "-"}
                      {formatInr(Math.abs(tx.amount))}
                    </p>
                    {tx.status ? (
                      <p className="text-[10px] capitalize text-partner-muted">{tx.status}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {total > PAGE_SIZE ? (
          <div className="mt-4 flex items-center justify-between border-t border-partner-line pt-4">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-partner-line px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-partner-muted">
              Page {page} · {total} total
            </span>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-partner-line px-3 py-1.5 text-xs font-medium disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}
      </PartnerCard>
    </div>
  );
}

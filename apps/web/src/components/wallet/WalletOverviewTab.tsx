"use client";

import { Lock } from "lucide-react";
import { WalletDonutChart } from "@/components/wallet/WalletDonutChart";
import { WalletTransactionList } from "@/components/wallet/WalletTransactionList";
import { walletPanelPad } from "@/components/wallet/wallet-page-layout";
import { cn } from "@/lib/utils";

type WalletOverviewTabProps = {
  onViewAllTransactions: () => void;
};

export function WalletOverviewTab({ onViewAllTransactions }: WalletOverviewTabProps) {
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
      <div className={cn("wallet-panel min-w-0", walletPanelPad)}>
        <h3 className="mb-4 font-display text-base font-bold text-content sm:mb-6 sm:text-lg">
          Balance Breakdown
        </h3>
        <WalletDonutChart />
        <div className="wallet-secure-badge mt-4 flex gap-2 p-3 sm:mt-5">
          <Lock size={15} className="mt-0.5 shrink-0 text-success sm:size-4" strokeWidth={2} />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-success sm:text-xs">Secure Wallet</p>
            <p className="text-[10px] leading-snug text-content sm:text-[11px]">
              Your payments are 100% secure. Protected by bank-level security.
            </p>
          </div>
        </div>
      </div>

      <div className={cn("wallet-panel min-w-0", walletPanelPad)}>
        <div className="mb-4 flex min-w-0 items-center justify-between gap-2 sm:mb-5">
          <h3 className="font-display text-base font-bold text-content sm:text-lg">
            Recent Transactions
          </h3>
          <button
            type="button"
            onClick={onViewAllTransactions}
            className="shrink-0 text-[12px] font-semibold text-emerald-600 transition hover:opacity-80 sm:text-[13px]"
          >
            View All
          </button>
        </div>
        <WalletTransactionList compact />
      </div>
    </div>
  );
}

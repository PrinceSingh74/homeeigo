"use client";

import { ArrowUpRight, Coins, Sparkles, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WalletRecentTxn } from "@/lib/wallet-dashboard";
import { WALLET_RECENT_TXNS } from "@/lib/wallet-dashboard";

function TxnIcon({ title }: { title: string }) {
  if (title.includes("added")) return <Wallet size={18} />;
  if (title.includes("Cleaning")) return <ArrowUpRight size={18} />;
  if (title.includes("Promo")) return <Sparkles size={18} />;
  return <Coins size={18} />;
}

export function WalletTransactionList({
  items = WALLET_RECENT_TXNS,
  compact = false,
}: {
  items?: WalletRecentTxn[];
  compact?: boolean;
}) {
  return (
    <ul className={cn("flex flex-col gap-3", !compact && "max-h-[400px] overflow-y-auto")}>
      {items.map((t) => (
        <li
          key={t.id}
          className="wallet-muted-row flex min-w-0 items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3"
        >
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[10px]"
            style={{ backgroundColor: t.iconBg, color: t.iconColor }}
          >
            <TxnIcon title={t.title} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-content">{t.title}</p>
            <p className="text-[11px] text-muted">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "font-mono text-[13px] font-semibold",
                t.type === "credit" ? "text-success" : "text-error",
              )}
            >
              {t.type === "credit" ? "+" : ""}₹{Math.abs(t.amount).toLocaleString("en-IN")}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Success
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WalletTransactionsTab() {
  return (
    <div className="wallet-panel min-w-0 p-0">
      <div className="p-1 sm:p-2">
        <WalletTransactionList items={WALLET_RECENT_TXNS} />
      </div>
    </div>
  );
}

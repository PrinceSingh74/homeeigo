"use client";

import { useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import {
  walletQuickActionItem,
  walletQuickActionsRail,
} from "@/components/wallet/wallet-page-layout";
import { WALLET_QUICK_ACTIONS } from "@/lib/wallet-dashboard";
import { AddMoneyModal } from "@/components/wallet/AddMoneyModal";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type WalletQuickActionsProps = {
  onTabChange?: (tab: "transactions" | "invoices") => void;
};

export function WalletQuickActions({ onTabChange }: WalletQuickActionsProps) {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="min-w-0">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted sm:mb-4 sm:text-xs">
        Quick Actions
      </p>
      <div className={walletQuickActionsRail}>
        {WALLET_QUICK_ACTIONS.map((action, i) => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.id}
              type="button"
              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              onClick={() => {
                if (action.id === "txns") onTabChange?.("transactions");
                else if (action.id === "invoices") onTabChange?.("invoices");
                else if (action.id === "add") setAddOpen(true);
                else showToast(`${action.label} — coming soon`, "info");
              }}
              className={cn(walletQuickActionItem, "text-center transition active:scale-[0.96]")}
            >
              <span
                className="grid size-9 place-items-center rounded-xl sm:size-10"
                style={{ backgroundColor: action.bg, color: action.color }}
              >
                <Icon size={20} className="sm:hidden" />
                <Icon size={22} className="hidden sm:block" />
              </span>
              <span className="w-full truncate text-[11px] font-semibold tracking-tight text-content sm:text-[13px]">
                {action.label}
              </span>
            </motion.button>
          );
        })}
      </div>
      <AddMoneyModal open={addOpen} onClose={() => setAddOpen(false)} />
    </section>
  );
}

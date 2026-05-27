"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { WalletTabId } from "@/lib/wallet-dashboard";
import { WALLET_TABS } from "@/lib/wallet-dashboard";
import { WalletOverviewTab } from "@/components/wallet/WalletOverviewTab";
import { WalletTransactionsTab } from "@/components/wallet/WalletTransactionList";
import { WalletInvoicesTab } from "@/components/wallet/WalletInvoicesTab";
import { WalletPaymentMethodsTab } from "@/components/wallet/WalletPaymentMethodsTab";
import {
  walletPanelShell,
  walletTabBtn,
  walletTabPanel,
  walletTabsRow,
} from "@/components/wallet/wallet-page-layout";

type WalletTabbedContentProps = {
  activeTab: WalletTabId;
  onTabChange: (tab: WalletTabId) => void;
};

export function WalletTabbedContent({ activeTab, onTabChange }: WalletTabbedContentProps) {
  const reduce = useReducedMotion();

  return (
    <section className={walletPanelShell}>
      <div className={walletTabsRow}>
        {WALLET_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                walletTabBtn,
                "transition-colors duration-200",
                active
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-muted hover:text-primary",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <motion.div
        key={activeTab}
        initial={reduce ? false : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        className={walletTabPanel}
      >
        {activeTab === "overview" && (
          <WalletOverviewTab onViewAllTransactions={() => onTabChange("transactions")} />
        )}
        {activeTab === "transactions" && <WalletTransactionsTab />}
        {activeTab === "invoices" && <WalletInvoicesTab />}
        {activeTab === "payment-methods" && <WalletPaymentMethodsTab />}
      </motion.div>
    </section>
  );
}

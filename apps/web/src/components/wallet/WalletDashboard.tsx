"use client";

import { useState } from "react";
import { WalletTopBar } from "@/components/wallet/WalletTopBar";
import { WalletBalanceSection } from "@/components/wallet/WalletBalanceSection";
import { WalletQuickActions } from "@/components/wallet/WalletQuickActions";
import { WalletTabbedContent } from "@/components/wallet/WalletTabbedContent";
import { WalletRightRail } from "@/components/wallet/WalletRightRail";
import { WalletTrustBar } from "@/components/wallet/WalletTrustBar";
import {
  walletContainer,
  walletContent,
  walletMain,
  walletMainGrid,
  walletPageHeader,
  walletPageRoot,
  walletPageTitle,
  walletShell,
} from "@/components/wallet/wallet-page-layout";
import type { WalletTabId } from "@/lib/wallet-dashboard";

export function WalletDashboard() {
  const [activeTab, setActiveTab] = useState<WalletTabId>("overview");

  return (
    <div className={walletPageRoot}>
      <div className={walletShell}>
        <WalletTopBar />

        <div className={walletMain}>
          <div className={walletContainer}>
            <header className={walletPageHeader}>
              <h1 className={walletPageTitle}>Wallet</h1>
              <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted sm:mt-2 sm:text-base">
                Manage your balance, payments and rewards
              </p>
            </header>

            <div className={walletContent}>
              <WalletBalanceSection />
              <WalletQuickActions onTabChange={(tab) => setActiveTab(tab)} />

              <div className={walletMainGrid}>
                <div className="min-w-0 space-y-5 sm:space-y-8">
                  <WalletTabbedContent activeTab={activeTab} onTabChange={setActiveTab} />
                  <WalletTrustBar />
                </div>
                <WalletRightRail />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

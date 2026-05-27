"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Gift, IndianRupee, Wallet } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { DEMO_WALLET } from "@/lib/partner-data";

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export function WalletDashboard() {
  return (
    <div className="space-y-4">
      <PartnerCard className="relative overflow-hidden bg-gradient-to-br from-partner-primary/25 to-partner-card">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-partner-primary/20 blur-3xl" />
        <div className="flex items-center gap-2 text-partner-muted">
          <Wallet className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">Available balance</span>
        </div>
        <motion.p
          className="font-display mt-2 text-4xl font-bold tracking-tight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {inr(DEMO_WALLET.balance)}
        </motion.p>
        <PartnerButton className="mt-4 w-full sm:w-auto">
          <ArrowUpRight className="h-4 w-4" />
          Withdraw to bank
        </PartnerButton>
      </PartnerCard>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Today", value: DEMO_WALLET.today, icon: IndianRupee },
          { label: "This week", value: DEMO_WALLET.week, icon: IndianRupee },
          { label: "Incentives", value: DEMO_WALLET.incentives, icon: Gift },
        ].map((row) => (
          <PartnerCard key={row.label}>
            <row.icon className="h-4 w-4 text-partner-success" />
            <p className="mt-2 text-xs text-partner-muted">{row.label}</p>
            <p className="font-display text-xl font-bold">{inr(row.value)}</p>
          </PartnerCard>
        ))}
      </div>

      <PartnerCard>
        <p className="text-sm font-semibold">Recent payouts</p>
        <ul className="mt-3 space-y-2 text-sm text-partner-muted">
          <li className="flex justify-between border-b border-partner-line pb-2">
            <span>UPI •••• 4892</span>
            <span className="text-partner-success">+₹8,400</span>
          </li>
          <li className="flex justify-between border-b border-partner-line pb-2">
            <span>Bank transfer</span>
            <span className="text-partner-success">+₹12,000</span>
          </li>
          <li className="flex justify-between">
            <span>Weekly bonus</span>
            <span className="text-partner-warning">+₹1,200</span>
          </li>
        </ul>
      </PartnerCard>
    </div>
  );
}

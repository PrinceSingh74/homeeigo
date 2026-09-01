"use client";

import { Banknote, Landmark, RotateCcw, Wallet } from "lucide-react";
import { CommandHubPage } from "@/components/command/CommandHubPage";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";
import { useQuery } from "@tanstack/react-query";
import { StatTile } from "@/components/hq/primitives";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function EarningsPage() {
  const dash = useQuery({
    queryKey: ["admin", "finance-dashboard", 30],
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 60_000,
  });
  const overview = (dash.data?.overview ?? {}) as Record<string, unknown>;
  const gmv = typeof overview.gmv === "number" ? overview.gmv : undefined;
  const partnerNet = typeof overview.providerPayable === "number" ? overview.providerPayable : undefined;

  return (
    <CommandHubPage
      icon={Wallet}
      tone="success"
      title="Earnings"
      subtitle="Partner earnings, payouts, and ledger — Finance HQ owns the engine. This hub does not post money."
      links={[
        { href: "/payments", label: "Payments & partner net", description: "GMV, platform take, partner net", icon: Wallet, tone: "success" },
        { href: "/finance/payouts", label: "Payouts", description: "Withdrawal queue and batches", icon: Banknote },
        { href: "/finance/dashboard", label: "CFO Dashboard", description: "Revenue, liabilities, period view", icon: Landmark },
        { href: "/finance/reconciliation", label: "Reconciliation", description: "Settlement and ledger integrity", icon: RotateCcw },
      ]}
    >
      <CommandCenterRail />
      {dash.isError ? (
        <div className="biz-glass-panel p-4" role="alert">
          <p className="text-sm">Earnings figures need PAYMENTS/WALLET access.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="GMV (30d)" value={gmv != null ? inr(gmv) : "—"} loading={dash.isLoading} sub={gmv == null && !dash.isLoading ? "Not in this payload" : undefined} />
          <StatTile label="Partner payable" value={partnerNet != null ? inr(partnerNet) : "—"} loading={dash.isLoading} sub={partnerNet == null && !dash.isLoading ? "Insufficient data" : "Wallet liability"} />
        </div>
      )}
    </CommandHubPage>
  );
}

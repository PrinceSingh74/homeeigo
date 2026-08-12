"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet, Gift, Coins, RotateCcw, Banknote, AlertTriangle, Users, Layers } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

const FIELDS: { key: string; label: string; icon: typeof Wallet }[] = [
  { key: "walletLiability", label: "Wallet Liability", icon: Wallet },
  { key: "giftCardLiability", label: "Gift Card Liability", icon: Gift },
  { key: "cashbackLiability", label: "Cashback Liability", icon: Coins },
  { key: "referralLiability", label: "Referral Liability", icon: Users },
  { key: "providerPayable", label: "Provider Liability", icon: Banknote },
  { key: "refundLiability", label: "Refund Liability", icon: RotateCcw },
  { key: "chargebackExposure", label: "Chargeback Exposure", icon: AlertTriangle },
  { key: "hcoinLiability", label: "H-Coin Liability", icon: Coins },
  { key: "adjustmentLiability", label: "Adjustment Liability", icon: Layers },
];

function inr(n: unknown) {
  const v = typeof n === "number" ? n : 0;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function FinanceLiabilitiesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "liabilities"],
    queryFn: () => adminApi.financeLiabilities(),
  });

  const current = (data?.current ?? {}) as Record<string, number>;
  const daily = (data?.snapshots?.daily ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CFO Liability Dashboard</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Real-time platform liabilities across wallet, gift cards, cashback, referral, provider, refund, chargeback, H-Coin & adjustments
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total Liabilities" value={inr(current.totalLiabilities)} icon={Layers} accent="red" loading={isLoading} />
        {FIELDS.map(({ key, label, icon }) => (
          <KpiCard key={key} label={label} value={inr(current[key])} icon={icon} loading={isLoading} />
        ))}
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Daily liability trend (last {daily.length} snapshots)</h2>
        {daily.length === 0 ? (
          <p className="text-sm text-[var(--color-biz-muted)]">No snapshots captured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--color-biz-muted)]">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Wallet</th>
                  <th className="py-2 pr-4">Gift Card</th>
                  <th className="py-2 pr-4">Cashback</th>
                  <th className="py-2 pr-4">Referral</th>
                  <th className="py-2 pr-4">H-Coin</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--color-biz-line)]">
                    <td className="py-2 pr-4">{String(row.snapshotDate ?? "").slice(0, 10)}</td>
                    <td className="py-2 pr-4">{inr(row.walletLiability)}</td>
                    <td className="py-2 pr-4">{inr(row.giftCardLiability)}</td>
                    <td className="py-2 pr-4">{inr(row.cashbackLiability)}</td>
                    <td className="py-2 pr-4">{inr(row.referralLiability)}</td>
                    <td className="py-2 pr-4">{inr(row.hcoinLiability)}</td>
                    <td className="py-2 pr-4 font-semibold">{inr(row.totalLiabilities)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import { Gift, ShieldAlert, TrendingUp, Users, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { useAdminReferralAnalyticsQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";

export default function ReferralsPage() {
  const { data, isLoading, isFetching, isError, refetch } = useAdminReferralAnalyticsQuery();

  const leaderRows = useMemo(
    () => (data?.leaderboard ?? []).map((l) => [`#${l.rank}`, l.name, formatNumber(l.referrals), inr(l.earned)]),
    [data],
  );
  const fraudRows = useMemo(
    () =>
      (data?.fraudFlags ?? []).map((f) => [
        f.name,
        f.email,
        formatNumber(f.pendingReferrals),
        f.reason,
      ]),
    [data],
  );

  return (
    <PageShell title="Referrals" subtitle="Referral performance, leaderboard & fraud signals">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total referrals" value={formatNumber(data?.totalReferrals ?? 0)} icon={Users} />
        <KpiCard label="Qualified" value={formatNumber(data?.qualified ?? 0)} icon={TrendingUp} sub={`${formatNumber(data?.pending ?? 0)} pending`} />
        <KpiCard label="Commission paid" value={inr(data?.totalCommission ?? 0)} icon={Gift} />
        <KpiCard label="Withdrawn to wallet" value={inr(data?.totalWithdrawn ?? 0)} icon={Wallet} />
      </div>

      <h2 className="mt-6 text-base font-semibold">Top referrers</h2>
      <div className="mt-3">
        <DataTable
          headers={["Rank", "Name", "Referrals", "Earned"]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No referrals yet."
          rows={leaderRows}
        />
      </div>

      <h2 className="mt-8 flex items-center gap-2 text-base font-semibold">
        <ShieldAlert size={18} className="text-amber-400" /> Fraud signals
      </h2>
      <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
        Referrers with many pending sign-ups but no qualified bookings — review for fake accounts.
      </p>
      <div className="mt-3">
        <DataTable
          headers={["Name", "Email", "Pending", "Reason"]}
          emptyMessage="No suspicious referrers. 🎉"
          rows={fraudRows}
        />
      </div>
    </PageShell>
  );
}

"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CreditCard, RefreshCw, Wallet } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import {
  useAdminAnalyticsQuery,
  useAdminDashboardQuery,
} from "@/hooks/use-admin-data";
import { daysAgoIso, formatNumber, formatPercent, inr, todayIso } from "@/lib/format";

const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

export default function PaymentsPage() {
  const dashboard = useAdminDashboardQuery();
  const [preset, setPreset] = useState<PresetId>("30d");
  const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
  const range = useMemo(
    () => ({ startDate: daysAgoIso(days - 1), endDate: todayIso() }),
    [days],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminAnalyticsQuery(range);

  const totalRevenue = data?.overview.totalRevenue ?? 0;
  const commission = data?.overview.platformCommission ?? 0;
  const payouts = data?.overview.providerPayouts ?? 0;
  // Take rate comes straight from the API (server is the single source of truth).
  const takeRate = (data?.overview.commissionPercentage ?? 0) / 100;

  const topRows = (data?.topServices ?? []).map((s) => [
    s.name,
    formatNumber(s.bookings),
    inr(s.revenue, true),
    inr(s.commission, true),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Razorpay revenue, vendor payouts, platform margin
          </p>
        </div>
        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                preset === p.id
                  ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                  : "border border-[var(--color-biz-line)] hover:bg-[var(--color-biz-elevated)]"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-md border border-[var(--color-biz-line)] p-1.5 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`Revenue (${days}d)`}
          value={isLoading ? "—" : inr(totalRevenue, true)}
          sub={
            dashboard.data
              ? `${inr(dashboard.data.stats.thisMonthRevenue, true)} this month`
              : undefined
          }
          icon={CreditCard}
        />
        <KpiCard
          label="Platform commission"
          value={isLoading ? "—" : inr(commission, true)}
          icon={Wallet}
          accent="green"
        />
        <KpiCard
          label="Provider payouts"
          value={isLoading ? "—" : inr(payouts, true)}
          icon={Wallet}
          accent="amber"
        />
        <KpiCard
          label="Take rate"
          value={isLoading ? "—" : formatPercent(takeRate)}
          icon={CreditCard}
          accent="green"
        />
      </div>

      {isError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Failed to load analytics for the selected period.{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            className="ml-1 underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[var(--color-biz-muted)]" />
          <h2 className="font-semibold">Top revenue services</h2>
          <span className="ml-1 text-xs text-[var(--color-biz-muted)]">
            ({range.startDate} → {range.endDate})
          </span>
        </div>
        <DataTable
          headers={["Service", "Bookings", "Revenue", "Commission"]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          emptyMessage="No completed payments in this period."
          rows={topRows}
        />
        <p className="mt-2 text-[10px] text-[var(--color-biz-muted)]">
          Commission is the actual platform commission recorded on completed bookings for each
          service in this period.
        </p>
      </div>
    </div>
  );
}

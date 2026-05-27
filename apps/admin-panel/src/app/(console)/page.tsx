import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  Wrench,
  CreditCard,
  TrendingUp,
  Shield,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { ADMIN_KPIS, RECENT_BOOKINGS, FRAUD_ALERTS } from "@/lib/admin-data";

function inr(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function BusinessOverviewPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Business overview
        </h1>
        <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
          HOMIGO company command center — all markets, vendors & revenue
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="GMV today" value={inr(ADMIN_KPIS.gmvToday)} icon={TrendingUp} />
        <KpiCard label="Bookings today" value={String(ADMIN_KPIS.bookingsToday)} icon={LayoutDashboard} />
        <KpiCard label="Active vendors" value={String(ADMIN_KPIS.activeVendors)} sub={`${ADMIN_KPIS.onlineVendors} online`} icon={Wrench} />
        <KpiCard label="Customers" value={ADMIN_KPIS.customers.toLocaleString("en-IN")} sub={`+${ADMIN_KPIS.newCustomersToday} today`} icon={Users} />
        <KpiCard label="Margin" value={`${ADMIN_KPIS.revenueMargin}%`} icon={CreditCard} accent="green" />
        <KpiCard label="Fraud flags" value={String(ADMIN_KPIS.fraudFlags)} icon={Shield} accent="red" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Live bookings</h2>
            <Link href="/bookings" className="text-sm text-[var(--color-biz-accent)] hover:underline">
              View all
            </Link>
          </div>
          <DataTable
            headers={["ID", "Customer", "Vendor", "Service", "Amount", "Status"]}
            rows={RECENT_BOOKINGS.map((b) => [
              b.id,
              b.customer,
              b.vendor,
              b.service,
              `₹${b.amount}`,
              <StatusBadge key={b.id} status={b.status} />,
            ])}
          />
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Fraud alerts</h2>
            <Link href="/fraud" className="text-sm text-[var(--color-biz-accent)] hover:underline">
              Review
            </Link>
          </div>
          <ul className="space-y-2">
            {FRAUD_ALERTS.map((a) => (
              <li key={a.id} className="biz-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{a.type}</p>
                  <StatusBadge status={a.severity} />
                </div>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{a.entity}</p>
                <p className="mt-1 text-[10px] text-[var(--color-biz-muted)]">{a.time}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

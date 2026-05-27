import { KpiCard } from "@/components/ui/KpiCard";
import { Users, UserPlus } from "lucide-react";
import { ADMIN_KPIS } from "@/lib/admin-data";

export default function CustomersPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          All users on homigo.com — bookings, refunds, support
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label="Total customers"
          value={ADMIN_KPIS.customers.toLocaleString("en-IN")}
          icon={Users}
        />
        <KpiCard
          label="New today"
          value={String(ADMIN_KPIS.newCustomersToday)}
          icon={UserPlus}
          accent="green"
        />
      </div>
      <p className="biz-card p-6 text-sm text-[var(--color-biz-muted)]">
        Full customer CRM table connects to shared API — demo overview only.
      </p>
    </div>
  );
}

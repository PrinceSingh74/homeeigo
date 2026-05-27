import { KpiCard } from "@/components/ui/KpiCard";
import { CreditCard, Wallet } from "lucide-react";
import { ADMIN_KPIS } from "@/lib/admin-data";

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function PaymentsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Razorpay, vendor payouts, refunds, ledger
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="GMV this week" value={`₹${(ADMIN_KPIS.gmvWeek / 100000).toFixed(1)}L`} icon={CreditCard} />
        <KpiCard label="Pending payouts" value={inr(ADMIN_KPIS.pendingPayouts)} icon={Wallet} accent="amber" />
        <KpiCard label="Platform margin" value={`${ADMIN_KPIS.revenueMargin}%`} icon={CreditCard} accent="green" />
      </div>
    </div>
  );
}

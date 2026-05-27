import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { RECENT_BOOKINGS } from "@/lib/admin-data";

export default function BookingsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bookings</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Assign vendors, cancel, refund — platform-wide
        </p>
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
  );
}

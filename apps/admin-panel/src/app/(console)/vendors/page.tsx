import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { PageShell } from "@/components/ui/PageShell";
import { VENDOR_ROWS } from "@/lib/admin-data";

export default function VendorsPage() {
  return (
    <PageShell title="Vendors" subtitle="Approve, suspend, KYC — all partners on platform">
      <DataTable
        headers={["ID", "Name", "Category", "Rating", "Jobs", "KYC", "Status"]}
        rows={VENDOR_ROWS.map((v) => [
          v.id,
          v.name,
          v.category,
          v.rating.toFixed(2),
          String(v.jobs),
          <StatusBadge key={`kyc-${v.id}`} status={v.kyc} />,
          <StatusBadge key={`st-${v.id}`} status={v.status} />,
        ])}
      />
    </PageShell>
  );
}

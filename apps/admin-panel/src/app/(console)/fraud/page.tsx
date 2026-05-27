import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { FRAUD_ALERTS } from "@/lib/admin-data";

export default function FraudPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fraud detection</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Flags, investigations, blocks
        </p>
      </div>
      <DataTable
        headers={["ID", "Type", "Entity", "Severity", "Time"]}
        rows={FRAUD_ALERTS.map((a) => [
          a.id,
          a.type,
          a.entity,
          <StatusBadge key={a.id} status={a.severity} />,
          a.time,
        ])}
      />
    </div>
  );
}

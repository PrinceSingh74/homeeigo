"use client";

import { useQuery } from "@tanstack/react-query";
import { UserX } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function AccountDeletionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "account-deletions"],
    queryFn: () => adminApi.accountDeletions(),
  });

  const deletions = data?.deletions ?? [];

  const rows = deletions.map((d) => {
    const row = d as Record<string, unknown>;
    let details: Record<string, unknown> = {};
    try {
      details = row.details ? JSON.parse(String(row.details)) : {};
    } catch {
      details = {};
    }
    return [
      String(row.userId ?? "—").slice(0, 10),
      row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : "—",
      details.deletionScheduledAt
        ? new Date(String(details.deletionScheduledAt)).toLocaleDateString()
        : "—",
      String(row.ipAddress ?? "—"),
      String(row.reason ?? "—").slice(0, 40) || "—",
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account deletions</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">Audit trail for scheduled account removals</p>
      </div>

      <KpiCard label="Scheduled deletions" value={String(deletions.length)} icon={UserX} loading={isLoading} />

      <DataTable
        title="Deletion audit log"
        columns={["User", "Requested", "Final delete", "IP", "Reason"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No deletion requests yet"
      />
    </div>
  );
}

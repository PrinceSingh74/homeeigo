"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, RefreshCw } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function FinanceMigrationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "migrations"],
    queryFn: () => adminApi.financeMigrations(),
  });

  const verify = useMutation({
    mutationFn: () => adminApi.verifyMigrations(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "finance", "migrations"] }),
  });

  const latest = data?.latest as Record<string, unknown> | null;
  const report = (latest?.report ?? {}) as Record<string, unknown>;
  const runs = data?.runs ?? [];

  const rows = runs.map((r) => {
    const row = r as Record<string, unknown>;
    return [
      new Date(String(row.createdAt)).toLocaleString(),
      String(row.status ?? "—"),
      String(row.appliedCount ?? 0),
      String(row.pendingCount ?? 0),
      row.driftDetected ? "Yes" : "No",
      row.rollbackRisk ? "Yes" : "No",
    ];
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Migration Readiness</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Production deployment safety checks</p>
        </div>
        <button
          type="button"
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          <RefreshCw className={`h-4 w-4 ${verify.isPending ? "animate-spin" : ""}`} />
          Verify now
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Status" value={String(latest?.status ?? "—")} icon={Database} loading={isLoading} />
        <KpiCard label="Applied" value={String(latest?.appliedCount ?? 0)} icon={Database} loading={isLoading} />
        <KpiCard label="Pending" value={String(latest?.pendingCount ?? 0)} icon={Database} loading={isLoading} />
        <KpiCard label="Drift" value={latest?.driftDetected ? "DETECTED" : "None"} icon={Database} loading={isLoading} />
      </div>

      {Array.isArray(report.issues) && (report.issues as string[]).length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">Issues</p>
          <ul className="mt-2 list-disc pl-5">
            {(report.issues as string[]).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      <DataTable
        title="Verification runs"
        headers={["Run", "Status", "Applied", "Pending", "Drift", "Rollback risk"]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No verification runs yet"
      />
    </div>
  );
}

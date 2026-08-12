"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  RefreshCw,
  Shield,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Pagination } from "@/components/ui/Pagination";
import { adminApi } from "@/services/admin-api";
import { getApiLoadHint, getErrorMessage } from "@/lib/api-error";
import { inr } from "@/lib/format";

const STATUS_MAP: Record<string, string> = {
  MATCHED: "completed",
  SETTLEMENT_PENDING: "pending",
  SETTLEMENT_MISMATCH: "high",
  MISMATCH: "high",
  MISSING_GATEWAY: "medium",
  MISSING_LOCAL: "medium",
  REFUND_MISMATCH: "cancelled",
};

type Row = Record<string, unknown>;

function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const blob = new Blob([headers.join(",") + "\n" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function FinanceReconciliationPage() {
  const qc = useQueryClient();
  const [runPage, setRunPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);
  const [gwPage, setGwPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const perPage = 10;

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["admin", "finance", "reconciliation"],
    queryFn: () => adminApi.financeReconciliation(),
    refetchInterval: 60_000,
  });

  const { data: issuesData, isLoading: issuesLoading } = useQuery({
    queryKey: ["admin", "finance", "reconciliation-issues"],
    queryFn: () => adminApi.financeReconciliationIssues(),
  });

  const { data: gatewayIssues, isLoading: gatewayLoading } = useQuery({
    queryKey: ["admin", "finance", "gateway-issues"],
    queryFn: () => adminApi.financeGatewayReconciliationIssues(),
  });

  const runMutation = useMutation({
    mutationFn: () => adminApi.runFinanceReconciliation(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "finance"] }),
  });

  const gatewayMut = useMutation({
    mutationFn: () => adminApi.runGatewayReconciliation(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "finance"] }),
  });

  const metrics = (data?.metrics ?? {}) as Record<string, number>;
  const runs = useMemo(() => (data?.runs ?? []) as Row[], [data?.runs]);
  const issues = useMemo(() => (issuesData?.issues ?? []) as Row[], [issuesData?.issues]);
  const gwIssues = useMemo(() => (gatewayIssues?.issues ?? []) as Row[], [gatewayIssues?.issues]);

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((i) => {
      const type = String(i.issueType ?? "");
      if (statusFilter !== "all" && type !== statusFilter) return false;
      if (!q) return true;
      return (
        type.toLowerCase().includes(q) ||
        String(i.referenceId ?? "").toLowerCase().includes(q) ||
        String(i.details ?? "").toLowerCase().includes(q)
      );
    });
  }, [issues, search, statusFilter]);

  const runRows = useMemo(
    () =>
      runs.map((r) => [
        new Date(String(r.runDate ?? r.createdAt)).toLocaleString("en-IN"),
        <StatusBadge key={`st-${r.id}`} status={STATUS_MAP[String(r.status)] ?? String(r.status).toLowerCase()} />,
        `${Number(r.matchPct ?? 0).toFixed(1)}%`,
        String(r.mismatchCount ?? 0),
        String((r._count as { issues?: number })?.issues ?? 0),
      ]),
    [runs],
  );

  const issueRows = useMemo(
    () =>
      filteredIssues.map((i) => [
        <StatusBadge key={`t-${i.id}`} status={STATUS_MAP[String(i.issueType)] ?? "pending"} />,
        <span key={`ref-${i.id}`} className="font-mono text-xs text-zinc-300">
          {String(i.referenceId ?? "—").slice(0, 14)}
        </span>,
        i.expectedAmount != null ? inr(Number(i.expectedAmount)) : "—",
        i.actualAmount != null ? inr(Number(i.actualAmount)) : "—",
        <span key={`d-${i.id}`} className="max-w-xs truncate text-zinc-400" title={String(i.details ?? "")}>
          {String(i.details ?? "—")}
        </span>,
      ]),
    [filteredIssues],
  );

  const gwRows = useMemo(
    () =>
      gwIssues.map((i) => [
        <StatusBadge key={`gw-${i.id}`} status={STATUS_MAP[String(i.issueType)] ?? "pending"} />,
        <span key={`gw-ref-${i.id}`} className="font-mono text-xs">{String(i.gatewayReference ?? "—").slice(0, 14)}</span>,
        <span key={`gw-local-${i.id}`} className="font-mono text-xs">{String(i.localReference ?? "—").slice(0, 14)}</span>,
        i.expectedAmount != null ? inr(Number(i.expectedAmount)) : "—",
        i.actualAmount != null ? inr(Number(i.actualAmount)) : "—",
      ]),
    [gwIssues],
  );

  const pagedRuns = runRows.slice((runPage - 1) * perPage, runPage * perPage);
  const pagedIssues = issueRows.slice((issuePage - 1) * perPage, issuePage * perPage);
  const pagedGw = gwRows.slice((gwPage - 1) * perPage, gwPage * perPage);

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800 disabled:opacity-50";

  const loadError = isError ? getErrorMessage(error) : "";
  const loadHint = isError ? getApiLoadHint(error) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">
            Payment Reconciliation
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Ledger · gateway · settlement command center
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => gatewayMut.mutate()} disabled={gatewayMut.isPending} className={btn}>
            Gateway sync
          </button>
          <button type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className={`${btn} border-amber-600/50 bg-amber-500/10 text-amber-300`}>
            <RefreshCw className={`h-4 w-4 ${runMutation.isPending ? "animate-spin" : ""}`} />
            Run local
          </button>
        </div>
      </div>

      {isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="font-medium text-red-300">Could not load reconciliation data</p>
            <p className="mt-1 text-sm text-zinc-300">{loadError}</p>
            {loadHint ? <p className="mt-2 text-sm text-zinc-400">{loadHint}</p> : null}
            <button type="button" onClick={() => void refetch()} className={`${btn} mt-3`}>
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label="Total revenue" value={inr(metrics.totalRevenue ?? 0)} icon={TrendingUp} accent="green" loading={isLoading} />
        <KpiCard label="Matched payments" value={`${metrics.matchedPayments ?? 0}/${metrics.successPayments ?? 0}`} icon={CheckCircle2} accent="green" loading={isLoading} />
        <KpiCard label="Match rate" value={`${Number(metrics.matchPct ?? metrics.avgMatchPct ?? 0).toFixed(1)}%`} icon={BarChart3} accent="amber" loading={isLoading} />
        <KpiCard label="Settlement pending" value={String(metrics.settlementPending ?? 0)} icon={Wallet} loading={isLoading} />
        <KpiCard label="Local issues" value={String(metrics.localIssues ?? issues.length)} icon={AlertTriangle} accent="red" loading={issuesLoading} />
        <KpiCard label="Integrity score" value={isError ? "—" : `${Number(metrics.integrityScore ?? 0).toFixed(0)}/100`} icon={Shield} loading={isLoading} />
      </div>

      <DataTable
        title="Reconciliation runs"
        headers={["Run", "Status", "Match %", "Mismatches", "Issues"]}
        rows={pagedRuns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyMessage="No runs yet"
        footer={
          runs.length > perPage ? (
            <Pagination page={runPage} total={runs.length} limit={perPage} onPageChange={setRunPage} />
          ) : null
        }
      />

      <div className="biz-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-50">Local issues</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setIssuePage(1); }}
              placeholder="Search reference, type…"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setIssuePage(1); }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100"
            >
              <option value="all">All types</option>
              <option value="SETTLEMENT_MISMATCH">Settlement mismatch</option>
              <option value="SETTLEMENT_PENDING">Settlement pending</option>
              <option value="MISMATCH">Amount mismatch</option>
              <option value="MISSING_GATEWAY">Missing gateway</option>
              <option value="REFUND_MISMATCH">Refund mismatch</option>
            </select>
            <button
              type="button"
              className={btn}
              onClick={() =>
                exportCsv(
                  `homigo-local-issues-${new Date().toISOString().slice(0, 10)}.csv`,
                  ["type", "reference", "expected", "actual", "details"],
                  filteredIssues.map((i) => [
                    String(i.issueType ?? ""),
                    String(i.referenceId ?? ""),
                    String(i.expectedAmount ?? ""),
                    String(i.actualAmount ?? ""),
                    `"${String(i.details ?? "").replace(/"/g, '""')}"`,
                  ]),
                )
              }
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
        <DataTable
          headers={["Type", "Reference", "Expected", "Actual", "Details"]}
          rows={pagedIssues}
          isLoading={issuesLoading}
          emptyMessage="No local issues"
          footer={
            filteredIssues.length > perPage ? (
              <Pagination page={issuePage} total={filteredIssues.length} limit={perPage} onPageChange={setIssuePage} />
            ) : null
          }
        />
      </div>

      <DataTable
        title="Gateway issues"
        headers={["Type", "Gateway ref", "Local ref", "Expected", "Actual"]}
        rows={pagedGw}
        isLoading={gatewayLoading}
        emptyMessage="No gateway issues — run gateway sync"
        footer={
          gwIssues.length > perPage ? (
            <Pagination page={gwPage} total={gwIssues.length} limit={perPage} onPageChange={setGwPage} />
          ) : null
        }
      />
    </div>
  );
}

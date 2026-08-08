"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Shield,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";

const RISK_COLORS: Record<string, string> = {
  LOW: "text-emerald-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-400",
};

export default function EnterpriseToolCenterPage() {
  const registry = useQuery({
    queryKey: ["ai-tools-registry"],
    queryFn: () => adminApi.aiTools.registry(),
    staleTime: 60_000,
  });
  const metrics = useQuery({
    queryKey: ["ai-tools-metrics"],
    queryFn: () => adminApi.aiTools.metrics(7),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const approvals = useQuery({
    queryKey: ["ai-tools-approvals"],
    queryFn: () => adminApi.aiTools.approvals(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: ["ai-tools-history"],
    queryFn: () => adminApi.aiTools.history({ limit: 25 }),
    staleTime: 30_000,
  });
  const denied = useQuery({
    queryKey: ["ai-tools-denied"],
    queryFn: () => adminApi.aiTools.denied(20),
    staleTime: 30_000,
  });
  const highRisk = useQuery({
    queryKey: ["ai-tools-high-risk"],
    queryFn: () => adminApi.aiTools.highRisk(20),
    staleTime: 15_000,
  });
  const policies = useQuery({
    queryKey: ["ai-tools-policies"],
    queryFn: () => adminApi.aiTools.policies({ limit: 20 }),
    staleTime: 30_000,
  });

  const tools = (registry.data as { tools?: Array<Record<string, unknown>> })?.tools ?? [];
  const counts = (registry.data as { counts?: Record<string, number> })?.counts ?? {};
  const summary = (metrics.data as { summary?: Record<string, unknown> })?.summary ?? {};
  const approvalList = (approvals.data as { approvals?: Array<Record<string, unknown>> })?.approvals ?? [];
  const approvalStats = (approvals.data as { stats?: Record<string, unknown> })?.stats ?? {};
  const execHistory = history.data ?? [];
  const deniedList = denied.data ?? [];
  const highRiskList = highRisk.data ?? [];
  const policySummary = (policies.data as { summary?: Record<string, unknown> })?.summary ?? {};
  const policyLogs = (policies.data as { logs?: Array<Record<string, unknown>> })?.logs ?? [];

  const refreshAll = () => {
    void registry.refetch();
    void metrics.refetch();
    void approvals.refetch();
    void history.refetch();
    void denied.refetch();
    void highRisk.refetch();
    void policies.refetch();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 biz-page-enter">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="text-cyan-400" size={28} />
            Enterprise Tool Center
          </h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Tool registry, execution history, approval queue, and policy explorer
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          <RefreshCw size={14} className={registry.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Total Tools" value={formatNumber(tools.length)} icon={Wrench} trend={null} />
        <KpiCard label="Read Tools" value={formatNumber(Number(counts.READ ?? 0))} icon={Zap} trend={null} />
        <KpiCard label="Write Tools" value={formatNumber(Number(counts.WRITE ?? 0))} icon={CheckCircle2} trend={null} />
        <KpiCard label="High Risk" value={formatNumber(Number(counts.HIGH_RISK ?? 0))} icon={Shield} trend={null} />
        <KpiCard label="Pending Approvals" value={formatNumber(Number(approvalStats.pending ?? 0))} icon={Clock} trend={null} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Executions (7d)" value={formatNumber(Number(summary.totalRequests ?? 0))} icon={Activity} trend={null} />
        <KpiCard label="Success Rate" value={
          summary.totalRequests
            ? `${Math.round((Number(summary.successCount ?? 0) / Number(summary.totalRequests)) * 100)}%`
            : "—"
        } icon={CheckCircle2} trend={null} />
        <KpiCard label="Denied" value={formatNumber(Number(summary.deniedCount ?? 0))} icon={XCircle} trend={null} />
        <KpiCard label="Avg Latency" value={`${Number(summary.avgLatencyMs ?? 0)}ms`} icon={Clock} trend={null} />
      </div>

      <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
          <Wrench size={18} className="text-cyan-400" /> Tool Registry
        </h2>
        {registry.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-[var(--color-biz-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Tool ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Risk</th>
                  <th className="px-3 py-2 text-left">Service</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {tools.slice(0, 50).map((t) => (
                  <tr key={String(t.toolId)} className="border-t border-white/5">
                    <td className="px-3 py-2 font-mono text-xs">{String(t.toolId)}</td>
                    <td className="px-3 py-2">{String(t.name)}</td>
                    <td className="px-3 py-2">{String(t.category)}</td>
                    <td className={`px-3 py-2 ${RISK_COLORS[String(t.riskLevel)] ?? ""}`}>{String(t.riskLevel)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--color-biz-muted)]">{String(t.serviceMapping)}</td>
                    <td className="px-3 py-2">{String(t.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tools.length > 50 && (
              <p className="mt-2 text-xs text-[var(--color-biz-muted)]">Showing 50 of {tools.length} tools</p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
            <Clock size={18} className="text-amber-400" /> Approval Queue
          </h2>
          {approvalList.length === 0 ? (
            <p className="text-sm text-[var(--color-biz-muted)]">No pending approvals</p>
          ) : (
            <ul className="space-y-2">
              {approvalList.map((a) => (
                <li key={String(a.approvalId)} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <div className="font-medium">{String((a.tool as Record<string, unknown>)?.name ?? a.toolId)}</div>
                  <div className="text-xs text-[var(--color-biz-muted)]">
                    Risk {Number(a.riskScore).toFixed(2)} · Expires {new Date(String(a.expiresAt)).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-400" /> High Risk Queue
          </h2>
          {highRiskList.length === 0 ? (
            <p className="text-sm text-[var(--color-biz-muted)]">No high-risk items pending</p>
          ) : (
            <ul className="space-y-2">
              {highRiskList.map((a) => (
                <li key={String(a.approvalId)} className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm">
                  <div className="font-medium text-red-300">{String(a.toolId)}</div>
                  <div className="text-xs text-[var(--color-biz-muted)]">
                    Requested by {String(a.requestedBy)} · Score {Number(a.riskScore).toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 text-lg font-semibold">Execution History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-[var(--color-biz-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Execution</th>
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-left">Started</th>
              </tr>
            </thead>
            <tbody>
              {(execHistory as Array<Record<string, unknown>>).map((e) => (
                <tr key={String(e.executionId)} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono text-xs">{String(e.executionId).slice(0, 8)}…</td>
                  <td className="px-3 py-2">{String((e.tool as Record<string, unknown>)?.name ?? e.toolId)}</td>
                  <td className="px-3 py-2">{String(e.status)}</td>
                  <td className="px-3 py-2">{e.durationMs != null ? `${e.durationMs}ms` : "—"}</td>
                  <td className="px-3 py-2 text-xs">{new Date(String(e.startedAt)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
            <XCircle size={18} className="text-orange-400" /> Denied Requests
          </h2>
          {(deniedList as Array<Record<string, unknown>>).length === 0 ? (
            <p className="text-sm text-[var(--color-biz-muted)]">No denied requests</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(deniedList as Array<Record<string, unknown>>).map((d) => (
                <li key={String(d.executionId)} className="rounded bg-white/5 px-2 py-1">
                  {String((d.tool as Record<string, unknown>)?.name ?? d.toolId)} — {String(d.errorMessage ?? d.status)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 text-lg font-semibold flex items-center gap-2">
            <Shield size={18} className="text-cyan-400" /> Policy Explorer
          </h2>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded bg-emerald-500/10 px-2 py-1">Allow: {Number(policySummary.allow ?? 0)}</div>
            <div className="rounded bg-red-500/10 px-2 py-1">Deny: {Number(policySummary.deny ?? 0)}</div>
            <div className="rounded bg-amber-500/10 px-2 py-1">Approval: {Number(policySummary.requiresApproval ?? 0)}</div>
          </div>
          <ul className="space-y-1 text-xs">
            {policyLogs.map((log) => (
              <li key={String(log.id)} className="rounded bg-white/5 px-2 py-1">
                {String(log.toolId)} → {String(log.decision)} ({String(log.ruleMatched ?? "—")})
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="text-xs text-[var(--color-biz-muted)]">
        Phase 5 Enterprise Tool Layer · Routes via{" "}
        <Link href="/ai-brain" className="text-cyan-400 hover:underline">AI Brain Console</Link>
      </footer>
    </div>
  );
}

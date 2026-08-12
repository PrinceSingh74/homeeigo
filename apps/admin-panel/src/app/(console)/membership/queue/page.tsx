"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { adminApi } from "@/services/admin-api";

export default function MembershipQueuePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "membership", "queue"],
    queryFn: () => adminApi.subscriptions.queueAnalytics(),
  });
  const payload = data as {
    queue?: Record<string, unknown>;
    priority?: Record<string, unknown>;
    assignmentQueue?: Array<Record<string, unknown>>;
    dispatch?: {
      queueHealth?: Record<string, unknown>;
      dispatchMetrics?: Record<string, unknown>;
      assignmentFunnel?: Record<string, unknown>;
    };
  } | undefined;
  const q = payload?.queue ?? {};
  const dispatch = payload?.dispatch;
  const rows = (payload?.assignmentQueue ?? []).map((b) => [
    String(b.bookingNumber ?? "—"),
    String(b.priorityScore ?? "—"),
    String(b.queuePosition ?? "—"),
    b.estimatedWaitTimeMs ? `${Math.round(Number(b.estimatedWaitTimeMs) / 60000)}m` : "—",
    String(b.service ?? "—"),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold">Priority Queue</h1>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Pending HIGH" value={String(q.pendingHigh ?? 0)} icon={Clock} loading={isLoading} />
        <KpiCard label="Pending NORMAL" value={String(q.pendingNormal ?? 0)} icon={Clock} loading={isLoading} />
        <KpiCard label="Avg wait (ms)" value={String(q.averageWaitTimeMs ?? 0)} icon={Clock} loading={isLoading} />
        <KpiCard label="Dispatch attempts" value={String(dispatch?.dispatchMetrics?.dispatchAttempts ?? 0)} icon={Clock} loading={isLoading} />
        <KpiCard label="Acceptance %" value={String(dispatch?.dispatchMetrics?.acceptanceRatePct ?? 0)} icon={Clock} loading={isLoading} />
        <KpiCard label="Auto reassigns" value={String(dispatch?.dispatchMetrics?.autoReassignCount ?? 0)} icon={Clock} loading={isLoading} />
      </div>
      <DataTable headers={["Booking", "Score", "Position", "ETA", "Service"]} rows={rows} isLoading={isLoading} />
    </div>
  );
}

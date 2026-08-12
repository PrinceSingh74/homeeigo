"use client";

import { useQuery } from "@tanstack/react-query";
import { Mail, RefreshCw } from "lucide-react";
import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";

export default function EmailHealthPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "observability", "email-health"],
    queryFn: () => adminApi.observability.emailHealth(),
    refetchInterval: 30_000,
  });

  const delivery = data?.delivery as Record<string, number> | undefined;
  const recent = (data?.recent as Array<Record<string, string>>) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Email Health Dashboard</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">
            Resend delivery, audit trail, circuit breaker, and bounce suppression
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/observability" className="rounded-lg border border-[var(--color-biz-line)] px-4 py-2 text-sm font-semibold">
            Back to observability
          </Link>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Provider"
          value={data?.configured ? String(data.provider) : "not configured"}
          icon={Mail}
          loading={isLoading}
          accent={data?.configured ? "green" : "red"}
        />
        <KpiCard label="Sent (24h)" value={String(delivery?.last24h ?? "—")} loading={isLoading} accent="green" />
        <KpiCard label="Failed total" value={String(delivery?.failed ?? "—")} loading={isLoading} accent="amber" />
        <KpiCard
          label="Circuit breaker"
          value={(data?.circuitBreaker as { state?: string })?.state ?? "—"}
          loading={isLoading}
          accent={(data?.circuitBreaker as { open?: boolean })?.open ? "red" : "green"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 font-semibold">Delivery infrastructure</h2>
          <ul className="space-y-2 text-sm">
            <li>Queue: {(data?.delivery as { queue?: string })?.queue ?? "—"}</li>
            <li>Retry: {(data?.delivery as { retryPolicy?: string })?.retryPolicy ?? "—"}</li>
            <li>Bounce handling: Redis suppression + Resend webhook</li>
            <li>Total audit logs: {delivery?.total ?? "—"}</li>
            <li>Queued: {delivery?.queued ?? 0} · Bounced: {delivery?.bounced ?? 0}</li>
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
          <h2 className="mb-3 font-semibold">Wired templates</h2>
          <p className="text-sm text-[var(--color-biz-muted)]">
            {((data?.templates as { wired?: string[] })?.wired ?? []).join(", ") || "—"}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-biz-line)] p-4">
        <h2 className="mb-3 font-semibold">Recent delivery log</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">To</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-biz-line)]/50">
                  <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4">{row.emailType}</td>
                  <td className="py-2 pr-4">{row.to}</td>
                  <td className="py-2">
                    <span
                      className={
                        row.status === "sent"
                          ? "text-green-600"
                          : row.status === "failed"
                            ? "text-red-600"
                            : "text-amber-600"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!recent.length && !isLoading && (
                <tr>
                  <td colSpan={4} className="py-4 text-[var(--color-biz-muted)]">
                    No email logs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

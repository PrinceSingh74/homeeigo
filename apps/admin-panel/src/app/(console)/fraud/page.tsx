"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, ShieldAlert, Snowflake } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { adminApi } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";

export default function FraudPage() {
  const qc = useQueryClient();
  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin", "fraud", "overview"],
    queryFn: () => adminApi.fraud.overview(),
  });
  const { data: highRisk } = useQuery({
    queryKey: ["admin", "fraud", "high-risk"],
    queryFn: () => adminApi.fraud.highRiskUsers(),
  });
  const { data: queue } = useQuery({
    queryKey: ["admin", "fraud", "review-queue"],
    queryFn: () => adminApi.fraud.reviewQueue({ limit: 20 }),
  });
  const { data: alerts } = useQuery({
    queryKey: ["admin", "fraud", "alerts"],
    queryFn: () => adminApi.fraud.alerts({ limit: 20, status: "open" }),
  });

  const [actionError, setActionError] = useState<string | null>(null);

  const approveMut = useMutation({
    mutationFn: (id: string) => adminApi.fraud.approveCommission(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "fraud"] }),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.fraud.rejectCommission(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "fraud"] }),
  });
  const freezeMut = useMutation({
    mutationFn: (id: string) => adminApi.fraud.freezeCommission(id, "Manual freeze"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "fraud"] }),
  });
  const blacklistMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi.fraud.blacklistUser(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "fraud"] }),
  });

  const o = overview as Record<string, unknown> | undefined;

  const riskRows = (highRisk ?? []).map((u) => [
    u.name,
    u.email,
    <StatusBadge key={`l-${u.userId}`} status={u.level} />,
    String(u.score),
    (u.factors ?? []).slice(0, 2).join(", ") || "—",
    u.isBanned ? "Yes" : "No",
    <button
      key={`b-${u.userId}`}
      type="button"
      disabled={u.isBanned || blacklistMut.isPending}
      onClick={() => {
        setActionError(null);
        blacklistMut.mutate({ id: u.userId, reason: "Fraud review — high risk score" });
      }}
      className="text-xs font-medium text-red-500"
    >
      Blacklist
    </button>,
  ]);

  const queueRows = (queue?.commissions ?? []).map((c) => [
    c.referrer,
    inr(c.amount),
    <StatusBadge key={`s-${c.id}`} status={c.status} />,
    c.riskScore ?? "—",
    <div key={`a-${c.id}`} className="flex gap-2">
      <button
        type="button"
        className="text-xs text-green-600"
        onClick={() => approveMut.mutate(c.id)}
      >
        Approve
      </button>
      <button
        type="button"
        className="text-xs text-amber-600"
        onClick={() => freezeMut.mutate(c.id)}
      >
        Freeze
      </button>
      <button
        type="button"
        className="text-xs text-red-500"
        onClick={() => rejectMut.mutate({ id: c.id, reason: "Fraud review rejected" })}
      >
        Reject
      </button>
    </div>,
  ]);

  const alertRows = (alerts?.alerts ?? []).map((a) => [
    a.category,
    a.title,
    a.user ?? "—",
    <StatusBadge key={`sev-${a.id}`} status={a.severity} />,
    <StatusBadge key={`st-${a.id}`} status={a.status} />,
    new Date(a.createdAt).toLocaleString("en-IN"),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fraud Intelligence</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Enterprise referral fraud engine — risk scores, frozen commissions, review queue
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fraud rate"
          value={`${o?.fraudRatePct ?? 0}%`}
          icon={AlertTriangle}
          accent="red"
          loading={isLoading}
        />
        <KpiCard
          label="Frozen commissions"
          value={formatNumber((o?.frozenCommissions as number) ?? 0)}
          icon={Snowflake}
          accent="amber"
          loading={isLoading}
        />
        <KpiCard
          label="High-risk users"
          value={formatNumber((o?.highRiskUsers as number) ?? 0)}
          icon={ShieldAlert}
          accent="amber"
          loading={isLoading}
        />
        <KpiCard
          label="Loss prevented"
          value={inr((o?.commissionLossPrevented as number) ?? 0)}
          icon={Ban}
          accent="green"
          loading={isLoading}
        />
      </div>

      {actionError && <p className="text-sm text-red-500">{actionError}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold">Manual review queue</h2>
        <DataTable
          headers={["Referrer", "Amount", "Status", "Risk", "Actions"]}
          emptyMessage="No commissions pending review"
          rows={queueRows}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">High-risk users</h2>
        <DataTable
          headers={["Name", "Email", "Level", "Score", "Factors", "Banned", ""]}
          emptyMessage="No high-risk users detected"
          rows={riskRows}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Open fraud alerts</h2>
        <DataTable
          headers={["Category", "Title", "User", "Severity", "Status", "Created"]}
          emptyMessage="No open alerts"
          rows={alertRows}
        />
      </section>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";
import { Crown, IndianRupee, Pencil, Plus, TrendingUp, Users, X } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import {
  useAdminPlansQuery,
  useAdminRevenueQuery,
  useAdminSubscribersQuery,
  useCreatePlanMutation,
  useUpdatePlanMutation,
} from "@/hooks/use-admin-data";
import type { AdminPlanRow } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

const INTERVALS = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;

type FormState = {
  name: string;
  interval: (typeof INTERVALS)[number];
  price: string;
  description: string;
  benefits: string;
  isActive: boolean;
};

function PlanFormModal({
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  initial?: AdminPlanRow;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (s: FormState) => void;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    name: initial?.name ?? "",
    interval: initial?.interval ?? "MONTHLY",
    price: initial ? String(initial.price) : "",
    description: initial?.description ?? "",
    benefits: (initial?.benefits ?? []).map((b) => b.label).join("\n"),
    isActive: initial?.isActive ?? true,
  }));
  const valid = form.name.trim().length >= 2 && Number(form.price) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[var(--color-biz-surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? "Edit plan" : "New plan"}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Plan name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-[var(--color-biz-muted)]">
              Interval
              <select
                value={form.interval}
                disabled={!!initial}
                onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value as FormState["interval"] }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm disabled:opacity-60"
              >
                {INTERVALS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-[var(--color-biz-muted)]">
              Price (₹)
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/[^\d]/g, "") }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Description
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-[var(--color-biz-muted)]">
            Benefits (one per line)
            <textarea
              value={form.benefits}
              rows={4}
              onChange={(e) => setForm((f) => ({ ...f, benefits: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          {initial && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active (visible to customers)
            </label>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="button"
            disabled={!valid || saving}
            onClick={() => onSubmit(form)}
            className="mt-1 rounded-lg bg-[var(--color-biz-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Create plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MembershipPage() {
  const { data: analytics } = useQuery({
    queryKey: ["admin", "membership", "analytics"],
    queryFn: () => adminApi.subscriptions.analytics(),
  });
  const a = analytics as {
    mrr?: number;
    arr?: number;
    churnRatePct?: number;
    retentionRatePct?: number;
    avgLtv?: number;
  } | undefined;

  const { data: revenue } = useAdminRevenueQuery();
  const { data: plans, isLoading, isFetching, isError, refetch } = useAdminPlansQuery();
  const { data: subs } = useAdminSubscribersQuery({ page: 1, limit: 20 });
  const createMut = useCreatePlanMutation();
  const updateMut = useUpdatePlanMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlanRow | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  const planRows = useMemo(
    () =>
      (plans ?? []).map((p) => [
        p.name,
        p.interval,
        inr(p.price),
        `${p.benefits.length} benefits`,
        formatNumber(p._count?.subscriptions ?? 0),
        <StatusBadge key="s" status={p.isActive ? "active" : "inactive"} />,
        <button
          key="e"
          type="button"
          onClick={() => {
            setEditing(p);
            setFormError(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1.5 text-xs font-medium hover:bg-black/5"
        >
          <Pencil size={13} /> Edit
        </button>,
      ]),
    [plans],
  );

  const subRows = useMemo(
    () =>
      (subs?.subscribers ?? []).map((s) => [
        `${s.user.firstName ?? ""} ${s.user.lastName ?? ""}`.trim() || s.user.email,
        s.plan.name,
        <StatusBadge key="st" status={s.cancelledAt ? "cancelled" : s.status.toLowerCase()} />,
        s.expiresAt ? new Date(s.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—",
      ]),
    [subs],
  );

  const submitForm = async (s: FormState) => {
    setFormError(null);
    try {
      const benefits = s.benefits.split("\n").map((b) => b.trim()).filter(Boolean);
      if (editing) {
        await updateMut.mutateAsync({
          id: editing.id,
          body: { name: s.name, price: Number(s.price), description: s.description, benefits, isActive: s.isActive },
        });
      } else {
        await createMut.mutateAsync({
          name: s.name,
          interval: s.interval,
          price: Number(s.price),
          description: s.description,
          benefits,
        });
      }
      setFormOpen(false);
      setEditing(undefined);
    } catch (e) {
      setFormError(getErrorMessage(e));
    }
  };

  return (
    <PageShell title="Membership" subtitle="Plans, subscribers & subscription revenue">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="MRR" value={inr(a?.mrr ?? 0)} icon={TrendingUp} />
        <KpiCard label="ARR" value={inr(a?.arr ?? 0)} icon={IndianRupee} />
        <KpiCard label="Churn" value={`${a?.churnRatePct ?? 0}%`} icon={Users} />
        <KpiCard label="Avg LTV" value={inr(a?.avgLtv ?? 0)} icon={Crown} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total revenue" value={inr(revenue?.totalRevenue ?? 0)} icon={IndianRupee} />
        <KpiCard label="This month" value={inr(revenue?.monthRevenue ?? 0)} icon={TrendingUp} />
        <KpiCard label="Active subscribers" value={formatNumber(revenue?.activeSubscribers ?? 0)} icon={Crown} />
        <KpiCard label="Retention" value={`${a?.retentionRatePct ?? 0}%`} icon={Users} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-base font-semibold">Plans</h2>
        <button
          type="button"
          onClick={() => {
            setEditing(undefined);
            setFormError(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-biz-primary)] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={15} /> New plan
        </button>
      </div>
      <div className="mt-3">
        <DataTable
          headers={["Plan", "Interval", "Price", "Benefits", "Subscribers", "Status", ""]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No plans yet. Create your first one."
          rows={planRows}
        />
      </div>

      <h2 className="mt-8 text-base font-semibold">Subscribers</h2>
      <div className="mt-3">
        <DataTable
          headers={["Customer", "Plan", "Status", "Expires"]}
          emptyMessage="No subscribers yet."
          rows={subRows}
        />
      </div>

      {formOpen && (
        <PlanFormModal
          initial={editing}
          saving={createMut.isPending || updateMut.isPending}
          error={formError}
          onClose={() => {
            setFormOpen(false);
            setEditing(undefined);
          }}
          onSubmit={submitForm}
        />
      )}
    </PageShell>
  );
}

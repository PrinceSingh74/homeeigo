"use client";

import { useState } from "react";
import { Plus, Gift, TrendingUp, IndianRupee } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { adminApi, type AdminCampaignInput } from "@/services/admin-api";
import { inr } from "@/lib/format";

export default function CampaignsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "campaigns"],
    queryFn: () => adminApi.campaigns.list({ limit: 50 }),
  });
  const { data: analytics } = useQuery({
    queryKey: ["admin", "campaigns", "analytics"],
    queryFn: () => adminApi.campaigns.analytics(),
  });

  const [form, setForm] = useState<AdminCampaignInput>({
    code: "",
    name: "",
    type: "COUPON",
    status: "ACTIVE",
    premiumOnly: true,
    discountPct: 10,
  });

  const createMut = useMutation({
    mutationFn: () => adminApi.campaigns.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "campaigns"] });
      setForm({ code: "", name: "", type: "COUPON", status: "ACTIVE", premiumOnly: true, discountPct: 10 });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      adminApi.campaigns.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "campaigns"] }),
  });

  const rows = (data?.campaigns ?? []).map((c) => [
    c.code,
    c.name,
    c.type,
    c.premiumOnly ? "Premium" : "All",
    c.discountPct ? `${c.discountPct}%` : c.discountAmount ? inr(c.discountAmount) : "—",
    `${c.redemptionCount}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}`,
    <StatusBadge key="s" status={c.status} />,
    <button
      key="t"
      type="button"
      className="text-xs font-medium text-[var(--color-biz-accent)]"
      onClick={() =>
        toggleMut.mutate({ id: c.id, status: c.status === "active" ? "DISABLED" : "ACTIVE" })
      }
    >
      {c.status === "active" ? "Disable" : "Enable"}
    </button>,
  ]);

  return (
    <PageShell title="Premium Campaigns" subtitle="Create and manage premium-only coupon campaigns">
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Redemptions" value={String((analytics as { totalRedemptions?: number })?.totalRedemptions ?? 0)} icon={Gift} />
        <KpiCard label="Discount given" value={inr((analytics as { totalDiscountGiven?: number })?.totalDiscountGiven ?? 0)} icon={TrendingUp} />
        <KpiCard label="Revenue after" value={inr((analytics as { revenueAfter?: number })?.revenueAfter ?? 0)} icon={IndianRupee} />
      </div>

      <div className="mb-6 rounded-2xl border border-[var(--color-biz-line)] p-4">
        <p className="mb-3 text-sm font-semibold">Create campaign</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Discount %"
            value={form.discountPct ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, discountPct: Number(e.target.value) }))}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!form.code || !form.name || createMut.isPending}
            onClick={() => createMut.mutate()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus size={16} /> Create
          </button>
        </div>
      </div>

      <DataTable
        title="Campaigns"
        headers={["Code", "Name", "Type", "Audience", "Discount", "Redemptions", "Status", ""]}
        rows={rows}
        loading={isLoading}
        emptyMessage="No campaigns yet"
      />
    </PageShell>
  );
}

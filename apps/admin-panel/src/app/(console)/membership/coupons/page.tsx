"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Download } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { adminApi } from "@/services/admin-api";
import { useAdminStore } from "@/stores/admin-store";
import { resolveApiBase } from "@/lib/api-base";

export default function MembershipCouponsPage() {
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", discountPct: 10, planRestricted: ["gold", "platinum"] as string[] });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "membership", "coupons"],
    queryFn: () => adminApi.membershipCoupons.list(),
  });
  const { data: analytics } = useQuery({
    queryKey: ["admin", "membership", "coupons", "analytics"],
    queryFn: () => adminApi.membershipCoupons.analytics(),
  });
  const createMut = useMutation({
    mutationFn: () => adminApi.membershipCoupons.create({ ...form, status: "ACTIVE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "membership", "coupons"] });
      setForm({ code: "", name: "", discountPct: 10, planRestricted: ["gold", "platinum"] });
    },
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "PAUSED" }) =>
      adminApi.membershipCoupons.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "membership", "coupons"] }),
  });

  const rows = (data?.coupons ?? []).map((c) => [
    c.code,
    c.name,
    c.status,
    `${c.discountPct ?? 0}%`,
    String(c.redemptionCount),
    c.planRestricted.join(", ") || "All",
    <button
      key={c.id}
      type="button"
      className="text-xs font-semibold text-[var(--color-biz-accent)]"
      onClick={() => toggleMut.mutate({ id: c.id, status: c.status === "ACTIVE" ? "PAUSED" : "ACTIVE" })}
    >
      {c.status === "ACTIVE" ? "Pause" : "Resume"}
    </button>,
  ]);

  const a = analytics as Record<string, unknown> | undefined;
  const rev = a?.revenueImpact as Record<string, number> | undefined;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const base = resolveApiBase();
      const token = useAdminStore.getState().accessToken;
      const url = `${base.replace(/\/$/, "")}/api/admin/membership/coupons/export`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) return;
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `homigo-coupons-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold">Membership Coupons</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Issued" value={String(a?.issued ?? 0)} icon={Gift} loading={isLoading} />
        <KpiCard label="Redeemed" value={String(a?.redeemed ?? 0)} icon={Gift} loading={isLoading} />
        <KpiCard label="Conversion %" value={String(a?.conversionPct ?? 0)} icon={Gift} loading={isLoading} />
        <KpiCard label="Discount given" value={`₹${rev?.discountGiven ?? 0}`} icon={Gift} loading={isLoading} />
      </div>
      <form
        className="biz-card flex flex-wrap gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        <input
          placeholder="Code (e.g. GOLD20)"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          className="rounded border px-3 py-2 text-sm"
          required
        />
        <input
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border px-3 py-2 text-sm"
          required
        />
        <input
          type="number"
          placeholder="Discount %"
          value={form.discountPct}
          onChange={(e) => setForm({ ...form, discountPct: Number(e.target.value) })}
          className="w-24 rounded border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white">
          Create
        </button>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded border px-4 py-2 text-sm disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </form>
      <DataTable
        headers={["Code", "Name", "Status", "Discount", "Redemptions", "Plans", "Actions"]}
        rows={rows}
        isLoading={isLoading}
      />
    </div>
  );
}

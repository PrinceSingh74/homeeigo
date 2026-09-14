"use client";

import { useState } from "react";
import { IndianRupee, Megaphone, Percent, Plus, Sparkles, TicketPercent } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { adminApi, type AdminCampaignInput } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

const EMPTY_FORM: AdminCampaignInput = {
  code: "",
  name: "",
  type: "COUPON",
  status: "ACTIVE",
  premiumOnly: true,
  discountPct: 10,
};

export default function CampaignsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "campaigns"],
    queryFn: () => adminApi.campaigns.list({ limit: 50 }),
  });
  const { data: analytics } = useQuery({
    queryKey: ["admin", "campaigns", "analytics"],
    queryFn: () => adminApi.campaigns.analytics(),
  });

  const [form, setForm] = useState<AdminCampaignInput>(EMPTY_FORM);

  const createMut = useMutation({
    mutationFn: () => adminApi.campaigns.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "campaigns"] });
      setForm(EMPTY_FORM);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      adminApi.campaigns.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "campaigns"] }),
  });

  const stats = analytics as { totalRedemptions?: number; totalDiscountGiven?: number; revenueAfter?: number } | undefined;

  const rows = (data?.campaigns ?? []).map((c) => [
    <span key="c" className="font-mono text-xs font-semibold tracking-wide">
      {c.code}
    </span>,
    c.name,
    c.type.replace(/_/g, " "),
    c.premiumOnly ? "Premium members" : "All customers",
    c.discountPct ? `${c.discountPct}%` : c.discountAmount ? inr(c.discountAmount) : "—",
    `${c.redemptionCount}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}`,
    <StatusBadge key="s" status={c.status} />,
    <button
      key="t"
      type="button"
      className="biz-btn px-2.5 py-1 text-xs"
      disabled={toggleMut.isPending}
      onClick={() =>
        toggleMut.mutate({ id: c.id, status: c.status === "active" ? "DISABLED" : "ACTIVE" })
      }
    >
      {c.status === "active" ? "Disable" : "Enable"}
    </button>,
  ]);

  return (
    <GrowthPage
      icon={Megaphone}
      title="Campaigns"
      subtitle="Create and control coupon campaigns. Premium-only offers apply to members; toggling disable stops new redemptions immediately."
    >
      <div className="grid gap-3.5 sm:grid-cols-3">
        <KpiCard
          label="Redemptions"
          value={formatNumber(stats?.totalRedemptions ?? 0)}
          sub="Times a campaign was used"
          icon={TicketPercent}
        />
        <KpiCard
          label="Discount given"
          value={inr(stats?.totalDiscountGiven ?? 0)}
          sub="Value customers saved"
          icon={Percent}
          accent="amber"
        />
        <KpiCard
          label="Revenue after discount"
          value={inr(stats?.revenueAfter ?? 0)}
          sub="Collected after campaign"
          icon={IndianRupee}
          accent="green"
        />
      </div>

      <Panel
        title="Create campaign"
        hint="Code is what customers type at checkout. Changes apply to new redemptions only."
        icon={Sparkles}
        iconTone="success"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Code" hint="Uppercase, unique">
            <input
              className="biz-input"
              placeholder="WELCOME10"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Name">
            <input
              className="biz-input"
              placeholder="Welcome offer"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Type">
            <select
              className="biz-select"
              value={form.type}
              onChange={(e) =>
                setForm((f) => ({ ...f, type: e.target.value as AdminCampaignInput["type"] }))
              }
            >
              <option value="COUPON">Coupon</option>
              <option value="PROMOTION">Promotion</option>
              <option value="BUNDLE">Bundle</option>
              <option value="OFFER">Offer</option>
            </select>
          </Field>
          <Field label="Discount %">
            <input
              type="number"
              min={1}
              max={90}
              className="biz-input"
              value={form.discountPct ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, discountPct: Number(e.target.value) }))}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-biz-muted)]">
              <input
                type="checkbox"
                checked={form.premiumOnly ?? true}
                onChange={(e) => setForm((f) => ({ ...f, premiumOnly: e.target.checked }))}
              />
              Premium members only
            </label>
            <button
              type="button"
              disabled={!form.code || !form.name || createMut.isPending}
              onClick={() => createMut.mutate()}
              className="biz-btn biz-btn-primary justify-center"
            >
              <Plus size={16} /> Create
            </button>
          </div>
        </div>
        {createMut.isError ? (
          <p className="mt-3 text-xs text-[var(--color-biz-danger)]">{getErrorMessage(createMut.error)}</p>
        ) : null}
      </Panel>

      <DataTable
        title="Live campaigns"
        hint="Enable or disable without deleting history"
        icon={Megaphone}
        headers={["Code", "Name", "Type", "Audience", "Discount", "Redemptions", "Status", "Action"]}
        rows={rows}
        loading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyMessage="No campaigns yet"
        emptyDescription="Create a coupon above. It will show here with redemptions and status."
      />
    </GrowthPage>
  );
}

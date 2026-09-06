"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { GlassKPI } from "@/components/acquisition/GlassKPI";
import { adminApi, type PartnerLeadSource } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

const RANGES = ["7d", "30d", "90d"] as const;
const SOURCES: PartnerLeadSource[] = [
  "APNA",
  "JOBHAI",
  "REFERRAL",
  "RWA",
  "CONTRACTOR",
  "LOCAL_SHOP",
  "DIRECT",
  "SOCIAL",
  "CAMPAIGN",
  "PARTNER_REFERRAL",
];

export default function PartnerAcquisitionAnalyticsPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const dashboard = useQuery({
    queryKey: ["admin", "partner-acquisition", "dashboard", range],
    queryFn: () => adminApi.partnerAcquisition.dashboard(range),
  });
  const spend = useQuery({
    queryKey: ["admin", "partner-acquisition", "spend"],
    queryFn: () => adminApi.partnerAcquisition.listSpend(),
  });

  const [form, setForm] = useState({
    source: "REFERRAL" as PartnerLeadSource,
    campaign: "",
    periodStart: "",
    periodEnd: "",
    amount: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      adminApi.partnerAcquisition.createSpend({
        source: form.source,
        campaign: form.campaign || undefined,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        amount: Number(form.amount),
        notes: form.notes || undefined,
      }),
    onSuccess: async () => {
      setError(null);
      setForm((f) => ({ ...f, amount: "", notes: "", campaign: "" }));
      await qc.invalidateQueries({ queryKey: ["admin", "partner-acquisition"] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.partnerAcquisition.deleteSpend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "partner-acquisition"] }),
  });

  const cost = dashboard.data?.cost;
  const sources = dashboard.data?.sources ?? [];

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Acquisition analytics"
        subtitle="Cost attribution uses recorded spend only. Metrics stay empty until spend is entered — never fabricated."
        action={
          <div className="flex rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase ${range === r ? "bg-[var(--color-biz-accent)] text-[#05070d]" : "text-[var(--color-biz-text)]"}`}
              >
                {r}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <GlassKPI label="Spend" value={cost?.available && cost.spend != null ? `₹${formatNumber(cost.spend)}` : "Unavailable"} />
        <GlassKPI label="CPL" value={cost?.cpl != null ? `₹${formatNumber(cost.cpl)}` : "—"} />
        <GlassKPI label="Cost / application" value={cost?.costPerApplication != null ? `₹${formatNumber(cost.costPerApplication)}` : "—"} />
        <GlassKPI label="Cost / activation" value={cost?.costPerActivation != null ? `₹${formatNumber(cost.costPerActivation)}` : "—"} />
        <GlassKPI label="Activation rate" value={`${cost?.activationRate ?? 0}%`} />
      </div>
      {cost && !cost.available ? (
        <p className="rounded-xl bg-[var(--color-biz-elevated)] px-4 py-3 text-sm text-[var(--color-biz-muted)]">{cost.note}</p>
      ) : null}

      <GlassPanel className="p-6">
        <h3 className="text-sm font-semibold">Source funnel</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs uppercase text-[var(--color-biz-muted)]">
              <tr>
                <th className="py-2">Source</th>
                <th>Leads</th>
                <th>Applications</th>
                <th>Activated</th>
                <th>App rate</th>
                <th>Act rate</th>
                <th>CPL</th>
                <th>Cost / activated</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source} className="border-t border-[var(--color-biz-line)]">
                  <td className="py-2 font-semibold">{s.source}</td>
                  <td>{s.leads}</td>
                  <td>{s.applications}</td>
                  <td>{s.activated}</td>
                  <td>{s.applicationRate ?? 0}%</td>
                  <td>{s.activationRate}%</td>
                  <td>{s.spend != null && s.leads ? `₹${Math.round(s.spend / s.leads)}` : "—"}</td>
                  <td>{s.costPerActivation != null ? `₹${s.costPerActivation}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel className="p-6">
        <h3 className="text-sm font-semibold">Record acquisition spend</h3>
        <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
          Admin-only. Enter actual channel spend for a period. Analytics will derive CPL and cost per activation.
        </p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Source</span>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value as PartnerLeadSource })}
              className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2"
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Campaign</span>
            <input value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Amount (INR)</span>
            <input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Period start</span>
            <input type="date" required value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Period end</span>
            <input type="date" required value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2" />
          </label>
          <label className="text-sm sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase text-[var(--color-biz-muted)]">Notes</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2" />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={create.isPending} className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-[#05070d] disabled:opacity-50">
              {create.isPending ? "Saving…" : "Save spend"}
            </button>
          </div>
        </form>
        {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase text-[var(--color-biz-muted)]">
              <tr>
                <th className="py-2">Source</th>
                <th>Campaign</th>
                <th>Period</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(spend.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-biz-line)]">
                  <td className="py-2">{row.source}</td>
                  <td>{row.campaign ?? "—"}</td>
                  <td>
                    {row.periodStart.slice(0, 10)} → {row.periodEnd.slice(0, 10)}
                  </td>
                  <td>
                    {row.currency} {row.amount}
                  </td>
                  <td>
                    <button type="button" className="text-xs font-semibold text-rose-700" onClick={() => remove.mutate(row.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(spend.data ?? []).length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-biz-muted)]">No spend recorded yet. Cost metrics remain unavailable until you add a period.</p>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

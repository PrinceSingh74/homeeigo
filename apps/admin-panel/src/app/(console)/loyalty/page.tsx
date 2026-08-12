"use client";

import { useState } from "react";
import { Coins, IndianRupee, Users, TrendingDown } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import {
  useAdminHCoinAnalyticsQuery,
  useGrantHCoinMutation,
  useUpdateHCoinRuleMutation,
} from "@/hooks/use-admin-data";
import type { HCoinRule } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

function RuleRow({ rule }: { rule: HCoinRule }) {
  const update = useUpdateHCoinRuleMutation();
  const [coins, setCoins] = useState(String(rule.coins));
  const dirty = coins !== String(rule.coins);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--color-biz-line)] p-3">
      <div className="flex-1">
        <p className="text-sm font-semibold">{rule.label}</p>
        <p className="text-xs text-[var(--color-biz-muted)]">{rule.event}</p>
      </div>
      <input
        type="number"
        value={coins}
        onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ""))}
        className="w-20 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2 py-1.5 text-sm"
      />
      <span className="text-xs text-[var(--color-biz-muted)]">coins</span>
      <button
        type="button"
        disabled={!dirty || update.isPending}
        onClick={() => update.mutate({ id: rule.id, body: { coins: Number(coins) } })}
        className="rounded-lg bg-[var(--color-biz-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => update.mutate({ id: rule.id, body: { isActive: !rule.isActive } })}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${rule.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"}`}
      >
        {rule.isActive ? "Active" : "Off"}
      </button>
    </div>
  );
}

export default function LoyaltyPage() {
  const { data } = useAdminHCoinAnalyticsQuery();
  const grant = useGrantHCoinMutation();
  const [userId, setUserId] = useState("");
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const submitGrant = async () => {
    setMsg(null);
    try {
      await grant.mutateAsync({ userId: userId.trim(), coins: Number(coins), note: note.trim() || undefined });
      setMsg(`Granted ${coins} coins`);
      setUserId("");
      setCoins("");
      setNote("");
    } catch (e) {
      setMsg(getErrorMessage(e));
    }
  };

  return (
    <PageShell title="Loyalty / H-Coins" subtitle="Reward rules, coin economy & promotional grants">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Coins issued" value={formatNumber(data?.totalIssued ?? 0)} icon={Coins} />
        <KpiCard label="Coins redeemed" value={formatNumber(data?.totalRedeemed ?? 0)} icon={TrendingDown} />
        <KpiCard label="Outstanding" value={formatNumber(data?.outstanding ?? 0)} icon={Users} sub={`${formatNumber(data?.holders ?? 0)} holders`} />
        <KpiCard label="Liability" value={inr(data?.liabilityRupees ?? 0)} icon={IndianRupee} />
      </div>

      <h2 className="mt-6 text-base font-semibold">Reward rules</h2>
      <p className="mt-1 text-sm text-[var(--color-biz-muted)]">Coins awarded per event. Changes apply to future earns.</p>
      <div className="mt-3 flex flex-col gap-2">
        {(data?.rules ?? []).map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>

      <h2 className="mt-8 text-base font-semibold">Grant promo coins</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-biz-line)] p-4">
        <label className="text-xs text-[var(--color-biz-muted)]">
          User ID
          <input value={userId} onChange={(e) => setUserId(e.target.value)} className="mt-1 block w-64 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-[var(--color-biz-muted)]">
          Coins
          <input type="number" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 block w-28 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-[var(--color-biz-muted)]">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-48 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm" />
        </label>
        <button
          type="button"
          disabled={!userId.trim() || Number(coins) <= 0 || grant.isPending}
          onClick={() => void submitGrant()}
          className="rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Grant
        </button>
        {msg && <span className="text-xs text-[var(--color-biz-muted)]">{msg}</span>}
      </div>
    </PageShell>
  );
}

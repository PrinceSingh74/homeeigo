"use client";

import { useState } from "react";
import { Coins, Gift, IndianRupee, ScrollText, TrendingDown, Users } from "lucide-react";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  useAdminHCoinAnalyticsQuery,
  useGrantHCoinMutation,
  useUpdateHCoinRuleMutation,
} from "@/hooks/use-admin-data";
import type { HCoinRule } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

function RuleRow({ rule }: { rule: HCoinRule }) {
  const update = useUpdateHCoinRuleMutation();
  const [coins, setCoins] = useState(String(rule.coins));
  const dirty = coins !== String(rule.coins);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)]/40 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{rule.label}</p>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--color-biz-muted)]">{rule.event}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          aria-label={`${rule.label} coins`}
          value={coins}
          onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ""))}
          className="biz-input w-24"
        />
        <span className="text-xs text-[var(--color-biz-muted)]">coins</span>
        <button
          type="button"
          disabled={!dirty || update.isPending}
          onClick={() => update.mutate({ id: rule.id, body: { coins: Number(coins) } })}
          className="biz-btn biz-btn-primary px-3 py-1.5 text-xs"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => update.mutate({ id: rule.id, body: { isActive: !rule.isActive } })}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
            rule.isActive
              ? "bg-[color:rgb(16_185_129_/_0.15)] text-[var(--color-biz-success)]"
              : "bg-[var(--color-biz-elevated)] text-[var(--color-biz-muted)]"
          }`}
        >
          {rule.isActive ? "Active" : "Off"}
        </button>
      </div>
    </div>
  );
}

export default function LoyaltyPage() {
  const { data, isLoading } = useAdminHCoinAnalyticsQuery();
  const grant = useGrantHCoinMutation();
  const [userId, setUserId] = useState("");
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submitGrant = async () => {
    setMsg(null);
    setOk(false);
    try {
      await grant.mutateAsync({ userId: userId.trim(), coins: Number(coins), note: note.trim() || undefined });
      setMsg(`Granted ${coins} coins`);
      setOk(true);
      setUserId("");
      setCoins("");
      setNote("");
    } catch (e) {
      setMsg(getErrorMessage(e));
    }
  };

  return (
    <GrowthPage
      icon={Coins}
      title="Loyalty"
      subtitle="H-Coin reward rules, outstanding liability, and promotional grants. Rule changes apply to future earns only — they do not rewrite posted finance."
    >
      <div className="biz-kpi-grid">
        <KpiCard
          label="Coins issued"
          value={formatNumber(data?.totalIssued ?? 0)}
          sub="Lifetime granted"
          icon={Coins}
          loading={isLoading}
        />
        <KpiCard
          label="Coins redeemed"
          value={formatNumber(data?.totalRedeemed ?? 0)}
          sub="Spent by customers"
          icon={TrendingDown}
          loading={isLoading}
        />
        <KpiCard
          label="Outstanding"
          value={formatNumber(data?.outstanding ?? 0)}
          sub={`${formatNumber(data?.holders ?? 0)} holders`}
          icon={Users}
          loading={isLoading}
          accent="amber"
        />
        <KpiCard
          label="Rupee liability"
          value={inr(data?.liabilityRupees ?? 0)}
          sub="Unredeemed coin value"
          icon={IndianRupee}
          loading={isLoading}
          accent="red"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Reward rules"
          hint="Coins awarded per event. Saving a number updates future earns; toggling Off stops that event."
          icon={ScrollText}
          iconTone="cyan"
        >
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="biz-skeleton h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : (data?.rules ?? []).length > 0 ? (
            <div className="flex flex-col gap-2">
              {(data?.rules ?? []).map((r) => (
                <RuleRow key={r.id} rule={r} />
              ))}
            </div>
          ) : (
            <EmptyState title="No reward rules" description="H-Coin earn rules will appear here once configured." />
          )}
        </Panel>

        <Panel title="Grant promo coins" hint="Manual credit to one customer. Requires a real user id." icon={Gift} iconTone="success">
          <div className="space-y-3">
            <Field label="User ID">
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="biz-input"
                placeholder="User uuid"
              />
            </Field>
            <Field label="Coins">
              <input
                type="number"
                min={1}
                value={coins}
                onChange={(e) => setCoins(e.target.value.replace(/[^\d]/g, ""))}
                className="biz-input"
                placeholder="100"
              />
            </Field>
            <Field label="Note" hint="Stored on the grant for audit">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="biz-input"
                placeholder="Festival promo"
              />
            </Field>
            <button
              type="button"
              disabled={!userId.trim() || Number(coins) <= 0 || grant.isPending}
              onClick={() => void submitGrant()}
              className="biz-btn biz-btn-primary w-full justify-center"
            >
              Grant coins
            </button>
            {msg ? (
              <p className={`text-xs ${ok ? "text-[var(--color-biz-success)]" : "text-[var(--color-biz-danger)]"}`}>
                {msg}
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </GrowthPage>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, ShieldAlert, TrendingUp, Users, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable } from "@/components/ui/DataTable";
import { useAdminReferralAnalyticsQuery } from "@/hooks/use-admin-data";
import { adminApi } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";

const FUNNEL_KEYS = [
  ["invited", "Invited"],
  ["registered", "Registered"],
  ["verified", "Verified"],
  ["training", "Training"],
  ["active", "Active"],
  ["firstJob", "First job"],
  ["qualified", "Qualified"],
  ["rewarded", "Rewarded"],
] as const;

export default function ReferralsPage() {
  const qc = useQueryClient();
  const customer = useAdminReferralAnalyticsQuery();
  const partner = useQuery({
    queryKey: ["admin", "partner-referrals", "overview"],
    queryFn: () => adminApi.referrals.partnerOverview(),
  });
  const [tab, setTab] = useState<"overview" | "network" | "risk" | "customer">("overview");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [review, setReview] = useState("");
  const [city, setCity] = useState("");
  const [campaign, setCampaign] = useState("");
  const queue = useQuery({
    queryKey: ["admin", "partner-referrals", "queue", status, review, city, campaign, tab],
    queryFn: () =>
      adminApi.referrals.partnerQueue({
        limit: 40,
        status: status || undefined,
        review: review || undefined,
        city: city || undefined,
        campaign: campaign || undefined,
        risk: tab === "risk" ? "open" : undefined,
      }),
  });
  const actionMut = useMutation({
    mutationFn: (vars: { id: string; action: string }) =>
      adminApi.referrals.partnerAction(vars.id, vars.action, reason || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "partner-referrals"] });
    },
  });

  const data = customer.data;
  const overview = partner.data;
  const reached = overview?.reached;
  const leaderRows = useMemo(
    () => (data?.leaderboard ?? []).map((l) => [`#${l.rank}`, l.name, formatNumber(l.referrals), inr(l.earned)]),
    [data],
  );
  const fraudRows = useMemo(
    () =>
      (data?.fraudFlags ?? []).map((f) => [
        f.name,
        f.email,
        formatNumber(f.pendingReferrals),
        f.reason,
      ]),
    [data],
  );

  const actionCell = useCallback((id: string) => {
    return (
      <span key={id} className="flex flex-wrap gap-1">
        {(["review", "approve", "hold", "block", "release"] as const).map((a) => (
          <button
            key={a}
            type="button"
            className="biz-btn text-xs min-h-11 px-2"
            onClick={() => actionMut.mutate({ id, action: a })}
          >
            {a}
          </button>
        ))}
      </span>
    );
  }, [actionMut]);

  const networkRows = useMemo(
    () =>
      (queue.data?.items ?? []).map((r) => [
        r.referrer.name,
        r.referred.name,
        r.status.replace(/_/g, " "),
        `${r.successfulJobs}/3`,
        r.reviewStatus,
        String(r.signalCount),
        r.reward ? `${r.reward.status} ${inr(r.reward.amount)}` : "—",
        actionCell(r.id),
      ]),
    [queue.data, actionCell],
  );
  const riskRows = useMemo(
    () =>
      (queue.data?.items ?? []).map((r) => [
        r.referrer.name,
        r.referred.name,
        r.reviewStatus,
        String(r.signalCount),
        r.qualificationStatus,
        actionCell(r.id),
      ]),
    [queue.data, actionCell],
  );

  return (
    <PageShell
      eyebrow="Network HQ"
      icon={Users}
      title="Referral HQ"
      subtitle="Partner network, customer referrals, qualification, rewards, and risk. Rewards post through finance — this page does not credit wallets."
    >
      <div className="biz-segment w-fit" role="tablist" aria-label="Referral HQ views">
        {(["overview", "network", "risk", "customer"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`biz-segment-btn min-h-11 ${tab === id ? "is-active" : ""}`}
          >
            {id === "overview" ? "Overview" : id === "network" ? "Partner network" : id === "risk" ? "Risk queue" : "Customer"}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Partner invited" value={formatNumber(reached?.invited ?? 0)} icon={Users} />
            <KpiCard label="Qualified" value={formatNumber(reached?.qualified ?? 0)} icon={TrendingUp} />
            <KpiCard label="Released rewards" value={inr(overview?.economics.released ?? 0)} icon={Gift} />
            <KpiCard label="Reward liability" value={inr(overview?.economics.liabilityEstimate ?? 0)} icon={Wallet} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Open reviews" value={formatNumber(overview?.riskOpen ?? 0)} icon={ShieldAlert} />
            <KpiCard
              label="Invited → registered"
              value={overview?.conversion.invitedToRegisteredPct != null ? `${overview.conversion.invitedToRegisteredPct}%` : "—"}
            />
            <KpiCard
              label="Registered → active"
              value={overview?.conversion.registeredToActivePct != null ? `${overview.conversion.registeredToActivePct}%` : "—"}
            />
            <KpiCard
              label="Qualified rate"
              value={overview?.conversion.qualifiedPct != null ? `${overview.conversion.qualifiedPct}%` : "—"}
            />
          </div>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">Reached funnel</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {FUNNEL_KEYS.map(([key, label]) => (
              <div key={key} className="rounded-xl border border-[var(--color-biz-line)] p-3">
                <p className="text-xs text-[var(--color-biz-muted)]">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(reached?.[key] ?? 0)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-base font-semibold">Sources</h2>
              <div className="mt-3">
                <DataTable
                  headers={["Source", "Referrals"]}
                  emptyMessage="No partner referrals yet."
                  rows={(overview?.sources ?? []).map((s) => [s.source.replace(/_/g, " "), formatNumber(s.referrals)])}
                />
              </div>
            </div>
            <div>
              <h2 className="text-base font-semibold">Top referrers</h2>
              <div className="mt-3">
                <DataTable
                  headers={["Partner", "Referrals"]}
                  emptyMessage="No network volume yet."
                  rows={(overview?.topReferrers ?? []).map((s) => [s.name, formatNumber(s.referrals)])}
                />
              </div>
            </div>
          </div>
        </>
      ) : null}

      {tab === "network" || tab === "risk" ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-[var(--color-biz-muted)]">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 min-h-11"
              >
                <option value="">All</option>
                {["INVITED", "REGISTERED", "VERIFIED", "TRAINING", "ACTIVE", "FIRST_JOB", "QUALIFIED", "REWARD_RELEASED"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-[var(--color-biz-muted)]">
              Review
              <select
                value={review}
                onChange={(e) => setReview(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 min-h-11"
              >
                <option value="">All</option>
                {["NONE", "OPEN", "APPROVED", "HELD", "BLOCKED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-[var(--color-biz-muted)]">
              City
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 min-h-11"
              />
            </label>
            <label className="text-sm text-[var(--color-biz-muted)]">
              Campaign
              <input
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 min-h-11"
              />
            </label>
          </div>
          <label className="mt-3 block text-sm text-[var(--color-biz-muted)]">
            Reason for hold / block / release
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full max-w-md rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 min-h-11"
            />
          </label>
          {actionMut.isError ? (
            <p className="mt-2 text-sm text-red-500" role="alert">
              {actionMut.error instanceof Error ? actionMut.error.message : "Action failed"}
            </p>
          ) : null}
        </>
      ) : null}

      {tab === "network" ? (
        <div className="mt-3">
          <DataTable
            headers={["Referrer", "Referred", "Status", "Jobs", "Review", "Signals", "Reward", "Actions"]}
            isLoading={queue.isLoading}
            isError={queue.isError}
            onRetry={() => void queue.refetch()}
            emptyMessage="No partner referrals yet."
            rows={networkRows}
          />
        </div>
      ) : null}

      {tab === "risk" ? (
        <div className="mt-3">
          <DataTable
            headers={["Referrer", "Referred", "Review", "Signals", "Qualification", "Actions"]}
            isLoading={queue.isLoading}
            isError={queue.isError}
            onRetry={() => void queue.refetch()}
            emptyMessage="No referral risk items."
            rows={riskRows}
          />
        </div>
      ) : null}

      {tab === "customer" ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Customer referrals" value={formatNumber(data?.totalReferrals ?? 0)} icon={Users} />
            <KpiCard label="Qualified" value={formatNumber(data?.qualified ?? 0)} icon={TrendingUp} sub={`${formatNumber(data?.pending ?? 0)} pending`} />
            <KpiCard label="Commission paid" value={inr(data?.totalCommission ?? 0)} icon={Gift} />
            <KpiCard label="Withdrawn" value={inr(data?.totalWithdrawn ?? 0)} icon={Wallet} />
          </div>
          <h2 className="mt-6 text-base font-semibold">Top customer referrers</h2>
          <div className="mt-3">
            <DataTable
              headers={["Rank", "Name", "Referrals", "Earned"]}
              isLoading={customer.isLoading}
              isError={customer.isError}
              onRetry={() => void customer.refetch()}
              emptyMessage="No customer referrals yet."
              rows={leaderRows}
            />
          </div>
          <h2 className="mt-8 flex items-center gap-2 text-base font-semibold">
            <ShieldAlert size={18} className="text-amber-400" /> Customer fraud signals
          </h2>
          <div className="mt-3">
            <DataTable headers={["Name", "Email", "Pending", "Reason"]} emptyMessage="No suspicious referrers." rows={fraudRows} />
          </div>
        </>
      ) : null}
    </PageShell>
  );
}

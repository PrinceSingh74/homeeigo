"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerNetworkInviteMutation, usePartnerNetworkQuery } from "@/hooks/use-partner-os";
import type { PartnerNetworkReferral } from "@/services/partner-api";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const FUNNEL: Array<{ key: "invited" | "registered" | "verified" | "training" | "active" | "firstJob" | "qualified" | "rewarded"; label: string }> = [
  { key: "invited", label: "Invited" },
  { key: "registered", label: "Registered" },
  { key: "verified", label: "Verified" },
  { key: "training", label: "Training" },
  { key: "active", label: "Active" },
  { key: "firstJob", label: "First job" },
  { key: "qualified", label: "Qualified" },
  { key: "rewarded", label: "Rewarded" },
];

function JobDots({ jobs, target }: { jobs: number; target: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`${jobs} of ${target} successful jobs`} role="img">
      {Array.from({ length: target }).map((_, i) => (
        <span
          key={i}
          className={`inline-block h-2.5 w-2.5 rounded-full ${i < jobs ? "bg-partner-primary" : "bg-partner-line"}`}
        />
      ))}
    </div>
  );
}

function ReferralCard({ row }: { row: PartnerNetworkReferral }) {
  const celebrated = row.status === "QUALIFIED" || row.status === "REWARD_RELEASED";
  return (
    <article className="partner-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-partner-text">{row.name}</h3>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-partner-muted">
            {row.status.replace(/_/g, " ")} · {row.qualificationLabel}
          </p>
        </div>
        {row.rewardAmount != null ? (
          <p className="text-sm font-semibold tabular-nums text-partner-primary">{inr(row.rewardAmount)}</p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <JobDots jobs={row.jobs} target={row.jobTarget} />
        <p className="text-sm tabular-nums text-partner-muted">
          {row.jobs} of {row.jobTarget} jobs
        </p>
      </div>
      <p className={`mt-3 text-sm ${celebrated ? "text-partner-text" : "text-partner-muted"}`}>{row.nextMilestone}</p>
    </article>
  );
}

export default function RewardsReferralsPage() {
  const network = usePartnerNetworkQuery();
  const invite = usePartnerNetworkInviteMutation();
  const data = network.data;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function copyShare() {
    if (!data?.shareUrl) return;
    await navigator.clipboard.writeText(data.shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await invite.mutateAsync({ name: name.trim(), phone: phone.trim() });
      setName("");
      setPhone("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not send invite");
    }
  }

  return (
    <HqPageShell
      title="Partner Network"
      description="Invite partners with your unique code. Rewards release after they are ACTIVE, complete 3 successful jobs, and clear trust gates. Qualification is calculated on the server."
      icon={Trophy}
      loading={network.isLoading}
      error={network.isError ? "Could not load your partner network." : null}
      onRetry={() => void network.refetch()}
      stats={
        data
          ? [
              { label: "Your code", value: data.code },
              { label: "Invited", value: data.counts.invited },
              { label: "Qualified", value: data.counts.qualified },
              { label: "Rewards", value: inr(data.totalRewarded) },
            ]
          : undefined
      }
    >
      {data ? (
        <div className="space-y-6">
          <section className="partner-glass rounded-2xl border border-partner-line p-5 sm:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-partner-muted">Share link</h2>
            <p className="mt-2 break-all font-mono text-sm text-partner-text">{data.shareUrl}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-partner-primary px-4 py-2 text-sm font-semibold text-white min-h-11"
                onClick={() => void copyShare()}
              >
                {copied ? "Copied" : "Copy invite link"}
              </button>
              <p className="self-center text-sm text-partner-muted">₹{data.rewardPerQualified} after qualification</p>
            </div>
          </section>

          <section className="partner-card p-5">
            <h2 className="text-sm font-semibold">Invite someone</h2>
            <p className="mt-1 text-sm text-partner-muted">Creates a Section 01 application invite bound to your referral.</p>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void onInvite(e)}>
              <label className="text-sm">
                <span className="text-partner-muted">Full name</span>
                <input
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-partner-line bg-transparent px-3 py-2.5 min-h-11"
                  autoComplete="name"
                />
              </label>
              <label className="text-sm">
                <span className="text-partner-muted">Mobile</span>
                <input
                  required
                  minLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-partner-line bg-transparent px-3 py-2.5 min-h-11"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </label>
              <div className="sm:col-span-2">
                {formError ? (
                  <p className="mb-2 text-sm text-red-600" role="alert">
                    {formError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={invite.isPending}
                  className="rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold min-h-11"
                >
                  {invite.isPending ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-partner-muted">Funnel</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {FUNNEL.map((f) => (
                <div key={f.key} className="partner-card p-3">
                  <p className="text-xs text-partner-muted">{f.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{data.counts[f.key]}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-partner-muted">Your referrals</h2>
            {data.referrals.length === 0 ? (
              <div className="partner-card p-6 text-sm text-partner-muted">
                No referrals yet. Share your code or send a personal invite.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {data.referrals.map((row) => (
                  <ReferralCard key={row.id} row={row} />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </HqPageShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Gift,
  IndianRupee,
  Mail,
  MessageCircle,
  Share2,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { pageLead, pageTitle } from "@/lib/page-layout";
import {
  useReferralHistory,
  useReferralLeaderboard,
  useReferralSummary,
  useReferralWithdraw,
} from "@/hooks/use-referrals";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function ShareSection({ code }: { code: string | null }) {
  const showToast = useAppStore((s) => s.showToast);
  const [copied, setCopied] = useState(false);

  if (!code) return null;

  const shareText = `Join me on HOMEEIGO for trusted home services! Use my code ${code} when you sign up and we both earn rewards. https://homigo.app/signup?ref=${code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      showToast("Referral code copied", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Could not copy. Long-press to copy manually.", "error");
    }
  };

  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "HOMEEIGO Referral", text: shareText });
      } catch {
        /* user dismissed */
      }
    } else {
      await copy();
    }
  };

  return (
    <section className="glass-card rounded-[28px] p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
        <Gift size={18} className="text-primary" />
        Your referral code
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-5 py-3 font-mono text-lg font-bold tracking-widest text-primary">
          {code}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-[#25D366] hover:text-[#25D366]"
        >
          <MessageCircle size={16} />
          WhatsApp
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent("Join me on HOMEEIGO")}&body=${encodeURIComponent(shareText)}`}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-primary hover:text-primary"
        >
          <Mail size={16} />
          Email
        </a>
        <button
          type="button"
          onClick={() => void nativeShare()}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content transition hover:border-primary hover:text-primary"
        >
          <Share2 size={16} />
          More
        </button>
      </div>
    </section>
  );
}

export default function ReferralsPage() {
  const user = useAuthStore((s) => s.user);
  const { data: summary, isLoading } = useReferralSummary();
  const { data: history } = useReferralHistory();
  const { data: leaderboard } = useReferralLeaderboard();
  const withdraw = useReferralWithdraw();

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const balance = summary?.balance ?? 0;

  const submitWithdraw = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > balance) return;
    setWithdrawing(true);
    const ok = await withdraw(value);
    setWithdrawing(false);
    if (ok) {
      setShowWithdraw(false);
      setAmount("");
    }
  };

  const stats = [
    { label: "Friends invited", value: String(summary?.referralCount ?? 0), icon: Users },
    { label: "Qualified", value: String(summary?.qualified ?? 0), icon: Check },
    { label: "Total earned", value: inr(summary?.totalEarned ?? 0), icon: IndianRupee },
    { label: "Withdrawn", value: inr(summary?.withdrawn ?? 0), icon: Wallet },
  ];

  return (
    <PageShell>
      <header className="mb-6 sm:mb-8">
        <Link
          href="/profile"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-primary"
        >
          <ArrowLeft size={16} />
          Back to profile
        </Link>
        <h1 className={pageTitle}>Refer & Earn</h1>
        <p className={pageLead}>
          Invite friends to HOMEEIGO — earn {inr(summary?.commissionPerReferral ?? 100)} when they
          complete their first booking.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* Earnings hero */}
        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                Available to withdraw
              </p>
              <p className="mt-1 font-display text-4xl font-extrabold text-content">
                {isLoading ? "—" : inr(balance)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {summary?.pending ?? 0} pending referral{(summary?.pending ?? 0) === 1 ? "" : "s"} ·
                worth {inr((summary?.pending ?? 0) * (summary?.commissionPerReferral ?? 100))} once
                they book
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowWithdraw((v) => !v)}
              disabled={balance <= 0}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Wallet size={16} />
              Withdraw to wallet
            </button>
          </div>

          {showWithdraw && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Amount (max ${inr(balance)})`}
                className="w-44 flex-1 rounded-xl border border-line bg-transparent px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setAmount(String(balance))}
                className="rounded-xl border border-line px-3 py-2.5 text-xs font-semibold text-content"
              >
                Max
              </button>
              <button
                type="button"
                onClick={() => void submitWithdraw()}
                disabled={
                  withdrawing || !amount || Number(amount) <= 0 || Number(amount) > balance
                }
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {withdrawing ? "Moving…" : "Confirm"}
              </button>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border border-line p-3 text-center">
                <Icon size={16} className="mx-auto text-primary" />
                <p className="mt-1.5 font-display text-lg font-bold text-content">{value}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <ShareSection code={summary?.code ?? user?.referralCode ?? null} />

        {/* History */}
        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-content">Referral history</h2>
          {!history || history.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line py-8 text-center text-sm text-muted">
              No referrals yet. Share your code to start earning.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content">{h.refereeName}</p>
                    <p className="text-xs text-muted">
                      Joined {fmt(h.createdAt)}
                      {h.qualifiedAt ? ` · Qualified ${fmt(h.qualifiedAt)}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase",
                      h.status === "QUALIFIED"
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    {h.status === "QUALIFIED" ? `+${inr(h.amount)}` : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Leaderboard */}
        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
            <Trophy size={18} className="text-gold" />
            Top referrers
          </h2>
          {!leaderboard || leaderboard.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line py-6 text-center text-sm text-muted">
              Be the first on the leaderboard.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {leaderboard.map((l) => (
                <li key={l.rank} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {l.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-content">{l.name}</span>
                  <span className="text-xs text-muted">{l.referrals} referrals</span>
                  <span className="text-sm font-bold text-content">{inr(l.earned)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* How it works */}
        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-content">How it works</h2>
          <ol className="mt-3 flex flex-col gap-3 text-sm text-muted">
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</span>
              Share your referral code with friends and family.
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</span>
              They sign up with your code and complete their first paid booking.
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</span>
              You earn {inr(summary?.commissionPerReferral ?? 100)} per qualified referral — withdraw it straight to your wallet.
            </li>
          </ol>
        </section>
      </div>
    </PageShell>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Check, Crown, FileText, Sparkles, X } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { pageLead, pageTitle } from "@/lib/page-layout";
import {
  useMySubscription,
  useSubscriptionPlans,
  useSubscriptionPurchase,
} from "@/hooks/use-subscription";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useQuery } from "@tanstack/react-query";
import { coreApi, type MembershipPlan } from "@/services/core/api";
import { cn } from "@/lib/utils";
import { MembershipBenefitsCenter } from "@/components/membership/MembershipBenefitsCenter";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const INTERVAL_LABEL: Record<MembershipPlan["interval"], string> = {
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  YEARLY: "/year",
};

export default function MembershipPage() {
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { data: mine } = useMySubscription();
  const { data: entitlements } = useEntitlements();
  const { purchase, cancel, busy } = useSubscriptionPurchase();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: invoices } = useQuery({
    queryKey: ["subscription", "invoices"],
    queryFn: () => coreApi.subscriptions.invoices(),
  });

  const active = mine?.active ?? null;
  const hasMembership = Boolean(entitlements?.hasMembership || active);

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
        <h1 className={pageTitle}>HOMEEIGO Premium</h1>
        <p className={pageLead}>
          Unlock member discounts, cashback on every booking, priority support, and more.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        {/* Current membership */}
        {hasMembership && (
          <section className="glass-card rounded-[28px] border-primary/30 p-5 ring-1 ring-primary/20 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                  <Crown size={14} />
                  Active membership
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-content">
                  {active?.plan?.name ?? entitlements?.planName ?? "Premium"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Valid until {fmt(active?.expiresAt ?? entitlements?.expiresAt ?? null)}
                  {active?.autoRenew ? " · Auto-renews" : active ? " · Auto-renew off" : ""}
                </p>
                {entitlements ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entitlements.discountPct > 0 && (
                      <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                        {entitlements.discountPct}% off bookings
                      </span>
                    )}
                    {entitlements.cashbackPct > 0 && (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                        {entitlements.cashbackPct}% cashback
                      </span>
                    )}
                    {entitlements.prioritySupport && (
                      <span className="rounded-full bg-violet/10 px-3 py-1 text-xs font-bold text-violet">
                        Priority support
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
              {active?.autoRenew ? (
                confirmCancel ? (
                  <div className="flex flex-col items-end gap-2">
                    <p className="text-xs text-muted">
                      Access continues until {fmt(active.expiresAt)}. Cancel auto-renew?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void cancel();
                          setConfirmCancel(false);
                        }}
                        className="rounded-xl bg-error px-4 py-2 text-xs font-bold text-white"
                      >
                        Yes, cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmCancel(false)}
                        className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-content"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted transition hover:border-error hover:text-error"
                  >
                    <X size={14} />
                    Cancel auto-renew
                  </button>
                )
              ) : null}
            </div>
          </section>
        )}

        {hasMembership && <MembershipBenefitsCenter />}

        {/* Plans */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-content">
            <Sparkles size={18} className="text-primary" />
            {hasMembership ? "All plans" : "Choose your plan"}
          </h2>
          {plansLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-72 animate-pulse rounded-[28px] bg-surface/70 ring-1 ring-line" />
              ))}
            </div>
          ) : !plans || plans.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-8 text-center text-sm text-muted">
              Plans are not available right now. Please check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = active?.plan?.id === plan.id;
                return (
                  <article
                    key={plan.id}
                    className={cn(
                      "glass-card flex flex-col rounded-[28px] p-5 sm:p-6",
                      isCurrent && "border-primary/40 ring-1 ring-primary/25",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-lg font-bold text-content">{plan.name}</h3>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase text-primary">
                          <BadgeCheck size={12} />
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-2">
                      <span className="font-display text-3xl font-extrabold text-content">
                        {inr(plan.price)}
                      </span>
                      <span className="text-sm text-muted">{INTERVAL_LABEL[plan.interval]}</span>
                    </p>
                    {plan.description ? (
                      <p className="mt-2 text-sm text-muted">{plan.description}</p>
                    ) : null}
                    <ul className="mt-4 flex flex-1 flex-col gap-2">
                      {plan.benefits.map((b) => (
                        <li key={b.id} className="flex items-start gap-2 text-sm text-content">
                          <Check size={16} className="mt-0.5 shrink-0 text-success" />
                          {b.label}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void purchase(plan.id)}
                      disabled={busy || isCurrent}
                      className={cn(
                        "mt-5 w-full rounded-2xl px-4 py-3 text-sm font-bold transition disabled:opacity-60",
                        isCurrent
                          ? "border border-line text-muted"
                          : "bg-primary text-white hover:opacity-90",
                      )}
                    >
                      {isCurrent ? "Your active plan" : busy ? "Processing…" : hasMembership ? "Switch plan" : "Get started"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Invoices */}
        {invoices && invoices.length > 0 ? (
          <section className="glass-card rounded-[28px] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-content">
              <FileText size={18} className="text-primary" />
              Billing history
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {invoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-content">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted">
                      {fmt(inv.periodStart)} → {fmt(inv.periodEnd)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-content">{inr(inv.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* FAQ */}
        <section className="glass-card rounded-[28px] p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold text-content">Frequently asked</h2>
          <div className="mt-3 flex flex-col gap-2">
            {[
              {
                q: "How does billing work?",
                a: "You pay once per billing period via Razorpay (UPI, card, or netbanking). With auto-renew on, your plan renews automatically at the end of each period.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Cancelling stops auto-renew — your benefits stay active until the end of the period you've already paid for.",
              },
              {
                q: "When do I get cashback?",
                a: "Membership cashback is credited to your HOMEEIGO wallet after each eligible booking is completed and paid.",
              },
            ].map(({ q, a }) => (
              <details key={q} className="group rounded-2xl border border-line p-4">
                <summary className="cursor-pointer list-none text-sm font-bold text-content">
                  {q}
                </summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

"use client";

import { useMemo } from "react";
import { Check, Crown, Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import {
  useMySubscription,
  useSubscriptionPlans,
  useSubscriptionPurchase,
} from "@/hooks/use-subscription";
import type { MembershipInterval } from "@/services/core/api";
import { cn } from "@/lib/utils";

const INTERVAL_LABEL: Record<MembershipInterval, string> = {
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  YEARLY: "/year",
};
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function daysLeft(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function PremiumModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { data: mine, isLoading: mineLoading } = useMySubscription(open);
  const { purchase, cancel, busy } = useSubscriptionPurchase();

  const active = mine?.active ?? null;
  const expiresSoon = useMemo(
    () => active?.expiresAt != null && daysLeft(active.expiresAt) <= 7,
    [active],
  );

  return (
    <Modal open={open} onClose={closeOverlay} title="HOMEEIGO Premium" size="md">
      {mineLoading || plansLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={28} className="animate-spin text-primary" />
        </div>
      ) : active ? (
        /* ===== Active subscription ===== */
        <div className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-2xl bg-premium p-5 text-white">
            <Crown size={28} className="text-gold" fill="currentColor" />
            <p className="mt-2 font-display text-xl font-bold">{active.plan.name}</p>
            <p className="mt-0.5 text-sm text-white/85">
              {active.cancelledAt ? "Auto-renew off · " : ""}Active until{" "}
              {active.expiresAt ? fmtDate(active.expiresAt) : "—"}
            </p>
          </div>

          {expiresSoon && active.expiresAt && (
            <div className="rounded-xl bg-warning/15 px-3 py-2 text-xs font-medium text-warning">
              Your membership expires in {daysLeft(active.expiresAt)} day(s). Renew to keep your benefits.
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {active.plan.benefits.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm text-content">
                <Check size={16} className="text-success" strokeWidth={3} />
                {b.label}
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void purchase(active.plan.id)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Renew ({inr(active.plan.price)})
            </button>
            {!active.cancelledAt && (
              <button
                type="button"
                onClick={() => void cancel()}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content"
              >
                Cancel auto-renew
              </button>
            )}
          </div>
        </div>
      ) : (
        /* ===== Plan comparison (no active membership) ===== */
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Sparkles size={15} className="text-primary" /> Choose a plan to unlock premium benefits.
          </p>
          {(plans ?? []).map((plan, i) => {
            const best = plan.interval === "YEARLY";
            return (
              <div
                key={plan.id}
                className={cn(
                  "rounded-2xl border p-4",
                  best ? "border-primary bg-primary/5" : "border-line",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-bold text-content">{plan.name}</h3>
                      {best && (
                        <span className="rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                          Best value
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-display text-lg font-extrabold text-content">
                      {inr(plan.price)}
                      <span className="text-xs font-medium text-muted">{INTERVAL_LABEL[plan.interval]}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void purchase(plan.id)}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {busy ? "…" : "Choose"}
                  </button>
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {plan.benefits.map((b) => (
                    <li key={b.id} className="flex items-center gap-1.5 text-xs text-muted">
                      <Check size={13} className="shrink-0 text-success" strokeWidth={3} />
                      {b.label}
                    </li>
                  ))}
                </ul>
                {i === (plans ?? []).length - 1 && (
                  <p className="mt-3 text-center text-[11px] text-muted">Secured by Razorpay · cancel anytime</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

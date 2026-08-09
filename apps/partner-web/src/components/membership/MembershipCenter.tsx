"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Loader2 } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  partnerKeys,
  useCancelMembershipMutation,
  usePartnerEntitlementsQuery,
  usePartnerMembershipQuery,
  usePartnerPlansQuery,
} from "@/hooks/use-partner-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { partnerApi } from "@/services/partner-api";
import { getErrorMessage } from "@/lib/api-error";
import { useToastStore } from "@/stores/toast-store";
import { formatDate, formatInr } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PartnerMembershipPlan } from "@/types/partner";

export function MembershipCenter() {
  const membership = usePartnerMembershipQuery();
  const plans = usePartnerPlansQuery();
  const entitlements = usePartnerEntitlementsQuery();
  const cancel = useCancelMembershipMutation();
  const { openCheckout } = useRazorpayCheckout();
  const showToast = useToastStore((s) => s.showToast);
  const qc = useQueryClient();
  const [upgradingId, setUpgradingId] = useState<string | null>(null);

  const active = membership.data?.active;
  const activePlanId = active?.plan?.id;

  const upgradeMut = useMutation({
    mutationFn: async (planId: string) => {
      setUpgradingId(planId);
      const order = await partnerApi.subscriptions.createOrder(planId);
      await openCheckout({
        key: order.key,
        orderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        name: "HOMEEIGO Partner",
        description: order.planName,
        checkoutMode: (order as { checkoutMode?: "razorpay" | "dev_mock" }).checkoutMode,
        onSuccess: async (payload) => {
          await partnerApi.subscriptions.verify({
            razorpayOrderId: payload.razorpay_order_id,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          });
        },
        onDismiss: () => setUpgradingId(null),
        onFailure: (message) => showToast(message, "error"),
      });
    },
    onSuccess: () => {
      showToast("Membership upgraded", "success");
      void qc.invalidateQueries({ queryKey: partnerKeys.membership });
      void qc.invalidateQueries({ queryKey: partnerKeys.entitlements });
    },
    onError: (err) => showToast(getErrorMessage(err), "error"),
    onSettled: () => setUpgradingId(null),
  });

  const isLoading = membership.isLoading || plans.isLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-partner-primary" />
      </div>
    );
  }

  const planList = plans.data ?? [];
  const uniqueBenefits = (() => {
    const seen = new Set<string>();
    return (entitlements.data?.benefits ?? []).filter((b) => {
      const k = `${b.type}|${b.label}|${b.value ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  })();

  return (
    <div className="space-y-6">
      {active ? (
        <PartnerCard className="relative overflow-hidden bg-gradient-to-br from-partner-primary/30 to-partner-purple/20 !p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-partner-muted">
                Current plan
              </p>
              <p className="font-display mt-1 text-3xl font-bold">{active.plan.name}</p>
              <p className="mt-2 text-sm text-partner-muted">
                Renews {active.expiresAt ? formatDate(active.expiresAt) : "—"}
                {active.autoRenew ? "" : " · Auto-renew off"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-partner-muted">Status</p>
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-partner-success/20 px-3 py-1 text-sm font-semibold text-partner-success">
                <Check className="h-4 w-4" /> Active
              </p>
            </div>
          </div>
          {active.autoRenew ? (
            <button
              type="button"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="mt-4 text-xs text-partner-muted underline hover:text-partner-text disabled:opacity-50"
            >
              Cancel auto-renew
            </button>
          ) : null}
        </PartnerCard>
      ) : (
        <PartnerCard className="!p-6 text-center">
          <Crown className="mx-auto h-10 w-10 text-amber-400" />
          <p className="mt-3 font-semibold">No active membership</p>
          <p className="mt-1 text-sm text-partner-muted">
            Upgrade to unlock lower commission, priority support, and more.
          </p>
        </PartnerCard>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {planList.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={plan.id === activePlanId}
            isUpgrading={upgradingId === plan.id && upgradeMut.isPending}
            onUpgrade={() => upgradeMut.mutate(plan.id)}
          />
        ))}
      </div>

      {uniqueBenefits.length > 0 ? (
        <PartnerCard>
          <h2 className="mb-4 font-display text-lg font-semibold">Your benefits</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {uniqueBenefits.map((b) => (
              <div key={`${b.type}|${b.label}|${b.value ?? ""}`} className="flex items-center gap-3">
                <Check className="h-4 w-4 shrink-0 text-partner-success" />
                <span className="text-sm text-partner-text">
                  {b.label}
                  {b.value != null && b.value > 0 ? ` (${b.value}%)` : ""}
                </span>
              </div>
            ))}
          </div>
        </PartnerCard>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  isCurrent,
  isUpgrading,
  onUpgrade,
}: {
  plan: PartnerMembershipPlan;
  isCurrent: boolean;
  isUpgrading: boolean;
  onUpgrade: () => void;
}) {
  const intervalLabel =
    plan.interval === "YEARLY" ? "/year" : plan.interval === "QUARTERLY" ? "/quarter" : "/month";

  return (
    <PartnerCard
      className={cn("!p-5", isCurrent && "ring-2 ring-partner-primary")}
    >
      <h3 className="font-display text-xl font-bold">{plan.name}</h3>
      {plan.description ? (
        <p className="mt-1 text-sm text-partner-muted">{plan.description}</p>
      ) : null}
      <p className="mt-4 font-display text-3xl font-bold">
        {formatInr(plan.price)}
        <span className="text-sm font-normal text-partner-muted">{intervalLabel}</span>
      </p>
      <ul className="mt-4 space-y-2">
        {plan.benefits.map((b) => (
          <li key={b.id} className="flex items-start gap-2 text-sm text-partner-text-secondary">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-partner-success" />
            {b.label}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <PartnerButton className="mt-6 w-full" disabled variant="outline">
          Current plan
        </PartnerButton>
      ) : (
        <PartnerButton
          className="mt-6 w-full"
          disabled={isUpgrading}
          onClick={onUpgrade}
        >
          {isUpgrading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Processing…
            </>
          ) : (
            "Upgrade"
          )}
        </PartnerButton>
      )}
    </PartnerCard>
  );
}

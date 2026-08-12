"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { useAppStore } from "@/stores/app-store";

export const subscriptionKeys = {
  plans: ["subscription", "plans"] as const,
  mine: ["subscription", "mine"] as const,
  invoices: ["subscription", "invoices"] as const,
};

export function useSubscriptionPlans(enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.plans,
    queryFn: () => coreApi.subscriptions.plans(),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useMySubscription(enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.mine,
    queryFn: () => coreApi.subscriptions.mine(),
    enabled,
  });
}

type PurchaseStatus = "idle" | "creating" | "processing" | "verifying" | "success" | "error";

/** Buy / renew a membership via Razorpay. Backend is the source of truth. */
export function useSubscriptionPurchase() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const setPremium = useAppStore((s) => s.setPremium);
  const { openCheckout } = useRazorpayCheckout();
  const [status, setStatus] = useState<PurchaseStatus>("idle");

  const busy = status === "creating" || status === "processing" || status === "verifying";

  const purchase = useCallback(
    async (planId: string, onDone?: () => void) => {
      if (busy) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        showToast("You are offline. Try again when online.", "error");
        return;
      }
      setStatus("creating");
      try {
        const order = await coreApi.subscriptions.order(planId);
        setStatus("processing");
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "HOMEEIGO Premium",
          description: order.planName,
          onSuccess: async (payload) => {
            try {
              setStatus("verifying");
              await coreApi.subscriptions.verify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              await qc.invalidateQueries({ queryKey: subscriptionKeys.mine });
              setPremium(true);
              setStatus("success");
              showToast("Membership activated 🎉", "success");
              onDone?.();
            } catch {
              setStatus("error");
              showToast("Payment verification failed. If money was deducted it will reflect shortly.", "error");
            }
          },
          onDismiss: () => {
            setStatus("idle");
            showToast("Payment cancelled. No money was charged.", "info");
          },
        });
      } catch {
        setStatus("error");
        showToast("Could not start the purchase. Please try again.", "error");
      }
    },
    [busy, openCheckout, qc, setPremium, showToast],
  );

  const cancel = useCallback(async () => {
    try {
      await coreApi.subscriptions.cancel();
      await qc.invalidateQueries({ queryKey: subscriptionKeys.mine });
      showToast("Auto-renew cancelled. Access continues until expiry.", "info");
    } catch {
      showToast("Could not cancel. Please try again.", "error");
    }
  }, [qc, showToast]);

  return { purchase, cancel, status, busy };
}

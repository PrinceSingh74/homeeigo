import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { useAppStore } from "@/lib/store";

export const subKeys = {
  plans: ["subscription", "plans"] as const,
  mine: ["subscription", "mine"] as const,
};

export function useSubscriptionPlans() {
  return useQuery({ queryKey: subKeys.plans, queryFn: () => coreApi.subscriptions.plans(), staleTime: 5 * 60_000 });
}

export function useMySubscription(enabled = true) {
  return useQuery({ queryKey: subKeys.mine, queryFn: () => coreApi.subscriptions.mine(), enabled });
}

type Status = "idle" | "creating" | "processing" | "verifying" | "success" | "error";

/** Buy / renew membership via Razorpay (mobile parity with web). */
export function useSubscriptionPurchase() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const setPremium = useAppStore((s) => s.setPremium);
  const { openCheckout } = useRazorpayCheckout();
  const [status, setStatus] = useState<Status>("idle");
  const busy = status === "creating" || status === "processing" || status === "verifying";

  const purchase = useCallback(
    async (planId: string, onDone?: () => void) => {
      if (busy) return;
      setStatus("creating");
      try {
        const order = await coreApi.subscriptions.order(planId);
        setStatus("processing");
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "Homeeigo Premium",
          description: order.planName,
          checkoutMode: (order as { checkoutMode?: "razorpay" | "dev_mock" }).checkoutMode,
          onSuccess: async (payload) => {
            try {
              setStatus("verifying");
              await coreApi.subscriptions.verify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              await qc.invalidateQueries({ queryKey: subKeys.mine });
              setPremium(true);
              setStatus("success");
              showToast("Membership activated 🎉");
              onDone?.();
            } catch {
              setStatus("error");
              showToast("Payment verification failed. It will reflect shortly if charged.");
            }
          },
          onDismiss: () => {
            setStatus("idle");
            showToast("Payment cancelled. No money was charged.");
          },
          onFailure: (message) => {
            setStatus("error");
            showToast(message);
          },
        });
      } catch {
        setStatus("error");
        showToast("Could not start the purchase. Try again.");
      }
    },
    [busy, openCheckout, qc, setPremium, showToast],
  );

  const cancel = useCallback(async () => {
    try {
      await coreApi.subscriptions.cancel();
      await qc.invalidateQueries({ queryKey: subKeys.mine });
      showToast("Auto-renew cancelled. Access continues until expiry.");
    } catch {
      showToast("Could not cancel. Try again.");
    }
  }, [qc, showToast]);

  return { purchase, cancel, status, busy };
}

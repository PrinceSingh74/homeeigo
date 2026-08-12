"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { useAppStore } from "@/stores/app-store";

export const giftCardKeys = {
  denominations: ["giftcards", "denominations"] as const,
  mine: ["giftcards", "mine"] as const,
};

export function useGiftDenominations() {
  return useQuery({ queryKey: giftCardKeys.denominations, queryFn: () => coreApi.giftCards.denominations(), staleTime: 60 * 60_000 });
}

export function useMyGiftCards(enabled = true) {
  return useQuery({ queryKey: giftCardKeys.mine, queryFn: () => coreApi.giftCards.myCards(), enabled });
}

/** Buy a gift card via Razorpay; backend is source of truth. */
export function useGiftCardPurchase() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  const { openCheckout } = useRazorpayCheckout();
  const [busy, setBusy] = useState(false);

  const purchase = useCallback(
    async (amount: number, opts: { recipientEmail?: string; recipientPhone?: string; message?: string }, onDone?: () => void) => {
      if (busy) return;
      setBusy(true);
      try {
        const order = await coreApi.giftCards.order(amount, opts);
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "HOMEEIGO Gift Card",
          description: `₹${amount} gift card`,
          onSuccess: async (payload) => {
            try {
              const res = await coreApi.giftCards.verify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              await qc.invalidateQueries({ queryKey: giftCardKeys.mine });
              showToast(res.sentTo ? `Gift card sent to ${res.sentTo}` : `Gift card ready · code ${res.code}`, "success");
              onDone?.();
            } catch {
              showToast("Payment verification failed. It will reflect shortly if charged.", "error");
            } finally {
              setBusy(false);
            }
          },
          onDismiss: () => {
            setBusy(false);
            showToast("Purchase cancelled. No money was charged.", "info");
          },
        });
      } catch {
        setBusy(false);
        showToast("Could not start the purchase. Please try again.", "error");
      }
    },
    [busy, openCheckout, qc, showToast],
  );

  return { purchase, busy };
}

export function useRedeemGiftCard() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);

  return async (code: string, amount?: number) => {
    try {
      const r = await coreApi.giftCards.redeem(code, amount);
      await Promise.all([
        qc.invalidateQueries({ queryKey: giftCardKeys.mine }),
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      showToast(
        r.remaining > 0
          ? `₹${r.amount.toLocaleString("en-IN")} added · ₹${r.remaining.toLocaleString("en-IN")} left on the card`
          : `₹${r.amount.toLocaleString("en-IN")} added to your wallet`,
        "success",
      );
      return true;
    } catch {
      showToast("Invalid, expired, or already-used gift card.", "error");
      return false;
    }
  };
}

export function useVoidGiftCard() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);

  return async (id: string) => {
    try {
      const r = await coreApi.giftCards.void(id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: giftCardKeys.mine }),
        qc.invalidateQueries({ queryKey: qk.walletBalance }),
        qc.invalidateQueries({ queryKey: qk.walletTx }),
      ]);
      showToast(`₹${r.refunded.toLocaleString("en-IN")} refunded to your wallet`, "success");
      return true;
    } catch {
      showToast("Could not refund this gift card.", "error");
      return false;
    }
  };
}

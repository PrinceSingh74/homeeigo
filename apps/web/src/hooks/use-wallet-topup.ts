"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { qk, useVerifyPaymentMutation } from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";

/**
 * Wallet top-up via Razorpay — backend is the single source of truth.
 *   POST /api/wallet/add-money  → Razorpay order + a PENDING wallet txn (rupees)
 *   (Razorpay checkout)
 *   POST /api/payments/verify   → walletService.verifyTopUp credits the balance
 * After verification we invalidate balance + transaction queries (no optimistic
 * credit). The flow is exposed as an explicit state machine so the UI can render
 * idle / creating / processing / verifying / success / error precisely.
 */
export type TopUpStatus =
  | "idle"
  | "creating" // POST /add-money in flight
  | "processing" // Razorpay checkout open
  | "verifying" // POST /verify in flight
  | "success"
  | "error";

export function useWalletTopUp() {
  const qc = useQueryClient();
  const verifyPayment = useVerifyPaymentMutation();
  const { openCheckout } = useRazorpayCheckout();
  const [status, setStatus] = useState<TopUpStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastAmount, setLastAmount] = useState(0);

  const busy = status === "creating" || status === "processing" || status === "verifying";

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  const topUp = useCallback(
    async (amount: number) => {
      if (busy) return; // prevent duplicate submissions
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setStatus("error");
        setError("You are offline. Please check your connection and try again.");
        return;
      }
      setLastAmount(amount);
      setError(null);
      setStatus("creating");
      try {
        const order = await coreApi.wallet.addMoney(amount);
        let settled = false;
        setStatus("processing");
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "HOMEEIGO Wallet",
          description: `Add ₹${amount.toLocaleString("en-IN")} to wallet`,
          onSuccess: async (payload) => {
            settled = true;
            try {
              setStatus("verifying");
              await verifyPayment.mutateAsync({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              await Promise.all([
                qc.invalidateQueries({ queryKey: qk.walletBalance }),
                qc.invalidateQueries({ queryKey: qk.walletTx }),
              ]);
              setStatus("success");
            } catch {
              setStatus("error");
              setError("Payment verification failed. If money was deducted, it will be auto-credited shortly.");
            }
          },
          onDismiss: () => {
            // Razorpay closed without a success callback → user cancelled.
            if (!settled) {
              setStatus("error");
              setError("Payment cancelled. No money was charged.");
            }
          },
        });
      } catch {
        setStatus("error");
        setError("Could not start the payment. Please try again.");
      }
    },
    [busy, openCheckout, qc, verifyPayment],
  );

  return { topUp, reset, status, error, lastAmount, busy };
}

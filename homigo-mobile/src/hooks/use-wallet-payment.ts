import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddMoneyMutation } from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { coreApi } from "@/services/core/api";
import { qk } from "@/hooks/use-core-data";

/**
 * Wallet top-up via Razorpay (mobile parity with web).
 *   POST /api/wallet/add-money → Razorpay order + PENDING wallet txn (rupees)
 *   (Razorpay checkout) → POST /api/payments/verify → balance credited
 * Exposed as an explicit state machine so the sheet renders precise states.
 */
export type TopUpStatus =
  | "idle"
  | "creating"
  | "processing"
  | "verifying"
  | "success"
  | "error";

export function useWalletPayment() {
  const queryClient = useQueryClient();
  const addMoney = useAddMoneyMutation();
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
      setLastAmount(amount);
      setError(null);
      setStatus("creating");
      try {
        const order = await addMoney.mutateAsync(amount);
        let settled = false;
        setStatus("processing");
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "Homeeigo Wallet",
          description: `Add ₹${amount.toLocaleString("en-IN")} to wallet`,
          onSuccess: async (payload) => {
            settled = true;
            try {
              setStatus("verifying");
              await coreApi.payments.verify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              await queryClient.invalidateQueries({ queryKey: qk.walletBalance });
              await queryClient.invalidateQueries({ queryKey: qk.walletTx });
              setStatus("success");
            } catch {
              setStatus("error");
              setError("Payment verification failed. If money was deducted, it will be auto-credited shortly.");
            }
          },
          onDismiss: () => {
            if (!settled) {
              setStatus("error");
              setError("Payment cancelled. No money was charged.");
            }
          },
          onFailure: (message) => {
            setStatus("error");
            setError(message);
          },
        });
      } catch {
        setStatus("error");
        setError("Could not start the payment. Please try again.");
      }
    },
    [busy, addMoney, openCheckout, queryClient],
  );

  return { topUp, reset, status, error, lastAmount, busy, isProcessing: busy };
}

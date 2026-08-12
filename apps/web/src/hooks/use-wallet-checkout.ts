"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { useAppStore } from "@/stores/app-store";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { getErrorMessage } from "@/lib/auth/errors";

export type CheckoutStatus = "idle" | "pending" | "processing" | "success" | "failed";

const PENDING_KEY = "homigo_pending_checkout_booking_id";
const setPending = (id: string) => typeof window !== "undefined" && window.localStorage.setItem(PENDING_KEY, id);
const clearPending = (id?: string) => {
  if (typeof window === "undefined") return;
  if (!id || window.localStorage.getItem(PENDING_KEY) === id) window.localStorage.removeItem(PENDING_KEY);
};
export const getPendingCheckoutBookingId = () =>
  typeof window === "undefined" ? null : window.localStorage.getItem(PENDING_KEY);

/** Live wallet-checkout quote for a booking (wallet balance, applicable, remainder). */
export function useCheckoutQuote(bookingId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["checkout-quote", bookingId],
    queryFn: () => coreApi.wallet.checkout.quote(bookingId!),
    enabled: Boolean(bookingId) && enabled,
    staleTime: 15_000,
  });
}

/**
 * Phase 18.4 — orchestrates the certified backend checkout:
 *  - useWallet=false  → full Razorpay (walletAmount 0)
 *  - wallet covers all → /checkout/pay (wallet-only)
 *  - otherwise         → /checkout/split/initiate → Razorpay(remainder) → /checkout/split/verify
 * Amounts are derived/validated by the backend; the client only sends the wallet portion it wants applied.
 */
export function useWalletCheckout() {
  const showToast = useAppStore((s) => s.showToast);
  const { openCheckout } = useRazorpayCheckout();
  const [status, setStatus] = useState<CheckoutStatus>("idle");

  const pay = useCallback(
    async (opts: {
      bookingId: string;
      useWallet: boolean;
      walletApplicable: number;
      fullyPayableFromWallet: boolean;
      description?: string;
      onSuccess?: () => void;
    }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        showToast("You are offline. Retry payment when online.", "error");
        return;
      }
      const walletAmount = opts.useWallet ? opts.walletApplicable : 0;
      setStatus("processing");
      setPending(opts.bookingId);
      try {
        // Wallet covers the whole booking → no gateway step.
        if (opts.useWallet && opts.fullyPayableFromWallet) {
          await coreApi.wallet.checkout.payFull(opts.bookingId);
          clearPending(opts.bookingId);
          setStatus("success");
          showToast("Paid from wallet", "success");
          opts.onSuccess?.();
          return;
        }

        const init = await coreApi.wallet.checkout.splitInitiate(opts.bookingId, walletAmount);
        if (init.mode === "wallet_only") {
          clearPending(opts.bookingId);
          setStatus("success");
          showToast("Paid from wallet", "success");
          opts.onSuccess?.();
          return;
        }

        // Razorpay leg for the remainder; wallet leg commits atomically on verify.
        setStatus("pending");
        await openCheckout({
          key: init.key,
          orderId: init.razorpayOrderId,
          amount: Math.round(init.razorpayAmount * 100),
          currency: "INR",
          name: "HOMEEIGO",
          description: opts.description ?? "Booking payment",
          onSuccess: async (payload) => {
            setStatus("processing");
            try {
              await coreApi.wallet.checkout.splitVerify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              clearPending(opts.bookingId);
              setStatus("success");
              showToast(walletAmount > 0 ? "Split payment successful" : "Payment successful", "success");
              opts.onSuccess?.();
            } catch (err) {
              setStatus("failed");
              showToast(getErrorMessage(err), "error");
            }
          },
          onDismiss: () => {
            setStatus("pending");
            showToast("Payment still pending. You can resume anytime.", "info");
          },
        });
      } catch (err) {
        setStatus("failed");
        showToast(getErrorMessage(err), "error");
      }
    },
    [openCheckout, showToast],
  );

  return { pay, status, getPendingCheckoutBookingId, clearPendingCheckout: clearPending };
}

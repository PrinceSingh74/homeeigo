"use client";

import { useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import {
  useCreatePaymentOrderMutation,
  useVerifyPaymentMutation,
} from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";

const PENDING_PAYMENT_KEY = "homigo_pending_payment_booking_id";

export function getPendingPaymentBookingId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PENDING_PAYMENT_KEY);
}

function setPendingPaymentBookingId(bookingId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_PAYMENT_KEY, bookingId);
}

function clearPendingPaymentBookingId(bookingId?: string) {
  if (typeof window === "undefined") return;
  if (!bookingId) {
    window.localStorage.removeItem(PENDING_PAYMENT_KEY);
    return;
  }
  if (window.localStorage.getItem(PENDING_PAYMENT_KEY) === bookingId) {
    window.localStorage.removeItem(PENDING_PAYMENT_KEY);
  }
}

export function useBookingPayment() {
  const showToast = useAppStore((s) => s.showToast);
  const createOrder = useCreatePaymentOrderMutation();
  const verifyPayment = useVerifyPaymentMutation();
  const { openCheckout } = useRazorpayCheckout();

  const payForBooking = useCallback(
    async (booking: {
      bookingId: string;
      amount?: number;
      description: string;
      onVerified?: () => void;
    }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        showToast("You are offline. Retry payment when online.", "error");
        return;
      }
      // Amount is derived by the backend from the booking — never sent by the
      // client (prevents tampering and duplicate price logic on the frontend).
      const order = await createOrder.mutateAsync({
        bookingId: booking.bookingId,
      });
      setPendingPaymentBookingId(booking.bookingId);
      await openCheckout({
        key: order.key,
        orderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        name: "HOMEEIGO",
        description: booking.description,
        onSuccess: async (payload) => {
          await verifyPayment.mutateAsync({
            razorpayOrderId: payload.razorpay_order_id,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          });
          clearPendingPaymentBookingId(booking.bookingId);
          booking.onVerified?.();
        },
        onDismiss: () => {
          showToast("Payment still pending. You can retry anytime.", "info");
        },
      });
    },
    [createOrder, openCheckout, showToast, verifyPayment],
  );

  return {
    payForBooking,
    getPendingPaymentBookingId,
    clearPendingPaymentBookingId,
    isProcessing: createOrder.isPending || verifyPayment.isPending,
  };
}

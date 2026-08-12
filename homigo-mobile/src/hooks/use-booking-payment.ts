import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useCreatePaymentOrderMutation,
  useVerifyPaymentMutation,
} from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";

const PENDING_PAYMENT_KEY = "homigo_pending_payment_booking_id";

export async function getPendingPaymentBookingId(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_PAYMENT_KEY);
}

async function setPendingPaymentBookingId(bookingId: string) {
  await AsyncStorage.setItem(PENDING_PAYMENT_KEY, bookingId);
}

async function clearPendingPaymentBookingId(bookingId?: string) {
  if (!bookingId) {
    await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
    return;
  }
  const current = await AsyncStorage.getItem(PENDING_PAYMENT_KEY);
  if (current === bookingId) await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
}

/**
 * Where the checkout currently is, so the caller can narrate it on the confirm
 * button instead of showing one opaque spinner across the whole sequence.
 */
export type BookingPaymentPhase = "creating-order" | "checkout" | "verifying";

/**
 * `paid` is the only outcome that means money moved AND the backend verified the
 * signature. `dismissed` (user closed Razorpay) and `failed` both leave the booking
 * confirmed but unpaid — callers must not present either as a completed payment.
 */
/** Settled payment state of a booking, as far as the UI needs to present it. */
export type BookingPaymentState = "paid" | "pending";

export type BookingPaymentResult =
  | { status: "paid" }
  | { status: "dismissed" }
  | { status: "failed"; message: string };

export function useBookingPayment() {
  const createOrder = useCreatePaymentOrderMutation();
  const verifyPayment = useVerifyPaymentMutation();
  const { openCheckout } = useRazorpayCheckout();

  const payForBooking = useCallback(
    async (booking: {
      bookingId: string;
      amount?: number;
      description: string;
      onPhase?: (phase: BookingPaymentPhase) => void;
      onVerified?: () => void;
    }): Promise<BookingPaymentResult> => {
      // Amount is derived by the backend from the booking — never sent by the
      // client (prevents tampering and duplicate price logic on the frontend).
      booking.onPhase?.("creating-order");
      const order = await createOrder.mutateAsync({
        bookingId: booking.bookingId,
      });
      await setPendingPaymentBookingId(booking.bookingId);

      let result: BookingPaymentResult = {
        status: "failed",
        message: "Payment could not be completed.",
      };

      booking.onPhase?.("checkout");
      try {
        await openCheckout({
          key: order.key,
          orderId: order.razorpayOrderId,
          amount: order.amount,
          currency: order.currency,
          name: "Homeeigo",
          description: booking.description,
          checkoutMode: (order as { checkoutMode?: "razorpay" | "dev_mock" }).checkoutMode,
          onSuccess: async (payload) => {
            booking.onPhase?.("verifying");
            await verifyPayment.mutateAsync({
              razorpayOrderId: payload.razorpay_order_id,
              razorpayPaymentId: payload.razorpay_payment_id,
              razorpaySignature: payload.razorpay_signature,
            });
            await clearPendingPaymentBookingId(booking.bookingId);
            result = { status: "paid" };
            booking.onVerified?.();
          },
          onDismiss: () => {
            result = { status: "dismissed" };
          },
          onFailure: (message) => {
            result = { status: "failed", message };
          },
        });
      } catch {
        // openCheckout re-throws after reporting through onFailure — the outcome is
        // already captured above, and an unpaid booking is a state, not a crash.
      }

      return result;
    },
    [createOrder, openCheckout, verifyPayment],
  );

  return {
    payForBooking,
    getPendingPaymentBookingId,
    clearPendingPaymentBookingId,
    isProcessing: createOrder.isPending || verifyPayment.isPending,
  };
}

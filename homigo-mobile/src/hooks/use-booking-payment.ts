import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { coreApi } from "@/services/core/api";
import { parityApi } from "@/services/core/parity-api";
import { qk } from "@/hooks/use-core-data";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { AuthApiError, getErrorMessage } from "@/lib/auth/errors";
import type { RazorpaySuccessPayload } from "@/lib/razorpay-checkout-shared";

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

/** Settled payment state of a booking, as far as the UI needs to present it. */
export type BookingPaymentState = "paid" | "pending";

/**
 * `paid` is the only outcome that means money moved AND the backend verified it. `dismissed`
 * (user closed Razorpay) and `failed` both leave the booking unpaid — callers must not present
 * either as a completed payment. `code` is the server's error code when there is one.
 */
export type BookingPaymentResult =
  | { status: "paid"; note?: string }
  | { status: "dismissed" }
  | { status: "failed"; message: string; code?: string };

/** Server error codes of the booking payment endpoints → what the customer should be told. */
const PAYMENT_ERROR_COPY: Record<string, string> = {
  BOOKING_NOT_PAYABLE: "This booking was cancelled, so it can no longer be paid.",
  INSUFFICIENT_WALLET_BALANCE:
    "Your wallet balance is no longer enough for this. Turn off “Use wallet” to pay by card/UPI.",
  WALLET_DEBIT_FAILED:
    "Your wallet couldn't be debited, so the card/UPI part of this payment is being refunded to you. Nothing was taken from your wallet — please try again.",
  INVALID_SIGNATURE:
    "We couldn't confirm this payment. If money was deducted, it will show on your booking once the bank confirms it — please don't pay twice.",
  INVALID_AMOUNT: "The wallet amount changed — please try again.",
  NOT_FOUND: "This booking could not be found.",
  BOOKING_NOT_FOUND: "This booking could not be found.",
};

export function paymentErrorMessage(error: unknown, fallback = "Payment could not be completed."): string {
  if (error instanceof AuthApiError && error.code && PAYMENT_ERROR_COPY[error.code]) {
    return PAYMENT_ERROR_COPY[error.code]!;
  }
  return getErrorMessage(error, fallback);
}

function failure(error: unknown, fallback?: string): BookingPaymentResult {
  return {
    status: "failed",
    message: paymentErrorMessage(error, fallback),
    code: error instanceof AuthApiError ? error.code : undefined,
  };
}

const ALREADY_PAID_NOTE =
  "This booking was already paid. If you were charged again, contact support with your payment id.";

export function useBookingPayment() {
  const queryClient = useQueryClient();
  const { openCheckout } = useRazorpayCheckout();

  const refreshMoneyViews = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.bookings });
    void queryClient.invalidateQueries({ queryKey: qk.walletBalance });
    void queryClient.invalidateQueries({ queryKey: qk.walletTx });
  }, [queryClient]);

  /**
   * Opens Razorpay for an order and reports the outcome. Success is reported ONLY after the
   * server-side verify call succeeded; a gateway success with a failed verify is a failure.
   */
  const runGateway = useCallback(
    async (opts: {
      bookingId: string;
      order: { key?: string; orderId: string; amountPaise: number; currency: string; checkoutMode?: "razorpay" | "dev_mock" };
      description: string;
      verify: (payload: RazorpaySuccessPayload) => Promise<BookingPaymentResult>;
      onPhase?: (phase: BookingPaymentPhase) => void;
    }): Promise<BookingPaymentResult> => {
      // Held in an object: the callbacks below assign it, which TS flow analysis cannot see.
      const out: { result: BookingPaymentResult | null } = { result: null };
      opts.onPhase?.("checkout");
      try {
        await openCheckout({
          key: opts.order.key,
          orderId: opts.order.orderId,
          amount: opts.order.amountPaise,
          currency: opts.order.currency,
          name: "Homeeigo",
          description: opts.description,
          checkoutMode: opts.order.checkoutMode,
          onSuccess: async (payload) => {
            opts.onPhase?.("verifying");
            out.result = await opts.verify(payload);
          },
          onDismiss: () => {
            out.result = { status: "dismissed" };
          },
          onFailure: (message) => {
            out.result = {
              status: "failed",
              message: message ? `Payment failed: ${message}` : "Payment failed. You can retry from your bookings.",
            };
          },
        });
      } catch (error) {
        // openCheckout re-throws after onFailure; the dev-mock / module-load paths throw without it.
        if (!out.result) out.result = failure(error, "Payment could not be started. You can pay later from your bookings.");
      }
      if (out.result?.status === "paid") {
        await clearPendingPaymentBookingId(opts.bookingId);
        refreshMoneyViews();
      }
      return out.result ?? { status: "failed", message: "Payment was not completed." };
    },
    [openCheckout, refreshMoneyViews],
  );

  /** Full card/UPI payment through POST /api/payments/create-order → Razorpay → /verify. */
  const payForBooking = useCallback(
    async (booking: {
      bookingId: string;
      description: string;
      onPhase?: (phase: BookingPaymentPhase) => void;
    }): Promise<BookingPaymentResult> => {
      // The backend derives the amount from the booking; the client never sends one.
      booking.onPhase?.("creating-order");
      let order: Awaited<ReturnType<typeof coreApi.payments.createOrder>>;
      try {
        order = await coreApi.payments.createOrder(booking.bookingId);
      } catch (error) {
        return failure(error, "Could not start payment. You can pay later from your bookings.");
      }
      await setPendingPaymentBookingId(booking.bookingId);
      return runGateway({
        bookingId: booking.bookingId,
        order: {
          key: order.key,
          orderId: order.razorpayOrderId,
          amountPaise: order.amount,
          currency: order.currency,
          checkoutMode: (order as { checkoutMode?: "razorpay" | "dev_mock" }).checkoutMode,
        },
        description: booking.description,
        onPhase: booking.onPhase,
        verify: async (payload) => {
          try {
            await coreApi.payments.verify({
              razorpayOrderId: payload.razorpay_order_id,
              razorpayPaymentId: payload.razorpay_payment_id,
              razorpaySignature: payload.razorpay_signature,
            });
            return { status: "paid" };
          } catch (error) {
            // Order already captured by ANOTHER payment id: the booking is paid, this charge is extra.
            if (error instanceof AuthApiError && error.code === "ALREADY_SETTLED") {
              return { status: "paid", note: ALREADY_PAID_NOTE };
            }
            return failure(error);
          }
        },
      });
    },
    [runGateway],
  );

  /**
   * Wallet-first checkout (POST /api/wallet/checkout/*): wallet covers all → /pay; otherwise
   * /split/initiate (wallet leg reserved) → Razorpay for the remainder → /split/verify.
   * Every amount comes from the server's checkout quote for this booking.
   */
  const payWithWallet = useCallback(
    async (booking: {
      bookingId: string;
      description: string;
      onPhase?: (phase: BookingPaymentPhase) => void;
    }): Promise<BookingPaymentResult> => {
      booking.onPhase?.("creating-order");
      try {
        const quote = await parityApi.wallet.checkoutQuote(booking.bookingId);
        if (quote.alreadyPaid) {
          refreshMoneyViews();
          return { status: "paid" };
        }
        if (quote.walletApplicable <= 0) {
          // Nothing in the wallet to apply — plain card/UPI checkout.
          return payForBooking(booking);
        }
        if (quote.fullyPayableFromWallet) {
          await parityApi.wallet.checkoutPay(booking.bookingId);
          refreshMoneyViews();
          return { status: "paid" };
        }
        const init = await parityApi.wallet.splitInitiate(booking.bookingId, quote.walletApplicable);
        if (init.mode === "wallet_only") {
          refreshMoneyViews();
          return { status: "paid" };
        }
        await setPendingPaymentBookingId(booking.bookingId);
        return runGateway({
          bookingId: booking.bookingId,
          order: {
            key: init.key,
            orderId: init.razorpayOrderId,
            amountPaise: Math.round(init.razorpayAmount * 100),
            currency: "INR",
          },
          description: booking.description,
          onPhase: booking.onPhase,
          verify: async (payload) => {
            try {
              await parityApi.wallet.splitVerify({
                razorpayOrderId: payload.razorpay_order_id,
                razorpayPaymentId: payload.razorpay_payment_id,
                razorpaySignature: payload.razorpay_signature,
              });
              return { status: "paid" };
            } catch (error) {
              if (error instanceof AuthApiError && error.code === "ALREADY_SETTLED") {
                return { status: "paid", note: ALREADY_PAID_NOTE };
              }
              refreshMoneyViews();
              return failure(error);
            }
          },
        });
      } catch (error) {
        if (error instanceof AuthApiError && error.code === "ALREADY_PAID") {
          refreshMoneyViews();
          return { status: "paid" };
        }
        return failure(error, "Could not start the wallet payment. You can pay later from your bookings.");
      }
    },
    [payForBooking, refreshMoneyViews, runGateway],
  );

  return {
    payForBooking,
    payWithWallet,
    getPendingPaymentBookingId,
    clearPendingPaymentBookingId,
  };
}

/**
 * Pure and import-free on purpose: the refund services use it, and so does the live-closure
 * script's dry run, which must not load anything capable of writing.
 */

/**
 * ── Refund tender follows how the money ARRIVED, never the payment-method label ────────────────
 *
 * `payments.payment_method` is a label. Booking create accepts any string from the client,
 * `createOrder` copies the booking's label onto the payments row, and the refund paths used to route
 * on it: a booking created with the label "wallet" and then paid through the gateway was refunded as
 * in-app wallet credit. The customer's money never went back to its source, and the ledger moved
 * PLATFORM_ESCROW for funds that had arrived as CUSTOMER_FUNDS.
 *
 * What a payments row can PROVE is a gateway payment id. The wallet checkout writes no payments row
 * at all (`payBookingFromWallet`), so a row carrying one was captured by the gateway, whatever it is
 * labelled. The wallet path therefore runs only for a wallet-labelled row with no gateway payment —
 * and if such a row turns out to have been a gateway payment after all, the gateway rejects the
 * refund and the request is recorded FAILED: visible, and nothing minted.
 */
const GATEWAY_PAYMENT_ID = /^pay_/;

export type TenderEvidence = { paymentMethod: string; razorpayPaymentId: string | null };

export function arrivedThroughGateway(payment: Pick<TenderEvidence, "razorpayPaymentId"> | null | undefined): boolean {
  return Boolean(payment?.razorpayPaymentId && GATEWAY_PAYMENT_ID.test(payment.razorpayPaymentId));
}

/** True only for a wallet-labelled payments row that no gateway captured. */
export function isWalletTender(payment: TenderEvidence): boolean {
  return payment.paymentMethod.toLowerCase() === "wallet" && !arrivedThroughGateway(payment);
}

/**
 * The payment method a cancellation QUOTE should describe. It drives `refundMethodHint`, which is
 * what the customer is told before they cancel — "instant, to your wallet" or "5–7 days, to your
 * bank" — so it has to describe the refund that will actually be made.
 */
export function refundTenderLabel(payment: TenderEvidence | null | undefined, bookingPaymentMethod: string | null): string | null {
  if (!payment) return bookingPaymentMethod;
  if (payment.paymentMethod.toLowerCase() === "wallet" && arrivedThroughGateway(payment)) return "razorpay";
  return payment.paymentMethod;
}

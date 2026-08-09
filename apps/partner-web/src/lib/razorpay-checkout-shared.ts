/**
 * Shared Razorpay checkout helpers for web + React Native.
 * Fixes dev `order_dev_*` orders being sent to the live gateway (causes
 * "Payment could not be completed due to a temporary technical issue").
 */

export type RazorpaySuccessPayload = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export function isDevRazorpayOrder(orderId: string) {
  return orderId.startsWith("order_dev_");
}

export function shouldUseDevMockCheckout(orderId: string, key?: string | null) {
  if (isDevRazorpayOrder(orderId)) return true;
  return !key?.trim();
}

export async function completeDevMockCheckout(
  apiBase: string,
  orderId: string,
  onSuccess: (payload: RazorpaySuccessPayload) => void | Promise<void>,
) {
  const paymentId = `pay_dev_${Date.now().toString(36)}`;
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/payments/e2e/mock-signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId }),
  });
  const json = (await res.json()) as { success?: boolean; data?: { razorpaySignature?: string }; error?: string };
  if (!res.ok || !json.success || !json.data?.razorpaySignature) {
    throw new Error(json.error ?? "Dev payment simulation failed. Is the backend running?");
  }
  await onSuccess({
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: json.data.razorpaySignature,
  });
}

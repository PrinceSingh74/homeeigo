/**
 * What a failed native Razorpay checkout actually was.
 *
 * react-native-razorpay rejects with a PLAIN OBJECT `{ code, description, ... }` — not an Error — and
 * `description` is often a JSON string such as `{"error":{"description":"…cancelled by user","reason":
 * "payment_cancelled"}}`. `String(error)` of that object is "[object Object]", which is what the
 * booking screen showed after a customer closed the checkout ("Payment failed: [object Object]").
 *
 * The cancel code is platform-specific: Android `Checkout.PAYMENT_CANCELED = 0` (and `2` is
 * `NETWORK_ERROR` there — standard-core 1.7.1), iOS `2` = payment cancelled.
 */
export type CheckoutErrorInfo = {
  /** Human-readable reason, "" when the SDK gave none. */
  message: string;
  code: string;
  /** The customer closed the checkout — nothing was charged. */
  cancelled: boolean;
};

type InnerError = { description?: unknown; reason?: unknown };

function parseInner(description: string): InnerError | null {
  const trimmed = description.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { error?: InnerError } & InnerError;
    return parsed.error && typeof parsed.error === "object" ? parsed.error : parsed;
  } catch {
    return null;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function describeCheckoutError(error: unknown, platform: string): CheckoutErrorInfo {
  let message = "";
  let code = "";
  let reason = "";
  if (error && typeof error === "object" && "code" in error) {
    const raw = (error as { code?: unknown }).code;
    if (raw !== undefined && raw !== null) code = String(raw);
  }
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    const e = error as { description?: unknown; error?: unknown };
    const description = text(e.description);
    const inner = parseInner(description) ?? (e.error && typeof e.error === "object" ? (e.error as InnerError) : null);
    message = text(inner?.description) || (inner ? "" : description);
    reason = text(inner?.reason);
  }
  const cancelCode = platform === "android" ? "0" : platform === "ios" ? "2" : "";
  const cancelled = /cancel/i.test(message) || /cancel/i.test(reason) || (cancelCode !== "" && code === cancelCode);
  return { message: message.trim(), code, cancelled };
}

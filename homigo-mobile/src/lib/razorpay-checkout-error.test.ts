/**
 * The native checkout's rejection is a plain object on both platforms. Seen on the Android emulator
 * (2026-09-28): closing the Razorpay TEST checkout ("Yes, exit") left the booking sheet reading
 * "Payment failed: [object Object]" instead of "Payment cancelled — nothing was charged".
 */
import { describe, expect, test } from "bun:test";
import { describeCheckoutError } from "./razorpay-checkout-error";

const androidCancel = {
  code: 0,
  description: JSON.stringify({
    error: {
      code: "BAD_REQUEST_ERROR",
      description: "Payment processing cancelled by user",
      source: "customer",
      step: "payment_authentication",
      reason: "payment_cancelled",
    },
  }),
};

describe("describeCheckoutError", () => {
  test("Android cancel (code 0, JSON description) is a cancel with a readable message — never [object Object]", () => {
    const info = describeCheckoutError(androidCancel, "android");
    expect(info.cancelled).toBe(true);
    expect(info.message).toBe("Payment processing cancelled by user");
    expect(info.message).not.toContain("[object");
  });

  test("Android code 0 with a plain description is still a cancel (PAYMENT_CANCELED = 0)", () => {
    expect(describeCheckoutError({ code: 0, description: "Payment Cancelled" }, "android").cancelled).toBe(true);
    expect(describeCheckoutError({ code: 0, description: "" }, "android").cancelled).toBe(true);
  });

  test("Android code 2 is NETWORK_ERROR — a failure with its reason, not a cancel", () => {
    const info = describeCheckoutError({ code: 2, description: "Network error occurred" }, "android");
    expect(info.cancelled).toBe(false);
    expect(info.message).toBe("Network error occurred");
  });

  test("iOS code 2 is the cancel code", () => {
    expect(describeCheckoutError({ code: 2, description: "Payment cancelled by user" }, "ios").cancelled).toBe(true);
    expect(describeCheckoutError({ code: 2, description: "" }, "ios").cancelled).toBe(true);
  });

  test("a declined payment keeps the gateway's reason for the failure message", () => {
    const info = describeCheckoutError(
      { code: 1, description: JSON.stringify({ error: { description: "Your payment was declined by the bank", reason: "payment_failed" } }) },
      "android",
    );
    expect(info.cancelled).toBe(false);
    expect(info.message).toBe("Your payment was declined by the bank");
  });

  test("an Error and a bare string are read as before", () => {
    expect(describeCheckoutError(new Error("module not linked"), "android")).toEqual({ message: "module not linked", code: "", cancelled: false });
    expect(describeCheckoutError("Payment cancelled", "ios").cancelled).toBe(true);
  });

  test("an object with no usable text yields an empty message (the caller shows its generic fallback)", () => {
    const info = describeCheckoutError({ code: 7, description: "{}" }, "android");
    expect(info).toEqual({ message: "", code: "7", cancelled: false });
  });
});

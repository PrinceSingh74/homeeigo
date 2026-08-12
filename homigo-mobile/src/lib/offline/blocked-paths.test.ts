import { describe, expect, test } from "bun:test";
import { assertOfflineSafePath, isOfflineBlockedPath, OfflinePaymentBlockedError } from "./blocked-paths";

describe("offline blocked paths (payment safety)", () => {
  test("blocks wallet top-up", () => {
    expect(isOfflineBlockedPath("/api/wallet/add-money")).toBe(true);
    expect(() => assertOfflineSafePath("/api/wallet/add-money")).toThrow(OfflinePaymentBlockedError);
  });

  test("blocks payment create-order and verify", () => {
    expect(isOfflineBlockedPath("/api/payments/create-order")).toBe(true);
    expect(isOfflineBlockedPath("/api/payments/verify")).toBe(true);
  });

  test("blocks subscription payment flows", () => {
    expect(isOfflineBlockedPath("/api/subscriptions/order")).toBe(true);
    expect(isOfflineBlockedPath("/api/subscriptions/verify")).toBe(true);
  });

  test("blocks wallet checkout and withdraw", () => {
    expect(isOfflineBlockedPath("/api/wallet/checkout/pay")).toBe(true);
    expect(isOfflineBlockedPath("/api/wallet/withdraw")).toBe(true);
  });

  test("allows safe offline mutations", () => {
    expect(isOfflineBlockedPath("/api/bookings")).toBe(false);
    expect(isOfflineBlockedPath("/api/users/addresses")).toBe(false);
    expect(isOfflineBlockedPath("/api/notifications/abc/read")).toBe(false);
    expect(() => assertOfflineSafePath("/api/bookings")).not.toThrow();
  });
});

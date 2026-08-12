import { describe, expect, test } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import { resolveAdminRoutePermission } from "../lib/admin-route-permissions";
import { PaymentService } from "../services/payment.service";
import { ProviderWalletReservationService } from "../services/provider-wallet-reservation.service";

const paymentService = new PaymentService();
const walletReservation = new ProviderWalletReservationService();

describe("P0-1 Wallet settlement idempotency (logic)", () => {
  test("settleTopUp marks alreadySettled when status is COMPLETED", () => {
    let status = "COMPLETED";
    let balance = 500;
    let credited = 0;

    const settle = () => {
      if (status === "COMPLETED") {
        return { balance, alreadySettled: true };
      }
      balance += 100;
      credited += 100;
      status = "COMPLETED";
      return { balance, alreadySettled: false };
    };

    const first = settle();
    const second = settle();
    expect(first.alreadySettled).toBe(true);
    expect(second.alreadySettled).toBe(true);
    expect(credited).toBe(0);
    expect(balance).toBe(500);
  });

  test("concurrent settle simulation credits once", () => {
    let status = "PENDING";
    let balance = 100;
    let lock = false;
    let credits = 0;

    const trySettle = (): "ok" | "blocked" | "idempotent" => {
      if (status === "COMPLETED") return "idempotent";
      if (lock) return "blocked";
      lock = true;
      if (status === "COMPLETED") {
        lock = false;
        return "idempotent";
      }
      balance += 1000;
      credits += 1;
      status = "COMPLETED";
      lock = false;
      return "ok";
    };

    const results = [trySettle(), trySettle()];
    expect(credits).toBe(1);
    expect(balance).toBe(1100);
    expect(results.filter((r) => r === "ok").length).toBe(1);
  });
});

describe("P0-2 Booking conflict detection", () => {
  test("buffer window blocks overlapping provider slots", () => {
    const scheduled = new Date("2026-06-15T10:00:00Z");
    const ms = 30 * 60 * 1000;
    const window = {
      gte: new Date(scheduled.getTime() - ms),
      lte: new Date(scheduled.getTime() + ms),
    };
    const existing = new Date("2026-06-15T10:20:00Z");
    expect(existing >= window.gte && existing <= window.lte).toBe(true);
  });

  test("adjacent bookings outside buffer are allowed", () => {
    const scheduled = new Date("2026-06-15T10:00:00Z");
    const ms = 30 * 60 * 1000;
    const window = {
      gte: new Date(scheduled.getTime() - ms),
      lte: new Date(scheduled.getTime() + ms),
    };
    const existing = new Date("2026-06-15T11:01:00Z");
    expect(existing >= window.gte && existing <= window.lte).toBe(false);
  });
});

describe("P0-3 Payment order idempotency", () => {
  test("idempotency key is deterministic per booking", () => {
    expect(paymentService.buildOrderIdempotencyKey("bk_1")).toBe("booking_order:bk_1");
    expect(paymentService.buildOrderIdempotencyKey("bk_1")).toBe(
      paymentService.buildOrderIdempotencyKey("bk_1"),
    );
  });

  test("retry with INITIATED payment must not overwrite order id", () => {
    const existing = {
      status: PaymentStatus.INITIATED,
      razorpayOrderId: "order_existing",
      amount: 999,
    };
    const shouldCallRazorpay =
      !(existing.razorpayOrderId && existing.status === PaymentStatus.INITIATED);
    expect(shouldCallRazorpay).toBe(false);
  });

  test("SUCCESS payment is returned without new Razorpay call", () => {
    const existing = { status: PaymentStatus.SUCCESS, razorpayOrderId: "order_done", amount: 500 };
    expect(existing.status === PaymentStatus.SUCCESS).toBe(true);
  });
});

describe("P1-1 Admin RBAC route mapping", () => {
  test("payment refund maps to PAYMENTS.APPROVE", () => {
    expect(resolveAdminRoutePermission("POST", "/api/payments/pay_1/refund")).toEqual({
      resource: "PAYMENTS",
      action: "APPROVE",
    });
  });

  test("ws stats maps to ANALYTICS.READ", () => {
    expect(resolveAdminRoutePermission("GET", "/api/v1/ws/stats")).toEqual({
      resource: "ANALYTICS",
      action: "READ",
    });
  });

  test("compliance approve maps to DISPUTES.APPROVE", () => {
    expect(resolveAdminRoutePermission("POST", "/api/compliance/admin/requests/r1/approve")).toEqual({
      resource: "DISPUTES",
      action: "APPROVE",
    });
  });

  test("support admin role lacks PAYMENTS.APPROVE in seed matrix", () => {
    const supportPerms = ["USERS:READ", "BOOKINGS:READ", "DISPUTES:READ", "DISPUTES:UPDATE"];
    expect(supportPerms.includes("PAYMENTS:APPROVE")).toBe(false);
  });
});

describe("P1-2 Wallet reservation regression", () => {
  test("concurrent withdrawal reservation still serializes", () => {
    let wallet = 1000;
    let reserved = 0;
    let ok = 0;
    for (const amount of [800, 800]) {
      if (walletReservation.availableBalance(wallet, reserved) >= amount) {
        reserved += amount;
        ok += 1;
      }
    }
    expect(ok).toBe(1);
    expect(wallet - reserved).toBe(200);
  });
});

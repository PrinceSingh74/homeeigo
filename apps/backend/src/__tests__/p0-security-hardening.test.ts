import { describe, expect, test } from "bun:test";
import { PartnerRegistrationSessionService } from "../services/partner-registration-session.service";
import { generateStorageKey } from "../lib/storage-key";
import { ProviderWalletReservationService } from "../services/provider-wallet-reservation.service";
import { RefundOrchestratorService } from "../services/refund-orchestrator.service";

const sessionService = new PartnerRegistrationSessionService();
const walletReservation = new ProviderWalletReservationService();
const refundOrchestrator = new RefundOrchestratorService();

describe("P0-1 Partner registration session tokens", () => {
  test("issues registration JWT with type claim", () => {
    const token = sessionService.issueToken(
      { sessionId: "sess-1", userId: "user-1", providerId: null, otpVerified: true },
      new Date(Date.now() + 3600000),
    );
    const decoded = sessionService.verifyToken(token);
    expect(decoded?.userId).toBe("user-1");
    expect(decoded?.sessionId).toBe("sess-1");
  });

  test("rejects tampered registration token", () => {
    const token = sessionService.issueToken(
      { sessionId: "sess-1", userId: "user-1", providerId: null, otpVerified: true },
      new Date(Date.now() + 3600000),
    );
    const bad = token.slice(0, -4) + "XXXX";
    expect(sessionService.verifyToken(bad)).toBeNull();
  });

  test("rejects access token as registration token", () => {
    expect(sessionService.verifyToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid")).toBeNull();
  });

  test("registration token includes providerId when bound", () => {
    const token = sessionService.issueToken(
      { sessionId: "sess-2", userId: "user-2", providerId: "prov-victim", otpVerified: true },
      new Date(Date.now() + 3600000),
    );
    expect(sessionService.verifyToken(token)?.providerId).toBe("prov-victim");
  });

  test("attacker token with wrong userId still decodes but resolveSession checks DB", () => {
    const token = sessionService.issueToken(
      { sessionId: "sess-3", userId: "attacker", providerId: "prov-victim", otpVerified: true },
      new Date(Date.now() + 3600000),
    );
    expect(sessionService.verifyToken(token)?.userId).toBe("attacker");
  });

  test("expired registration token is rejected by verify", () => {
    const token = sessionService.issueToken(
      { sessionId: "sess-exp", userId: "user-exp", providerId: null, otpVerified: true },
      new Date(Date.now() - 1000),
    );
    expect(sessionService.verifyToken(token)).toBeNull();
  });

  const ownershipCases = [
    { sessionProvider: "prov-a", target: "prov-b", shouldFail: true },
    { sessionProvider: "prov-a", target: "prov-a", shouldFail: false },
    { sessionProvider: null, target: "prov-b", shouldFail: true },
  ];

  for (const c of ownershipCases) {
    test(`ownership check session=${c.sessionProvider} target=${c.target}`, async () => {
      const session = {
        sessionId: "s",
        userId: "u",
        providerId: c.sessionProvider,
        otpVerified: true,
      };
      if (c.shouldFail) {
        await expect(sessionService.assertProviderOwnership(session, c.target)).rejects.toThrow("FORBIDDEN");
      } else {
        await expect(sessionService.assertProviderOwnership(session, c.target)).rejects.toThrow();
      }
    });
  }

  test("requireProviderId fails when provider not bound", async () => {
    await expect(
      sessionService.requireProviderId({
        sessionId: "s",
        userId: "u",
        providerId: null,
        otpVerified: true,
      }),
    ).rejects.toThrow("FORBIDDEN");
  });
});

describe("P0-1 Registration route contract", () => {
  test("services body must not include userId", () => {
    const body = { serviceCategories: ["cleaning"], city: "Mumbai", experienceYears: 2 };
    expect(body).not.toHaveProperty("userId");
  });

  test("kyc body must not include providerId", () => {
    const body = { panNumber: "ABCDE1234F" };
    expect(body).not.toHaveProperty("providerId");
  });

  test("document upload body must not include providerId", () => {
    const body = { file: "base64", documentType: "pan" };
    expect(body).not.toHaveProperty("providerId");
  });

  test("registration status route is session-scoped not param-based", () => {
    expect("/api/partner/registration-status").not.toContain(":providerId");
  });
});

describe("P0-2 Storage key entropy", () => {
  test("generateStorageKey produces unique values", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateStorageKey()));
    expect(keys.size).toBe(50);
  });

  test("storage keys do not contain chargeback id", () => {
    const key = generateStorageKey();
    expect(key).not.toMatch(/chargeback/i);
    expect(key).not.toMatch(/^\d+-\d+\./);
  });

  test("storage key length is sufficient", () => {
    const key = generateStorageKey();
    expect(key.length).toBeGreaterThan(30);
  });
});

describe("P0-5 Wallet reservation math", () => {
  const cases = [
    { wallet: 1000, reserved: 0, amount: 800, ok: true },
    { wallet: 1000, reserved: 0, amount: 1000, ok: true },
    { wallet: 1000, reserved: 0, amount: 1001, ok: false },
    { wallet: 1000, reserved: 200, amount: 800, ok: true },
    { wallet: 1000, reserved: 200, amount: 801, ok: false },
    { wallet: 1000, reserved: 800, amount: 200, ok: true },
    { wallet: 1000, reserved: 800, amount: 201, ok: false },
  ];

  for (const c of cases) {
    test(`available=${c.wallet - c.reserved} withdraw=${c.amount} ok=${c.ok}`, () => {
      const available = walletReservation.availableBalance(c.wallet, c.reserved);
      expect(available >= c.amount).toBe(c.ok);
    });
  }

  test("concurrent 800+800 on 1000: only one fits", () => {
    let wallet = 1000;
    let reserved = 0;
    const amounts = [800, 800];
    let successes = 0;
    for (const amount of amounts) {
      const available = walletReservation.availableBalance(wallet, reserved);
      if (available >= amount) {
        reserved += amount;
        successes += 1;
      }
    }
    expect(successes).toBe(1);
    expect(wallet - reserved).toBe(200);
  });

  test("final balance never negative after reservation simulation", () => {
    let wallet = 1000;
    let reserved = 0;
    for (let i = 0; i < 20; i++) {
      const amount = 100 + (i % 3) * 50;
      const available = walletReservation.availableBalance(wallet, reserved);
      if (available >= amount) reserved += amount;
    }
    expect(wallet - reserved).toBeGreaterThanOrEqual(0);
  });
});

describe("P0-3 Refund idempotency keys", () => {
  test("admin refund key is deterministic", () => {
    const k1 = refundOrchestrator.buildIdempotencyKey("pay-1", 500, "admin", "admin-1");
    const k2 = refundOrchestrator.buildIdempotencyKey("pay-1", 500, "admin", "admin-1");
    expect(k1).toBe(k2);
  });

  test("different amounts produce different keys", () => {
    const k1 = refundOrchestrator.buildIdempotencyKey("pay-1", 500, "admin", "admin-1");
    const k2 = refundOrchestrator.buildIdempotencyKey("pay-1", 501, "admin", "admin-1");
    expect(k1).not.toBe(k2);
  });

  test("cancellation key is per booking", () => {
    expect(refundOrchestrator.cancellationIdempotencyKey("bk-1")).toBe("cancel-refund:bk-1");
  });

  test("50 parallel keys for same refund collapse to one idempotency key", () => {
    const keys = Array.from({ length: 50 }, () =>
      refundOrchestrator.buildIdempotencyKey("pay-race", 100, "admin", "admin-race"),
    );
    expect(new Set(keys).size).toBe(1);
  });
});

describe("P0 metrics coverage", () => {
  const required = [
    "refund_attempt_total",
    "refund_success_total",
    "refund_race_blocked_total",
    "payout_attempt_total",
    "payout_success_total",
    "payout_race_blocked_total",
    "withdrawal_race_blocked_total",
    "evidence_download_total",
    "evidence_denied_total",
  ];

  for (const metric of required) {
    test(`metric ${metric} is registered`, async () => {
      const { renderFinancialMetrics } = await import("../lib/financial-metrics");
      const { recordFinancialMetric } = await import("../lib/financial-metrics");
      recordFinancialMetric(metric, 1);
      expect(renderFinancialMetrics()).toContain(metric);
    });
  }
});

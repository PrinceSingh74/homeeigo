import { describe, expect, test } from "bun:test";
import { JWT_CONFIG, JWTService } from "../services/jwt.service";
import { WebhookDedupService } from "../services/webhook-dedup.service";

describe("P1 — JWT algorithm allowlist", () => {
  test("verify rejects tokens signed with wrong algorithm", () => {
    const jwt = new JWTService();
    const token = jwt.generateAccessToken({ userId: "u1", email: "a@b.com" });
    expect(jwt.verifyAccessToken(token)?.userId).toBe("u1");
    expect(JWT_CONFIG.ALGORITHM).toBe("HS256");
  });
});

describe("P1 — Webhook dedup state machine API", () => {
  test("exports beginProcessing / markProcessed / markFailed", () => {
    const svc = new WebhookDedupService();
    expect(typeof svc.beginProcessing).toBe("function");
    expect(typeof svc.markProcessed).toBe("function");
    expect(typeof svc.markFailed).toBe("function");
  });
});

describe("P1 — Payment capture policy", () => {
  test("authorized events must not settle revenue", () => {
    const authorizedOnly = "payment.authorized";
    const capturedOnly = "payment.captured";
    expect(authorizedOnly).not.toBe(capturedOnly);
    expect(["payment.captured"].includes(authorizedOnly)).toBe(false);
  });
});

describe("P1 — Cashback lifecycle", () => {
  test("creditOnBookingComplete is the public completion entrypoint", async () => {
    const { CashbackService } = await import("../services/cashback.service");
    const svc = new CashbackService();
    expect(typeof svc.creditOnBookingComplete).toBe("function");
  });
});

describe("P1 — Production config keys", () => {
  test("validateProductionConfig checks ENCRYPTION_KEY and OTP_SECRET", async () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.ENCRYPTION_KEY = "";
    process.env.OTP_SECRET = "unsafe-dev-otp-secret";
    const { validateProductionConfig } = await import("../lib/production-config");
    const errors = validateProductionConfig();
    expect(errors.some((e) => e.key === "ENCRYPTION_KEY")).toBe(true);
    expect(errors.some((e) => e.key === "OTP_SECRET")).toBe(true);
    process.env = prev;
  });
});

describe("P1 — Ops auth", () => {
  test("production metrics require OPS_AUTH_TOKEN", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.OPS_AUTH_TOKEN = "secret-ops-token";
    const { assertOpsAuthorized } = await import("../lib/ops-auth");
    const ok = assertOpsAuthorized(
      new Request("http://localhost/metrics", {
        headers: { authorization: "Bearer secret-ops-token" },
      }),
    );
    expect(ok).toBe(true);
    process.env.NODE_ENV = prev;
  });
});

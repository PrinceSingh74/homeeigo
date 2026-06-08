import { afterAll, describe, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS, ACCOUNT_DELETION_RESTORE_DAYS } from "../lib/legal-policy";
import { validateProductionConfig } from "../lib/production-config";
import { buildStoredZip } from "../lib/simple-zip";
import { registerSchema } from "../schemas/auth.schema";

describe("Phase 1 — consent versioning", () => {
  test("all policy types have current version", () => {
    expect(CURRENT_POLICY_VERSIONS.TERMS).toBeTruthy();
    expect(CURRENT_POLICY_VERSIONS.PRIVACY).toBeTruthy();
    expect(CURRENT_POLICY_VERSIONS.COOKIES).toBeTruthy();
    expect(CURRENT_POLICY_VERSIONS.REFUND).toBeTruthy();
  });

  test("signup requires agreeToTerms", () => {
    const base = {
      email: "user@example.com",
      phoneNumber: "+919876543210",
      firstName: "Test",
      lastName: "User",
      password: "Secure1!",
      agreeToTerms: true as const,
    };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, agreeToTerms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, agreeToTerms: undefined }).success).toBe(false);
  });
});

describe("Phase 2 — account deletion policy", () => {
  test("restore window is 30 days", () => {
    expect(ACCOUNT_DELETION_RESTORE_DAYS).toBe(30);
  });
});

describe("Phase 3 — data export zip", () => {
  test("builds valid zip buffer", () => {
    const zip = buildStoredZip({ "export.json": '{"ok":true}' });
    expect(zip.length).toBeGreaterThan(20);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });
});

describe("Phase 8 — production secret validation", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    REDIS_URL: process.env.REDIS_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  test("skips validation outside production", () => {
    process.env.NODE_ENV = "development";
    expect(validateProductionConfig()).toEqual([]);
  });

  test("flags missing secrets in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.RESEND_API_KEY;

    const errors = validateProductionConfig();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.key === "JWT")).toBe(true);
    expect(errors.some((e) => e.key === "EMAIL")).toBe(true);
  });

  afterAll(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    process.env.JWT_SECRET = saved.JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = saved.JWT_REFRESH_SECRET;
    process.env.RAZORPAY_KEY_ID = saved.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = saved.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = saved.RAZORPAY_WEBHOOK_SECRET;
    process.env.REDIS_URL = saved.REDIS_URL;
    process.env.RESEND_API_KEY = saved.RESEND_API_KEY;
  });
});

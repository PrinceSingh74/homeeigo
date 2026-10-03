/**
 * OTP hardening (2026-10-01).
 *
 * 1. A staging host (APP_ENV=staging, NODE_ENV=development — what .env.staging ships) returned the
 *    code in the API response (`devOtp`) whenever SMS was disabled or Twilio failed: anyone could
 *    sign in as any phone number. Only a developer machine may surface it now.
 * 2. The three-guess cap was read, compared and incremented in separate statements, so concurrent
 *    wrong guesses all passed the check. Attempts are now claimed atomically before comparing.
 * 3. A correct code is consumed by compare-and-swap, so two concurrent submissions sign in once.
 */
import "../load-env";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { OTPService } from "../services/otp.service";
import { userPiiService } from "../services/user-pii.service";

const KEYS = ["NODE_ENV", "APP_ENV", "SMS_ENABLED"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const service = new OTPService(prisma);
const phone = (n: number) => `+9170${String(Date.now()).slice(-6)}${String(n).padStart(2, "0")}`;

async function cleanup(phoneNumber: string) {
  await prisma.oTP.deleteMany({ where: { phoneHash: userPiiService.hashPhone(phoneNumber) } });
}

describe("OTP on a deployed host", () => {
  test("staging with SMS disabled never returns the code", async () => {
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "staging";
    process.env.SMS_ENABLED = "false";
    const p = phone(1);
    try {
      const res = (await service.sendOTP(p)) as Record<string, unknown>;
      expect(res.devOtp).toBeUndefined();
    } finally {
      await cleanup(p);
    }
  });

  test("staging with a failing SMS provider never returns the code", async () => {
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "staging";
    process.env.SMS_ENABLED = "true";
    const failing = { messages: { create: async () => Promise.reject(new Error("trial: unverified number")) } };
    const spy = spyOn(service as unknown as { resolveTwilio: () => unknown }, "resolveTwilio").mockReturnValue({
      client: failing,
      from: "+15550000000",
    });
    const p = phone(2);
    try {
      const res = (await service.sendOTP(p)) as Record<string, unknown>;
      expect(res.devOtp).toBeUndefined();
      expect(res.success).toBe(false);
    } finally {
      spy.mockRestore();
      await cleanup(p);
    }
  });

  test("control: a developer machine still surfaces the code for the local UI", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    process.env.SMS_ENABLED = "false";
    const p = phone(3);
    try {
      const res = (await service.sendOTP(p)) as Record<string, unknown>;
      expect(typeof res.devOtp).toBe("string");
    } finally {
      await cleanup(p);
    }
  });
});

describe("OTP verification under concurrency", () => {
  async function issue(p: string): Promise<string> {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    process.env.SMS_ENABLED = "false";
    const res = (await service.sendOTP(p)) as { devOtp?: string };
    if (!res.devOtp) throw new Error("fixture: no code issued");
    return res.devOtp;
  }

  test("20 concurrent wrong guesses get at most 3 comparisons, then the code is burned", async () => {
    const p = phone(4);
    try {
      const code = await issue(p);
      const wrong = code === "123456" ? "654321" : "123456";
      const results = await Promise.all(Array.from({ length: 20 }, () => service.verifyOTP(p, wrong)));
      const compared = results.filter((r) => r.error === "Invalid OTP").length;
      expect(compared).toBeLessThanOrEqual(3);
      expect(results.filter((r) => r.error === "Max attempts exceeded").length).toBe(20 - compared);
      // The right code no longer works once the cap is spent.
      expect((await service.verifyOTP(p, code)).isValid).toBe(false);
    } finally {
      await cleanup(p);
    }
  });

  test("two concurrent correct submissions sign in once", async () => {
    const p = phone(5);
    try {
      const code = await issue(p);
      const results = await Promise.all([service.verifyOTP(p, code), service.verifyOTP(p, code)]);
      expect(results.filter((r) => r.isValid).length).toBe(1);
    } finally {
      await cleanup(p);
    }
  });
});

import { expect, test } from "@playwright/test";
import { scrubEvent } from "../src/lib/observability/scrub";

/**
 * P1-3 — Sentry PII scrubbing.
 *
 * Runtime DSN delivery is EXTERNAL_ARTIFACT_REQUIRED (no Sentry project provisioned), but the
 * scrubbing that decides WHAT would leave the device is pure logic and is fully verifiable now.
 * This is the security-critical half: the partner app handles auth tokens, job OTPs, Aadhaar/PAN
 * numbers, bank details and Razorpay identifiers, none of which may ever reach an error tracker.
 */

test.describe("P1-3 scrubEvent — sensitive fields never leave the device", () => {
  test("redacts auth tokens, OTPs, and secrets from extra", () => {
    const event = scrubEvent({
      extra: {
        accessToken: "eyJhbGciOi.REAL_TOKEN.value",
        refresh_token: "refresh-abc",
        otp: "123456",
        password: "hunter2",
        apiKey: "AIzaSyREAL",
        safeField: "keep-me",
      },
    });
    const extra = event.extra as Record<string, unknown>;
    expect(extra.accessToken).toBe("[redacted]");
    expect(extra.refresh_token).toBe("[redacted]");
    expect(extra.otp).toBe("[redacted]");
    expect(extra.password).toBe("[redacted]");
    expect(extra.apiKey).toBe("[redacted]");
    expect(extra.safeField).toBe("keep-me");
  });

  test("redacts partner KYC and payment identifiers", () => {
    const event = scrubEvent({
      extra: {
        aadhaar: "1234-5678-9012",
        pan: "ABCDE1234F",
        account_number: "00112233445566",
        ifsc: "HDFC0001234",
        razorpaySignature: "sig_real",
        cvv: "123",
        card: "4111111111111111",
        jobId: "bk_123",
      },
    });
    const extra = event.extra as Record<string, unknown>;
    for (const key of ["aadhaar", "pan", "account_number", "ifsc", "razorpaySignature", "cvv", "card"]) {
      expect(extra[key], `${key} must be redacted`).toBe("[redacted]");
    }
    // Non-sensitive operational identifiers must survive — otherwise crash reports are useless.
    expect(extra.jobId).toBe("bk_123");
  });

  test("redacts nested structures, not just top-level keys", () => {
    const event = scrubEvent({
      extra: { request: { headers: { authorization: "Bearer real.jwt" }, body: { otp: "999111" } } },
    });
    const nested = (event.extra as any).request;
    expect(nested.headers.authorization).toBe("[redacted]");
    expect(nested.body.otp).toBe("[redacted]");
  });

  test("redacts values inside arrays", () => {
    const event = scrubEvent({ extra: { items: [{ token: "a" }, { token: "b" }, { name: "ok" }] } });
    const items = (event.extra as any).items;
    expect(items[0].token).toBe("[redacted]");
    expect(items[1].token).toBe("[redacted]");
    expect(items[2].name).toBe("ok");
  });

  test("strips tokens from a request URL query string", () => {
    const event = scrubEvent({
      request: { url: "https://api.homeeigo.com/ws/tracking/bk_1?token=REAL_SECRET&bookingId=bk_1" },
    });
    const url = (event.request as any).url as string;
    expect(url).not.toContain("REAL_SECRET");
    expect(url).toContain("[redacted]");
    // Non-sensitive query params must be preserved for debuggability.
    expect(url).toContain("bookingId=bk_1");
  });

  test("scrubs request headers and body", () => {
    const event = scrubEvent({
      request: {
        headers: { authorization: "Bearer real", "content-type": "application/json" },
        data: { password: "p", email: "partner@example.com" },
      },
    });
    const req = event.request as any;
    expect(req.headers.authorization).toBe("[redacted]");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.data.password).toBe("[redacted]");
  });

  test("handles empty / missing sections without throwing", () => {
    expect(() => scrubEvent({})).not.toThrow();
    expect(() => scrubEvent({ extra: undefined, contexts: undefined, request: undefined })).not.toThrow();
    expect(() => scrubEvent({ extra: null as never })).not.toThrow();
  });

  test("does not recurse infinitely on deeply nested objects", () => {
    let deep: Record<string, unknown> = { token: "leaf" };
    for (let i = 0; i < 30; i++) deep = { nested: deep };
    expect(() => scrubEvent({ extra: deep })).not.toThrow();
  });
});

/**
 * A deployed process must REFUSE to start while a test bypass is set.
 *
 * Several of these switches were already honoured correctly at their use site — the rate-limit
 * middleware ignores `LOAD_TEST_MODE` under `NODE_ENV=production`, and `paymentMocksAllowed()`
 * refuses both production and staging. Two were not: `AI_RATE_LIMIT_BYPASS` and
 * `AI_TOOL_CERTIFICATION_MODE` were read with no environment condition at all, so exporting either
 * on a deployed host silently removed AI rate limiting.
 *
 * Ignoring a bypass and refusing to boot with one are different guarantees. Ignoring leaves an
 * operator believing a flag took effect; refusing tells them the configuration is wrong. These
 * tests pin the second behaviour, and the staging path specifically, because
 * `validateProductionConfig` returns early for staging and that early return previously ran before
 * any bypass was inspected.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { unsafeBypassErrors, validateProductionConfig } from "../lib/production-config";

const TOUCHED = [
  "NODE_ENV",
  "APP_ENV",
  "LOAD_TEST_MODE",
  "HOMIGO_ALLOW_PAYMENT_MOCKS",
  "AI_RATE_LIMIT_BYPASS",
  "AI_TOOL_CERTIFICATION_MODE",
  "AI_GATEWAY_DRY_RUN",
  "SERVICE_START_OTP_REQUIRED",
  "HOMIGO_ALLOW_EXTERNAL",
  "MIGRATION_SAFETY_OVERRIDE",
] as const;

const original = new Map(TOUCHED.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of original) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const keysFrom = (errs: { key: string }[]) => errs.map((e) => e.key);

describe("deployed-environment bypass guard", () => {
  it("accepts a clean environment", () => {
    for (const k of TOUCHED) delete process.env[k];
    expect(unsafeBypassErrors()).toEqual([]);
  });

  it("refuses the two bypasses that had no environment condition anywhere", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.AI_RATE_LIMIT_BYPASS = "true";
    process.env.AI_TOOL_CERTIFICATION_MODE = "true";
    expect(keysFrom(unsafeBypassErrors()).sort()).toEqual(["AI_RATE_LIMIT_BYPASS", "AI_TOOL_CERTIFICATION_MODE"]);
  });

  it("refuses load-test mode and payment mocks even though their use sites already ignore them", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.LOAD_TEST_MODE = "1";
    process.env.HOMIGO_ALLOW_PAYMENT_MOCKS = "1";
    expect(keysFrom(unsafeBypassErrors()).sort()).toEqual(["HOMIGO_ALLOW_PAYMENT_MOCKS", "LOAD_TEST_MODE"]);
  });

  it("refuses disabling the start-PIN requirement", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.SERVICE_START_OTP_REQUIRED = "false";
    expect(keysFrom(unsafeBypassErrors())).toContain("SERVICE_START_OTP_REQUIRED");
  });

  it("does not object to the safe values of those same switches", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.LOAD_TEST_MODE = "0";
    process.env.AI_RATE_LIMIT_BYPASS = "false";
    process.env.SERVICE_START_OTP_REQUIRED = "true";
    expect(unsafeBypassErrors()).toEqual([]);
  });

  it("applies to STAGING, whose early return used to skip every later check", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "staging";
    process.env.AI_RATE_LIMIT_BYPASS = "true";
    expect(keysFrom(validateProductionConfig())).toContain("AI_RATE_LIMIT_BYPASS");
  });

  it("applies to PRODUCTION", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.NODE_ENV = "production";
    process.env.APP_ENV = "production";
    process.env.LOAD_TEST_MODE = "1";
    expect(keysFrom(validateProductionConfig())).toContain("LOAD_TEST_MODE");
  });

  it("stays silent outside a deployed environment, where these flags are legitimate", () => {
    for (const k of TOUCHED) delete process.env[k];
    process.env.NODE_ENV = "development";
    process.env.LOAD_TEST_MODE = "1";
    expect(validateProductionConfig()).toEqual([]);
  });
});

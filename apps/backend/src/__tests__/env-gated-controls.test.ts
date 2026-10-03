import { afterEach, describe, expect, it } from "bun:test";
import { assertOpsAuthorized, isOpsAuthRequired } from "../lib/ops-auth";
import { paymentMocksAllowed } from "../lib/payment-mocks";
import { knownCoords } from "../lib/geo-unknown";

/**
 * Controls that used to key on `NODE_ENV !== "production"` while `.env.staging` ships
 * NODE_ENV=development / APP_ENV=staging. These tests pin the new semantics: staging is never a
 * "dev" environment for ops endpoints or payment mocks.
 */
const saved = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV, OPS: process.env.OPS_AUTH_TOKEN, MOCKS: process.env.HOMIGO_ALLOW_PAYMENT_MOCKS };
function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => setEnv({ NODE_ENV: saved.NODE_ENV, APP_ENV: saved.APP_ENV, OPS_AUTH_TOKEN: saved.OPS, HOMIGO_ALLOW_PAYMENT_MOCKS: saved.MOCKS }));

const req = (headers: Record<string, string> = {}) => new Request("http://x/ready", { headers });

describe("ops auth gating", () => {
  it("is open only on a local dev machine with no token configured", () => {
    setEnv({ NODE_ENV: "development", APP_ENV: "development", OPS_AUTH_TOKEN: undefined });
    expect(isOpsAuthRequired()).toBe(false);
    expect(assertOpsAuthorized(req())).toBe(true);
  });

  it("requires the token on staging even when NODE_ENV=development (the .env.staging shape)", () => {
    setEnv({ NODE_ENV: "development", APP_ENV: "staging", OPS_AUTH_TOKEN: "s3cret" });
    expect(isOpsAuthRequired()).toBe(true);
    expect(assertOpsAuthorized(req())).toBe(false);
    expect(assertOpsAuthorized(req({ authorization: "Bearer s3cret" }))).toBe(true);
    expect(assertOpsAuthorized(req({ "x-ops-token": "s3cret" }))).toBe(true);
    expect(assertOpsAuthorized(req({ authorization: "Bearer wrong" }))).toBe(false);
  });

  it("fails closed on staging/production when no token is configured", () => {
    setEnv({ NODE_ENV: "development", APP_ENV: "staging", OPS_AUTH_TOKEN: undefined });
    expect(assertOpsAuthorized(req())).toBe(false);
    setEnv({ NODE_ENV: "production", APP_ENV: undefined, OPS_AUTH_TOKEN: undefined });
    expect(assertOpsAuthorized(req())).toBe(false);
  });

  it("a configured token gates even a dev machine", () => {
    setEnv({ NODE_ENV: "development", APP_ENV: "development", OPS_AUTH_TOKEN: "t" });
    expect(assertOpsAuthorized(req())).toBe(false);
    expect(assertOpsAuthorized(req({ "x-ops-token": "t" }))).toBe(true);
  });
});

describe("payment mock gating", () => {
  it("never allows mocks in production or staging, whatever NODE_ENV says", () => {
    setEnv({ NODE_ENV: "production", APP_ENV: "production", HOMIGO_ALLOW_PAYMENT_MOCKS: "1" });
    expect(paymentMocksAllowed()).toBe(false);
    setEnv({ NODE_ENV: "development", APP_ENV: "staging", HOMIGO_ALLOW_PAYMENT_MOCKS: "1" });
    expect(paymentMocksAllowed()).toBe(false);
    setEnv({ NODE_ENV: "test", APP_ENV: "staging" });
    expect(paymentMocksAllowed()).toBe(false);
  });

  it("allows mocks under bun test and under an explicit dev opt-in only", () => {
    setEnv({ NODE_ENV: "test", APP_ENV: "development", HOMIGO_ALLOW_PAYMENT_MOCKS: undefined });
    expect(paymentMocksAllowed()).toBe(true);
    setEnv({ NODE_ENV: "development", APP_ENV: "development", HOMIGO_ALLOW_PAYMENT_MOCKS: undefined });
    expect(paymentMocksAllowed()).toBe(false);
    setEnv({ NODE_ENV: "development", APP_ENV: "development", HOMIGO_ALLOW_PAYMENT_MOCKS: "1" });
    expect(paymentMocksAllowed()).toBe(true);
  });
});

describe("knownCoords — UNKNOWN is never a location", () => {
  it("rejects null, 0/0, non-finite and out-of-range pairs", () => {
    expect(knownCoords(null, null)).toBeNull();
    expect(knownCoords(undefined, 77.3)).toBeNull();
    expect(knownCoords(0, 0)).toBeNull();
    expect(knownCoords(Number.NaN, 77.3)).toBeNull();
    expect(knownCoords(28.6, Number.POSITIVE_INFINITY)).toBeNull();
    expect(knownCoords(91, 10)).toBeNull();
    expect(knownCoords(10, 181)).toBeNull();
  });
  it("accepts a real fix, including one on the equator or the meridian", () => {
    expect(knownCoords(28.62, 77.37)).toEqual({ latitude: 28.62, longitude: 77.37 });
    expect(knownCoords(0, 77.37)).toEqual({ latitude: 0, longitude: 77.37 });
    expect(knownCoords(28.62, 0)).toEqual({ latitude: 28.62, longitude: 0 });
  });
});

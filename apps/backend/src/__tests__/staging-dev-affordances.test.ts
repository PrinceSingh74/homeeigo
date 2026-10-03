/**
 * Staging is not a developer's laptop, and `NODE_ENV` cannot tell them apart.
 *
 * `.env.staging` ships **NODE_ENV=development** with APP_ENV=staging. Every control written as
 * `NODE_ENV !== "production"` is therefore live on staging. That has now been found three separate
 * times — ops metrics served unauthenticated, payment signatures mockable by any customer, and, in
 * Pass 5, a live password-reset token printed to the console plus an auth burst-limit bypass the
 * caller claims by choosing their own e-mail domain.
 *
 * Three independent copies of one predicate is how a fourth site gets missed, so the rule now lives
 * in `lib/deployed-environment` and everything delegates to it. This pins both halves: the rule
 * itself, and the fact that the call sites use it rather than re-deriving it.
 *
 * `env-gated-controls.test.ts` covers the ops/payment gates' behaviour. This covers the shared
 * predicate and the auth surface, which had no coverage of the staging case at all — which is why
 * those suites passed while the defect was live.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devAffordancesAllowed, isDeployedEnvironment } from "../lib/deployed-environment";

const ORIGINAL = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV };

function setEnv(nodeEnv?: string, appEnv?: string) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
}

afterEach(() => setEnv(ORIGINAL.NODE_ENV, ORIGINAL.APP_ENV));

describe("isDeployedEnvironment", () => {
  it("treats staging as deployed even though NODE_ENV says development", () => {
    // The exact combination `.env.staging` ships. This is the whole point.
    setEnv("development", "staging");
    expect(isDeployedEnvironment()).toBe(true);
    expect(devAffordancesAllowed()).toBe(false);
  });

  it("treats production as deployed by either variable", () => {
    setEnv("production", undefined);
    expect(isDeployedEnvironment()).toBe(true);
    setEnv("development", "production");
    expect(isDeployedEnvironment()).toBe(true);
  });

  it("allows dev affordances on a developer machine and under the test runner", () => {
    // Must stay permissive where it is supposed to be, or the fix breaks local work and gets
    // reverted rather than kept.
    setEnv("development", undefined);
    expect(devAffordancesAllowed()).toBe(true);
    setEnv("test", undefined);
    expect(devAffordancesAllowed()).toBe(true);
  });

  it("does not grant affordances for an unrecognised APP_ENV", () => {
    // A typo or an unlisted deployment name is neither known-deployed nor known-local, and fails safe
    // BOTH ways: no deployed-only grant (isDeployedEnvironment false) and no dev affordance
    // (devAffordancesAllowed false). Until 2026-10-01 this test asserted only the first half and the
    // second was silently the opposite (`stagng` counted as a laptop: every affordance on).
    for (const appEnv of ["stagng", "preprod", "uat", "staging-2"]) {
      setEnv("development", appEnv);
      expect({ appEnv, deployed: isDeployedEnvironment(), affordances: devAffordancesAllowed() }).toEqual({
        appEnv,
        deployed: false,
        affordances: false,
      });
    }
    for (const appEnv of [undefined, "dev", "development", "local", "test", "chaos"]) {
      setEnv("development", appEnv);
      expect({ appEnv, affordances: devAffordancesAllowed() }).toEqual({ appEnv, affordances: true });
    }
  });
});

describe("the production configuration guard runs on staging", () => {
  // `validateProductionConfig` returned [] whenever NODE_ENV was not "production", so on staging it
  // checked nothing — not the unsafe-bypass flags its own comment said it covered, not OTP_SECRET.
  // `.env.staging` was measured with neither OTP_SECRET nor ENCRYPTION_KEY set, and both OTP services
  // fall back to the literal "unsafe-dev-otp-secret" when it is unset.
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["OTP_SECRET", "LOAD_TEST_MODE", "HOMIGO_ALLOW_PAYMENT_MOCKS"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports a missing OTP secret on the exact env pair .env.staging ships", async () => {
    const { validateProductionConfig } = await import("../lib/production-config");
    setEnv("development", "staging");
    delete process.env.OTP_SECRET;
    expect(validateProductionConfig().map((e) => e.key)).toContain("OTP_SECRET");
  });

  it("reports an unsafe bypass flag on staging", async () => {
    const { validateProductionConfig } = await import("../lib/production-config");
    setEnv("development", "staging");
    process.env.LOAD_TEST_MODE = "1";
    expect(validateProductionConfig().map((e) => e.key)).toContain("LOAD_TEST_MODE");
  });

  it("stays silent on a developer machine", async () => {
    const { validateProductionConfig } = await import("../lib/production-config");
    setEnv("development", undefined);
    process.env.LOAD_TEST_MODE = "1";
    expect(validateProductionConfig()).toEqual([]);
  });
});

describe("call sites use the shared predicate rather than re-deriving it", () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");

  it("routes/auth.ts gates its dev affordances on deployment, not NODE_ENV", () => {
    const auth = read("routes/auth.ts");
    expect(auth).toContain("devAffordancesAllowed");
    // The reset-token print is the one that leaks a bearer credential.
    const i = auth.indexOf("[RESET TOKEN]");
    expect(i).toBeGreaterThan(-1);
    const block = auth.slice(Math.max(0, i - 400), i);
    expect(block).toContain("devAffordancesAllowed()");
    expect(block).not.toMatch(/NODE_ENV\s*!==\s*"production"[\s\S]{0,80}$/);
  });

  it("never prints a service-start PIN on a deployed host", () => {
    // The PIN authorises a partner to begin work at a customer's home. It was printed under
    // `NODE_ENV !== "production"`, which is true on staging.
    const svc = read("services/booking-start-otp.service.ts");
    const i = svc.indexOf("SERVICE-START PIN");
    expect(i).toBeGreaterThan(-1);
    const block = svc.slice(Math.max(0, i - 500), i);
    expect(block).toContain("devAffordancesAllowed()");
    expect(block).not.toMatch(/if \(process\.env\.NODE_ENV !== "production"\)/);
  });

  it("never prints a login OTP on a deployed host", () => {
    // Worse than the others: this branch had no environment condition at all, only "is Twilio
    // configured". A staging host without Twilio wrote every login code into its logs.
    const svc = read("services/otp.service.ts");
    const i = svc.indexOf("HOMIGO DEV OTP");
    expect(i).toBeGreaterThan(-1);
    const before = svc.slice(Math.max(0, i - 1800), i);
    // Since 2026-10-01 the guard is "not a KNOWN developer machine", so an unrecognised APP_ENV is
    // refused too — stricter than the earlier isDeployedEnvironment() test.
    expect(before).toContain("!devAffordancesAllowed()");
    expect(before).toContain("SMS_TRANSPORT_UNAVAILABLE");
  });

  it("never returns a raw internal error message on a deployed host", () => {
    // The global fallback returned `error.message` whenever NODE_ENV was not "production" — which
    // on staging exposed Prisma invocation text, absolute source paths and code excerpts to an
    // unauthenticated caller of POST /api/auth/login.
    const mw = read("middleware/error.middleware.ts");
    const i = mw.indexOf('"INTERNAL_ERROR"');
    expect(i).toBeGreaterThan(-1);
    const block = mw.slice(Math.max(0, i - 300), i);
    expect(block).toContain("devAffordancesAllowed()");
    expect(block).not.toContain('process.env.NODE_ENV === "production"');
  });

  it("never prints an email body, or claims delivery, on a deployed host", () => {
    // Without a provider, email.service printed the full body (reset links included) and returned
    // `delivered: true` whenever NODE_ENV was not "production" — true on staging.
    const svc = read("services/email.service.ts");
    const i = svc.indexOf("[EMAIL:console]");
    expect(i).toBeGreaterThan(-1);
    const block = svc.slice(Math.max(0, i - 900), i);
    expect(block).toContain("devAffordancesAllowed()");
    expect(block).not.toContain('if (process.env.NODE_ENV !== "production")');
  });

  it("ops-auth and payment-mocks delegate instead of keeping their own copy", () => {
    for (const file of ["lib/ops-auth.ts", "lib/payment-mocks.ts"]) {
      const text = read(file);
      expect(text).toContain("isDeployedEnvironment");
      // The duplicated predicate is gone, not merely shadowed.
      expect(text).not.toMatch(/appEnv\s*===\s*"staging"/);
    }
  });
});

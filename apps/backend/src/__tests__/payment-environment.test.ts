/**
 * §8 — TEST vs LIVE payment credentials.
 *
 * The environment is derived from the Razorpay key id itself (`rzp_test_…` / `rzp_live_…`), not from
 * a config flag, so a `.env` that claims one thing while holding the other cannot be believed. The
 * two dangerous disagreements — live keys on a laptop, test keys on a deployed host — must both be
 * named, and an unclassifiable credential must never be assumed to be Test.
 *
 * Pure: no secret is read, constructed or asserted on anywhere in this file.
 */
import { describe, expect, test } from "bun:test";
import { describePaymentEnvironment, resolvePaymentEnvironment } from "../lib/payment-environment";

const LOCAL = false;
const DEPLOYED = true;

describe("the credential decides the environment", () => {
  test("a test key is TEST, a live key is LIVE", () => {
    expect(resolvePaymentEnvironment("rzp_test_abc123", LOCAL).environment).toBe("TEST");
    expect(resolvePaymentEnvironment("rzp_live_abc123", DEPLOYED).environment).toBe("LIVE");
  });

  test("no key configured is UNCONFIGURED, and that is not a mismatch", () => {
    for (const v of [undefined, null, "", "   "]) {
      const r = resolvePaymentEnvironment(v, LOCAL);
      expect(r.environment).toBe("UNCONFIGURED");
      expect(r.mismatch).toBeNull();
      expect(r.keyPrefix).toBeNull();
    }
  });

  test("an unrecognised credential is NOT assumed to be Test", () => {
    // Assuming Test is the tempting default and the dangerous one: an unclassified live-issued key
    // would move real money while every log said TEST.
    const r = resolvePaymentEnvironment("some_other_key", LOCAL);
    expect(r.environment).toBe("UNCONFIGURED");
    expect(r.mismatch).toBe("UNRECOGNISED_KEY_FORMAT");
  });
});

describe("the two dangerous disagreements are named", () => {
  test("live keys outside a deployed environment", () => {
    const r = resolvePaymentEnvironment("rzp_live_abc123", LOCAL);
    expect(r.environment).toBe("LIVE");
    expect(r.mismatch).toBe("LIVE_KEYS_OUTSIDE_DEPLOYED_ENVIRONMENT");
  });

  test("test keys on a deployed host — customers would be charged nothing, silently", () => {
    const r = resolvePaymentEnvironment("rzp_test_abc123", DEPLOYED);
    expect(r.environment).toBe("TEST");
    expect(r.mismatch).toBe("TEST_KEYS_ON_DEPLOYED_HOST");
  });

  test("the matching combinations report no mismatch", () => {
    expect(resolvePaymentEnvironment("rzp_test_abc", LOCAL).mismatch).toBeNull();
    expect(resolvePaymentEnvironment("rzp_live_abc", DEPLOYED).mismatch).toBeNull();
  });
});

describe("nothing it produces can leak a credential", () => {
  const SECRET_LOOKING = "rzp_live_SUPERSECRETKEYVALUE";

  test("only the prefix is ever returned", () => {
    const r = resolvePaymentEnvironment(SECRET_LOOKING, DEPLOYED);
    expect(r.keyPrefix).toBe("rzp_live_");
    expect(JSON.stringify(r)).not.toContain("SUPERSECRET");
  });

  test("the human summary carries the prefix and the verdict, never the key", () => {
    const line = describePaymentEnvironment(resolvePaymentEnvironment(SECRET_LOOKING, LOCAL));
    expect(line).toContain("LIVE");
    expect(line).toContain("MISMATCH");
    expect(line).not.toContain("SUPERSECRET");
  });

  test("an unconfigured summary says so without inventing an environment", () => {
    expect(describePaymentEnvironment(resolvePaymentEnvironment("", LOCAL))).toContain("UNCONFIGURED");
  });
});

/**
 * §27 — the per-payment environment column helpers.
 *
 * Pure derivation plus the probe fallback: everything runs against a stubbed db handle, so this
 * block also proves the pre-migration degradation path (column absent → stamp is a no-op, read is
 * UNKNOWN) without needing a database with the column missing.
 */
import {
  environmentForGatewayOrder,
  paymentEnvironmentColumnPresent,
  processGatewayEnvironment,
  readPaymentEnvironment,
  resetPaymentEnvironmentColumnCacheForTests,
  stampPaymentEnvironment,
} from "../lib/payment-environment-column";

describe("§27 processGatewayEnvironment — the world this process's credential belongs to", () => {
  test("classifiable keys win: live is LIVE, test is TEST", () => {
    expect(processGatewayEnvironment("rzp_live_abc123")).toBe("LIVE");
    expect(processGatewayEnvironment("rzp_test_abc123")).toBe("TEST");
  });

  test("no key at all means the dev-mock world — TEST", () => {
    // With no credential the process can only mint order_dev_/rfnd_dev_ ids; production refuses
    // to operate unconfigured before any row could be written.
    expect(processGatewayEnvironment("")).toBe("TEST");
    expect(processGatewayEnvironment(undefined)).toBe("TEST");
    expect(processGatewayEnvironment(null)).toBe("TEST");
  });

  test("an unrecognisable configured key is null — never guessed either way", () => {
    expect(processGatewayEnvironment("some_other_key")).toBeNull();
  });
});

describe("§27 environmentForGatewayOrder — the order id can prove TEST on its own", () => {
  test("a dev-mock order is TEST regardless of the configured key", () => {
    expect(environmentForGatewayOrder("order_dev_abc123", "rzp_live_abc")).toBe("TEST");
  });

  test("a real order id falls back to the credential", () => {
    expect(environmentForGatewayOrder("order_R4nd0m123456", "rzp_live_abc")).toBe("LIVE");
    expect(environmentForGatewayOrder("order_R4nd0m123456", "rzp_test_abc")).toBe("TEST");
    expect(environmentForGatewayOrder("order_R4nd0m123456", "unrecognised_key")).toBeNull();
  });
});

describe("§27 probe fallback — a database without the column degrades, never crashes", () => {
  /** A db handle whose information_schema says the column does not exist. */
  function absentColumnDb() {
    const calls: string[] = [];
    return {
      calls,
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
        if (sql.includes("information_schema.columns")) return [{ present: false }];
        throw new Error("column \"environment\" does not exist"); // any data read would fail
      },
      $executeRaw: async () => {
        throw new Error("stamp must never be attempted when the probe says the column is absent");
      },
    };
  }

  test("probe reports absent, stamp is a silent no-op, read is UNKNOWN", async () => {
    resetPaymentEnvironmentColumnCacheForTests();
    const db = absentColumnDb();
    expect(await paymentEnvironmentColumnPresent(db as never, "payments")).toBe(false);
    // stampPaymentEnvironment would throw through $executeRaw if the guard did not hold.
    await stampPaymentEnvironment(db as never, "pay_x", "order_dev_abc");
    expect(await readPaymentEnvironment(db as never, "pay_x")).toBeNull();
    resetPaymentEnvironmentColumnCacheForTests(); // never leave the poisoned cache for other suites
  });

  test("a probe that itself fails is treated as not deployed, not as a crash", async () => {
    resetPaymentEnvironmentColumnCacheForTests();
    const db = {
      $queryRaw: async () => {
        throw new Error("connection refused");
      },
      $executeRaw: async () => {
        throw new Error("must not be reached");
      },
    };
    expect(await paymentEnvironmentColumnPresent(db as never, "payments")).toBe(false);
    await stampPaymentEnvironment(db as never, "pay_x"); // resolves silently
    expect(await readPaymentEnvironment(db as never, "pay_x")).toBeNull();
    resetPaymentEnvironmentColumnCacheForTests();
  });
});

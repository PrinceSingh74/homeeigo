import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { validateStagingSafety } from "../staging-safety";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    prior[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("staging safety guard", () => {
  const stagingBase = {
    APP_ENV: "staging",
    DATABASE_URL: "postgresql://app:secret@staging-db.example.com:5432/homigo_staging_db",
    REDIS_URL: "redis://staging-redis.example.com:6379",
    EVENTS_OUTBOX_ENABLED: "false",
    EVENTS_CONSUMERS_ENABLED: "false",
    RAZORPAY_KEY_ID: "",
    RAZORPAY_ACCOUNT_NUMBER: "",
  };

  test("non-staging APP_ENV skips validation", () => {
    withEnv(
      {
        APP_ENV: "dev",
        DATABASE_URL: "postgresql://postgres:pw@localhost:5433/homigo_db",
        RAZORPAY_KEY_ID: "rzp_live_bad",
        RAZORPAY_ACCOUNT_NUMBER: "acc123",
        EVENTS_OUTBOX_ENABLED: "true",
      },
      () => {
        expect(validateStagingSafety()).toEqual([]);
      },
    );
  });

  test("staging + dedicated staging DB passes baseline", () => {
    withEnv(stagingBase, () => {
      expect(validateStagingSafety()).toEqual([]);
    });
  });

  test("staging + local dev homigo_db fails", () => {
    withEnv(
      {
        ...stagingBase,
        DATABASE_URL: "postgresql://postgres:pw@localhost:5433/homigo_db",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.key === "DATABASE_URL")).toBe(true);
      },
    );
  });

  test("staging + production-looking DB name fails", () => {
    withEnv(
      {
        ...stagingBase,
        DATABASE_URL: "postgresql://app:pw@10.0.0.5:5432/homigo_production",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.key === "DATABASE_URL")).toBe(true);
      },
    );
  });

  test("staging + blocked host pattern fails", () => {
    withEnv(
      {
        ...stagingBase,
        STAGING_BLOCKED_DB_HOSTS: "prod-sql.internal",
        DATABASE_URL: "postgresql://app:pw@prod-sql.internal:5432/homigo_staging_db",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.message.includes("blocked production host"))).toBe(true);
      },
    );
  });

  test("staging + rzp_test key passes", () => {
    withEnv(
      {
        ...stagingBase,
        RAZORPAY_KEY_ID: "rzp_test_staging_only",
        RAZORPAY_KEY_SECRET: "test_secret",
      },
      () => {
        expect(validateStagingSafety()).toEqual([]);
      },
    );
  });

  test("staging + rzp_live key fails", () => {
    withEnv(
      {
        ...stagingBase,
        RAZORPAY_KEY_ID: "rzp_live_forbidden",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.key === "RAZORPAY_KEY_ID")).toBe(true);
      },
    );
  });

  test("staging + payout account fails", () => {
    withEnv(
      {
        ...stagingBase,
        RAZORPAY_ACCOUNT_NUMBER: "2323230020000001",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.key === "RAZORPAY_ACCOUNT_NUMBER")).toBe(true);
      },
    );
  });

  test("staging baseline rejects enabled event flags", () => {
    withEnv(
      {
        ...stagingBase,
        EVENTS_OUTBOX_ENABLED: "true",
      },
      () => {
        const errors = validateStagingSafety();
        expect(errors.some((e) => e.key === "EVENTS")).toBe(true);
      },
    );
  });
});

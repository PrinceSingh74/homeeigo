/**
 * Deployed-host startup checks added 2026-10-01: database target, explicit object storage, public
 * https origins, and the warnings channel (TRUST_PROXY_HOPS, key separation).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { productionConfigWarnings, validateProductionConfig } from "../lib/production-config";

const KEYS = [
  "NODE_ENV",
  "APP_ENV",
  "DATABASE_URL",
  "AWS_S3_BUCKET",
  "OBJECT_STORAGE_DRIVER",
  "FRONTEND_URL",
  "PARTNER_WEB_URL",
  "ADMIN_WEB_URL",
  "PUBLIC_API_ORIGIN",
  "TRUST_PROXY",
  "TRUST_PROXY_HOPS",
  "MASTER_ENCRYPTION_KEY",
  "HASH_HMAC_KEY",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Production, with everything this file checks set to a passing value; override per test. */
function production(overrides: Partial<Record<(typeof KEYS)[number], string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    NODE_ENV: "production",
    APP_ENV: "production",
    DATABASE_URL: "postgresql://app:pw@db.internal:5432/homigo_prod",
    AWS_S3_BUCKET: "homigo-prod-objects",
    OBJECT_STORAGE_DRIVER: undefined,
    FRONTEND_URL: "https://app.example.com",
    PARTNER_WEB_URL: "https://partner.example.com",
    ADMIN_WEB_URL: "https://admin.example.com",
    PUBLIC_API_ORIGIN: "https://api.example.com",
    TRUST_PROXY: undefined,
    TRUST_PROXY_HOPS: "1",
    MASTER_ENCRYPTION_KEY: "x",
    HASH_HMAC_KEY: "y",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const keysOf = (list: Array<{ key: string }>) => list.map((e) => e.key);
const CHECKED = ["DATABASE_URL", "OBJECT_STORAGE", "FRONTEND_URL", "PARTNER_WEB_URL", "ADMIN_WEB_URL", "PUBLIC_API_ORIGIN"];
const checkedErrors = () => keysOf(validateProductionConfig()).filter((k) => CHECKED.includes(k));

describe("deployed-host startup checks", () => {
  test("a fully configured production host raises none of these", () => {
    production();
    expect(checkedErrors()).toEqual([]);
    expect(productionConfigWarnings()).toEqual([]);
  });

  test("refuses a missing database URL and a test database", () => {
    production({ DATABASE_URL: undefined });
    expect(checkedErrors()).toEqual(["DATABASE_URL"]);
    production({ DATABASE_URL: "postgresql://app:pw@localhost:5433/homigo_test" });
    expect(checkedErrors()).toEqual(["DATABASE_URL"]);
  });

  test("object storage must be chosen, not fallen back to", () => {
    production({ AWS_S3_BUCKET: undefined });
    expect(checkedErrors()).toEqual(["OBJECT_STORAGE"]);
    production({ AWS_S3_BUCKET: undefined, OBJECT_STORAGE_DRIVER: "local" });
    expect(checkedErrors()).toEqual([]);
  });

  test("public origins must be https and not loopback", () => {
    production({ FRONTEND_URL: "http://app.example.com", ADMIN_WEB_URL: "https://localhost:3003" });
    expect(checkedErrors()).toEqual(["FRONTEND_URL", "ADMIN_WEB_URL"]);
  });

  test("this API's own public origin is required (stored photo URLs are never built from Host)", () => {
    production({ PUBLIC_API_ORIGIN: undefined });
    expect(checkedErrors()).toEqual(["PUBLIC_API_ORIGIN"]);
    production({ PUBLIC_API_ORIGIN: "http://api.example.com" });
    expect(checkedErrors()).toEqual(["PUBLIC_API_ORIGIN"]);
  });

  test("warns (does not refuse) on an untuned proxy hop count and on key fallback", () => {
    production({ TRUST_PROXY_HOPS: undefined, MASTER_ENCRYPTION_KEY: undefined });
    expect(keysOf(productionConfigWarnings())).toEqual(["TRUST_PROXY_HOPS", "MASTER_ENCRYPTION_KEY"]);
    expect(checkedErrors()).toEqual([]);
  });

  test("a developer machine is not checked at all", () => {
    production({ NODE_ENV: "development", APP_ENV: "dev", DATABASE_URL: undefined, AWS_S3_BUCKET: undefined });
    expect(validateProductionConfig()).toEqual([]);
    expect(productionConfigWarnings()).toEqual([]);
  });
});

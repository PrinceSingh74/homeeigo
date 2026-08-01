import { config } from "dotenv";
import { resolve } from "node:path";
import { assertStagingSafety } from "./lib/staging-safety";

/**
 * Global BigInt → JSON serializer. The schema stores money as BigInt `*Paise`
 * fields (walletBalancePaise, amountPaise, …). `JSON.stringify` throws on BigInt,
 * which crashed any endpoint returning a raw Prisma row (e.g. the Google OAuth
 * callback returned the full user → "JSON.stringify cannot serialize BigInt").
 * Serialise as a Number — every paise amount is a safe integer well under 2^53,
 * so there is no precision loss. Set once, before anything serialises a response.
 */
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

// Capture test mode FIRST — `bun test` sets NODE_ENV=test, but loading .env below
// with override:true would clobber it back to "development" (so this MUST come
// before the .env load, or the test-DB switch silently never happens).
const isTest = process.env.NODE_ENV === "test";
// Bun auto-loads .env before this module runs and can clobber shell APP_ENV.
// HOMIGO_STAGING=1 (shell-only) selects apps/backend/.env.staging reliably.
const stagingRequested = process.env.HOMIGO_STAGING === "1";
// Cloud Run sets K_SERVICE; Kubernetes sets KUBERNETES_SERVICE_HOST.
// Skip local dotenv files so injected platform secrets are never overridden.
const isCloudRuntime = Boolean(process.env.K_SERVICE || process.env.KUBERNETES_SERVICE_HOST);

// Preserve explicit runtime overrides (multi-node cert, CI matrix ports) before
// dotenv files clobber them via override:true.
const runtimeEnvPreserve = {
  PORT: process.env.PORT,
  INSTANCE_ID: process.env.INSTANCE_ID,
  DATABASE_URL: process.env.DATABASE_URL,
  APP_ENV: process.env.APP_ENV,
  REDIS_URL: process.env.REDIS_URL,
  HOMIGO_STAGING: process.env.HOMIGO_STAGING,
};

/** Override stale shell env so local .env always wins in dev (not in cloud). */
if (!isTest && !isCloudRuntime) {
  config({ path: resolve(import.meta.dir, "../.env"), override: true });
  config({ path: resolve(import.meta.dir, "../.env.local"), override: true });
}
// Local staging overrides — HOMIGO_STAGING=1 survives Bun's automatic .env injection.
if (!isCloudRuntime && (stagingRequested || process.env.APP_ENV === "staging")) {
  config({ path: resolve(import.meta.dir, "../.env.staging"), override: true });
  process.env.APP_ENV = "staging";
}

const stagingPreserveSkip = new Set(["PORT", "DATABASE_URL", "REDIS_URL", "APP_ENV"]);

for (const [key, value] of Object.entries(runtimeEnvPreserve)) {
  if (stagingRequested && stagingPreserveSkip.has(key)) continue;
  if (value !== undefined && value !== "") {
    process.env[key] = value;
  }
}

// Under `bun test` load .env.test ON TOP so the suite points at an ISOLATED
// database/Redis — tests must never write to the live/dev DB.
if (isTest) {
  process.env.NODE_ENV = "test"; // .env may have reset it — restore
  config({ path: resolve(import.meta.dir, "../.env.test"), override: true });
}

/**
 * Safety guard: in test mode, refuse to start unless DATABASE_URL points at a
 * database whose name clearly contains "test". This makes it IMPOSSIBLE for the
 * suite to silently pollute the live/dev DB (which previously dropped financial
 * integrity 100 → 92). Fail fast and loud.
 */
if (isTest) {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    const masked = url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
    throw new Error(
      `[load-env] REFUSING to run tests against a non-test database (db="${dbName}", url=${masked}). ` +
        `Create apps/backend/.env.test with a DATABASE_URL whose database name contains "test".`,
    );
  }
}

assertStagingSafety();

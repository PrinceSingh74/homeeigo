import { config } from "dotenv";
import { resolve } from "node:path";
import { assertStagingSafety } from "./lib/staging-safety";
import { redisUrlForDatabase } from "./lib/isolated-redis";

/**
 * Global BigInt → JSON serializer. The schema stores money as BigInt `*Paise`
 * fields (walletBalancePaise, amountPaise, …). `JSON.stringify` throws on BigInt,
 * which crashed any endpoint returning a raw Prisma row (e.g. the Google OAuth
 * callback returned the full user → "JSON.stringify cannot serialize BigInt").
 * Serialise as a Number — every paise amount is a safe integer well under 2^53,
 * so there is no precision loss. Set once, before anything serialises a response.
 */
/**
 * RETAINED CAST. `BigInt.prototype` genuinely has no `toJSON` in the standard library types —
 * that is the whole reason this shim exists. Assigning one requires describing the property being
 * added; there is no stale type to fix and nothing to validate. Removable if TC39 adds
 * `BigInt.prototype.toJSON` and the lib types follow.
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
  /**
   * The transactional outbox switch.
   *
   * Preserved for the same reason PORT and DATABASE_URL are: it decides whether a whole subsystem
   * runs, and an operator must be able to force it from the process environment without editing a
   * dotenv file that is shared by everyone using that environment.
   *
   * It is also read exactly ONCE, at `events/core/config.ts` import time. Static imports are
   * hoisted, so nothing that runs later in a module body — including an explicit assignment at the
   * top of a script — can change the value the processor will use. Preserving it here is the only
   * point in the lifecycle early enough to matter.
   *
   * `.env.staging` currently ships `EVENTS_OUTBOX_ENABLED=false`, which is a deployment choice for
   * that environment. This makes that choice overridable rather than absolute.
   */
  EVENTS_OUTBOX_ENABLED: process.env.EVENTS_OUTBOX_ENABLED,
  /**
   * The consumer fan-out switch, preserved for the same reasons as the outbox switch above.
   *
   * These are two INDEPENDENT flags and both must be on for an event to reach a consumer. The
   * dangerous combination is outbox-on/consumers-off: the processor claims rows, publishes them
   * and marks them PUBLISHED while `dispatchEvent` returns immediately. Outbox metrics climb,
   * every row reaches a terminal state, and no consumer ever runs — which reads exactly like a
   * healthy pipeline. Observed during Phase-16 certification as 68 rows claimed and zero agent
   * runs started.
   */
  EVENTS_CONSUMERS_ENABLED: process.env.EVENTS_CONSUMERS_ENABLED,
  /**
   * The global API rate-limit bypass, preserved for the same reason as the switches above: it
   * decides whether a whole protection runs, and it must be settable per process.
   *
   * `.env` ships `LOAD_TEST_MODE=1`, and dotenv loads it with `override: true`, so every process
   * started from this directory had the global limiter disabled and no way to re-enable it short of
   * editing a file shared by everyone. That made the limiter untestable: a harness could pass
   * `LOAD_TEST_MODE=""` to the child, watch it get clobbered back to "1", send a burst, see no 429
   * and conclude the limiter was broken. Preserving it here is what lets a single run turn the
   * protection back on and measure it.
   *
   * The bypass itself remains inert in production — `api-rate-limit.middleware` only honours it when
   * `NODE_ENV !== "production"` — so this changes what can be controlled, not what is exposed.
   */
  LOAD_TEST_MODE: process.env.LOAD_TEST_MODE,
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
  // CI / Docker inject DATABASE_URL (and optionally REDIS_URL) after checkout.
  // .env.test hardcodes localhost, which is correct on GitHub-hosted runners but
  // wrong inside a Linux container talking to host Postgres via host.docker.internal.
  // Restore a pre-injected URL only when it already targets a *test* database so
  // isolation cannot be silently bypassed.
  const injectedDb = process.env.HOMIGO_TEST_DATABASE_URL || runtimeEnvPreserve.DATABASE_URL;
  if (injectedDb && /test/i.test(injectedDb.split("/").pop()?.split("?")[0] ?? "")) {
    process.env.DATABASE_URL = injectedDb;
  }
  if (runtimeEnvPreserve.REDIS_URL !== undefined) {
    process.env.REDIS_URL = runtimeEnvPreserve.REDIS_URL;
  }
  if (!process.env.MASTER_ENCRYPTION_KEY?.trim()) {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  }
  if (!process.env.ENCRYPTION_KEY?.trim()) {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  }
  if (!process.env.HASH_HMAC_KEY?.trim()) {
    process.env.HASH_HMAC_KEY = "test-hmac-pepper";
  }
}

/**
 * A process on an isolated database never shares Redis with the developer's backend (see
 * lib/isolated-redis). This also covers a stack started with NODE_ENV=development against a test
 * database: there `.env` is loaded with override, and an explicit empty REDIS_URL from the launcher
 * is dropped by the restore loop above, so without this the stack silently used the Redis in `.env`.
 */
if (!isCloudRuntime) {
  const redis = redisUrlForDatabase({
    databaseUrl: process.env.DATABASE_URL,
    launcherRedisUrl: runtimeEnvPreserve.REDIS_URL,
    effectiveRedisUrl: process.env.REDIS_URL,
  });
  if (redis.isolated && process.env.REDIS_URL) {
    console.warn("[load-env] isolated database: not using the shared Redis from a dotenv file (in-memory instead). Set REDIS_URL in the launching environment to use one.");
  }
  if (redis.isolated) process.env.REDIS_URL = redis.url;
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

/**
 * A backend on an isolated test database must not share Redis with the developer's own backend.
 *
 * Found 2026-10-06: an isolated stack started with `--env-file=.env.test` (which says `REDIS_URL=`)
 * still connected to the developer's Redis, because load-env dropped the empty value and took the
 * one in `.env`. Both backends call their environment "dev", so they shared the feature-flag cache:
 * the isolated backend served the LIVE database's flags (and the live backend, for a cache TTL at a
 * time, the test database's). The visible symptom was a customer's slots vanishing and returning.
 */
import { describe, expect, test } from "bun:test";
import { redisUrlForDatabase } from "../lib/isolated-redis";
import { LIVE_PROVIDER_FLAGS, liveProviderAllowed } from "../lib/test-egress";
import { paymentMocksAllowed } from "../lib/payment-mocks";

const dev = "redis://localhost:6379";
const testDb = "postgresql://u:p@localhost:5433/homigo_test?connection_limit=5";
const liveDb = "postgresql://u:p@localhost:5432/homigo_db";

describe("a process on an isolated database does not reach real providers", () => {
  const isolated = { NODE_ENV: "development", DATABASE_URL: testDb } as NodeJS.ProcessEnv;
  const developer = { NODE_ENV: "development", DATABASE_URL: liveDb } as NodeJS.ProcessEnv;

  test("an isolated stack started in development mode is behind the same barrier as the test suite", () => {
    for (const flag of LIVE_PROVIDER_FLAGS) expect({ flag, allowed: liveProviderAllowed(flag, isolated) }).toEqual({ flag, allowed: false });
  });
  test("the explicit opt-in still opens one provider", () => {
    expect(liveProviderAllowed("HOMIGO_REQUIRE_RAZORPAY", { ...isolated, HOMIGO_REQUIRE_RAZORPAY: "1" })).toBe(true);
    expect(liveProviderAllowed("HOMIGO_REQUIRE_SMS", { ...isolated, HOMIGO_REQUIRE_RAZORPAY: "1" })).toBe(false);
  });
  test("the developer's own backend and a deployed one are unchanged", () => {
    for (const flag of LIVE_PROVIDER_FLAGS) expect(liveProviderAllowed(flag, developer)).toBe(true);
    expect(liveProviderAllowed("HOMIGO_REQUIRE_SMS", { NODE_ENV: "production", DATABASE_URL: liveDb } as NodeJS.ProcessEnv)).toBe(true);
  });
  test("payment mocks follow: on for an isolated stack, never on a deployed environment", () => {
    expect(paymentMocksAllowed(isolated)).toBe(true);
    expect(paymentMocksAllowed(developer)).toBe(false);
    expect(paymentMocksAllowed({ NODE_ENV: "production", DATABASE_URL: testDb } as NodeJS.ProcessEnv)).toBe(false);
    expect(paymentMocksAllowed({ APP_ENV: "staging", DATABASE_URL: testDb } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("redisUrlForDatabase", () => {
  test("an isolated database with no Redis named by the launcher gets none, whatever a dotenv file says", () => {
    expect(redisUrlForDatabase({ databaseUrl: testDb, launcherRedisUrl: undefined, effectiveRedisUrl: dev })).toEqual({ url: "", isolated: true });
    expect(redisUrlForDatabase({ databaseUrl: testDb, launcherRedisUrl: "", effectiveRedisUrl: dev })).toEqual({ url: "", isolated: true });
    expect(redisUrlForDatabase({ databaseUrl: testDb, launcherRedisUrl: "   ", effectiveRedisUrl: dev })).toEqual({ url: "", isolated: true });
  });

  test("an isolated database keeps a Redis its launcher named explicitly (CI gives the suite its own)", () => {
    expect(redisUrlForDatabase({ databaseUrl: testDb, launcherRedisUrl: "redis://ci-redis:6379/3", effectiveRedisUrl: dev })).toEqual({ url: "redis://ci-redis:6379/3", isolated: false });
  });

  test("the developer's and the deployed database are untouched", () => {
    expect(redisUrlForDatabase({ databaseUrl: liveDb, launcherRedisUrl: undefined, effectiveRedisUrl: dev })).toEqual({ url: dev, isolated: false });
    expect(redisUrlForDatabase({ databaseUrl: liveDb, launcherRedisUrl: undefined, effectiveRedisUrl: undefined })).toEqual({ url: "", isolated: false });
  });

  test("the database name decides, not the host or a query parameter", () => {
    expect(redisUrlForDatabase({ databaseUrl: "postgresql://u:p@test-host:5432/homigo_db?application_name=test", launcherRedisUrl: undefined, effectiveRedisUrl: dev }).isolated).toBe(false);
    expect(redisUrlForDatabase({ databaseUrl: "postgresql://u:p@db:5432/homigo_rehearsal_test_2", launcherRedisUrl: undefined, effectiveRedisUrl: dev }).isolated).toBe(true);
    expect(redisUrlForDatabase({ databaseUrl: undefined, launcherRedisUrl: undefined, effectiveRedisUrl: dev })).toEqual({ url: dev, isolated: false });
  });
});

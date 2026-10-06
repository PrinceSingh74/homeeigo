/**
 * One rule for every paid/outward third-party call from a TEST runtime.
 *
 * `.env.test` is layered on top of `.env`, so a test process inherits the developer's REAL provider
 * credentials. Release certification (2026-09-20) put an egress witness on the `bun test` processes
 * and caught live connections to api.twilio.com and maps.googleapis.com during the suites: OTP tests
 * were sending real SMS to fixture phone numbers until the Twilio account hit its 50/day limit, and
 * address/ETA paths were spending Google Maps quota.
 *
 * Outside NODE_ENV=test nothing changes. Inside it, a provider is reachable only with its explicit
 * opt-in flag set to "1" — having credentials in the environment is never enough.
 *
 * This is the first of two layers. The second is the preload
 * `src/__tests__/helpers/no-external-egress.ts`, which blocks any non-loopback socket the suite
 * opens, whichever client library opens it. This layer keeps the services *behaving* correctly
 * (degrading to their unconfigured path) instead of throwing a connection error.
 */
export type LiveProviderFlag =
  | "HOMIGO_REQUIRE_SMS"
  | "HOMIGO_REQUIRE_MAPS"
  | "HOMIGO_REQUIRE_RAZORPAY"
  | "HOMIGO_REQUIRE_EMAIL"
  | "HOMIGO_REQUIRE_PUSH"
  | "HOMIGO_REQUIRE_S3"
  | "HOMIGO_REQUIRE_AI";

export function liveProviderAllowed(flag: LiveProviderFlag, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "test" && !onIsolatedDatabase(env)) return true;
  return env[flag] === "1";
}

/**
 * This process is on a disposable database (its name contains "test").
 *
 * An isolated verification stack runs with NODE_ENV=development so that it behaves like the app a
 * developer sees, and it loads `.env`, which holds the REAL provider credentials. Keying the barrier
 * on NODE_ENV alone therefore left such a stack free to create real payment orders, send real SMS
 * and spend maps quota against fixture data (found 2026-10-06, before any such call was made). The
 * database is the better witness: whatever mode the process claims, work on a test database is test
 * work.
 */
export function onIsolatedDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  const name = (env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  return /test/i.test(name);
}

/** Every provider flag, for the barrier's own coverage test. */
export const LIVE_PROVIDER_FLAGS: LiveProviderFlag[] = [
  "HOMIGO_REQUIRE_SMS",
  "HOMIGO_REQUIRE_MAPS",
  "HOMIGO_REQUIRE_RAZORPAY",
  "HOMIGO_REQUIRE_EMAIL",
  "HOMIGO_REQUIRE_PUSH",
  "HOMIGO_REQUIRE_S3",
  "HOMIGO_REQUIRE_AI",
];

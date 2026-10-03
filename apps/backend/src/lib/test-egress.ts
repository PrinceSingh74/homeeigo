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

export function liveProviderAllowed(flag: LiveProviderFlag): boolean {
  if (process.env.NODE_ENV !== "test") return true;
  return process.env[flag] === "1";
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

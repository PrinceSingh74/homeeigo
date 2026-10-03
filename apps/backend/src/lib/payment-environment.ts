/**
 * §8 — which Razorpay world the platform is actually talking to.
 *
 * The key id says it, not a config flag someone can set wrongly: Razorpay issues `rzp_test_…` for
 * Test Mode and `rzp_live_…` for Live Mode. Deriving the environment from the credential itself
 * means a `.env` that claims one thing while holding the other cannot be believed — the credential
 * wins, and the disagreement is reported rather than resolved silently.
 *
 * Nothing here logs, returns or embeds a secret. The key SECRET is never read; only the key ID's
 * prefix is inspected, and even that is reported as a prefix, never in full.
 */
import { isDeployedEnvironment } from "./deployed-environment";

export type PaymentEnvironment = "TEST" | "LIVE" | "UNCONFIGURED";

export type PaymentEnvironmentVerdict = {
  environment: PaymentEnvironment;
  /**
   * A dangerous disagreement between the credential and the runtime. Null when they agree, or when
   * nothing is configured (a local machine with no keys is not a mismatch, it is just unconfigured).
   */
  mismatch:
    | null
    /** Live credentials on a machine that is not a deployed host: real money, local code. */
    | "LIVE_KEYS_OUTSIDE_DEPLOYED_ENVIRONMENT"
    /** A deployed host holding Test credentials: customers would be charged nothing, silently. */
    | "TEST_KEYS_ON_DEPLOYED_HOST"
    /** Neither prefix. The credential cannot be classified, so it must not be trusted as either. */
    | "UNRECOGNISED_KEY_FORMAT";
  /** Safe to log and to show an authorised admin: the prefix only, never the key. */
  keyPrefix: string | null;
};

const LIVE_PREFIX = "rzp_live_";
const TEST_PREFIX = "rzp_test_";

/**
 * Classify the configured gateway credential.
 *
 * `deployed` is injectable so the rule can be tested for every combination without moving the
 * process into production.
 */
export function resolvePaymentEnvironment(
  keyId: string | undefined | null,
  deployed: boolean = isDeployedEnvironment(),
): PaymentEnvironmentVerdict {
  const key = (keyId ?? "").trim();
  if (!key) return { environment: "UNCONFIGURED", mismatch: null, keyPrefix: null };

  if (key.startsWith(LIVE_PREFIX)) {
    return {
      environment: "LIVE",
      mismatch: deployed ? null : "LIVE_KEYS_OUTSIDE_DEPLOYED_ENVIRONMENT",
      keyPrefix: LIVE_PREFIX,
    };
  }
  if (key.startsWith(TEST_PREFIX)) {
    return {
      environment: "TEST",
      mismatch: deployed ? "TEST_KEYS_ON_DEPLOYED_HOST" : null,
      keyPrefix: TEST_PREFIX,
    };
  }
  /**
   * An unclassifiable credential is NOT assumed to be Test.
   *
   * Assuming Test is the tempting default — it feels like the safe one — but it is the dangerous
   * one: it would let an unrecognised live-issued credential move real money while every log and
   * every admin screen said "TEST".
   */
  return { environment: "UNCONFIGURED", mismatch: "UNRECOGNISED_KEY_FORMAT", keyPrefix: null };
}

/** One line for boot logs and admin diagnostics. Contains no secret. */
export function describePaymentEnvironment(v: PaymentEnvironmentVerdict): string {
  const base = `payment environment: ${v.environment}${v.keyPrefix ? ` (${v.keyPrefix}…)` : ""}`;
  return v.mismatch ? `${base} — MISMATCH: ${v.mismatch}` : base;
}

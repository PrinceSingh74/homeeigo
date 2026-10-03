import { isDeployedEnvironment } from "./deployed-environment";
import { emailService } from "../services/email.service";
import { razorpayService } from "../services/razorpay.service";
import { redisClient } from "./redis";
import { parseDdlTarget } from "./ddl-target-guard";

export type ProductionConfigError = { key: string; message: string };

/**
 * Switches that make the platform easier to test by making it less safe.
 *
 * Each is legitimate on a developer machine and none may survive a deployment. They are checked
 * centrally and at boot rather than only at each use site, because the failure mode is silent: a
 * bypass that is read lazily inside a request handler produces a weaker system that still starts,
 * still answers `/health`, and reports nothing unusual until the control it disabled was needed.
 *
 * `LOAD_TEST_MODE` and `HOMIGO_ALLOW_PAYMENT_MOCKS` are already refused at their use sites
 * (`api-rate-limit.middleware.ts`, `payment-mocks.ts`). They are repeated here deliberately: a
 * deployed process should not merely ignore them, it should refuse to start while they are set, so
 * the operator learns the configuration is wrong instead of assuming it took effect.
 */
const UNSAFE_IN_DEPLOYED_ENV: Array<{ key: string; unsafeWhen: (v: string) => boolean; effect: string }> = [
  { key: "LOAD_TEST_MODE", unsafeWhen: (v) => v === "1", effect: "disables the global API rate limit" },
  { key: "HOMIGO_ALLOW_PAYMENT_MOCKS", unsafeWhen: (v) => v === "1", effect: "enables payment-signature mocking" },
  { key: "AI_RATE_LIMIT_BYPASS", unsafeWhen: (v) => v === "true", effect: "disables all AI gateway rate limiting" },
  { key: "AI_TOOL_CERTIFICATION_MODE", unsafeWhen: (v) => v === "true", effect: "bypasses per-tool AI rate limits" },
  { key: "AI_GATEWAY_DRY_RUN", unsafeWhen: (v) => v === "true", effect: "returns canned AI responses instead of calling a provider" },
  { key: "SERVICE_START_OTP_REQUIRED", unsafeWhen: (v) => v === "false", effect: "lets a job be started without the customer's PIN" },
  { key: "AI_TOOLS_FINANCIAL_SANDBOX", unsafeWhen: (v) => v === "true", effect: "routes AI financial tools to a sandbox" },
  { key: "HOMIGO_ALLOW_EXTERNAL", unsafeWhen: (v) => v === "1" || v === "true", effect: "lifts the test-egress barrier on external providers" },
  { key: "MIGRATION_SAFETY_OVERRIDE", unsafeWhen: (v) => v.length > 0, effect: "overrides the destructive-migration gate" },
  { key: "HOMIGO_DDL_CONFIRM", unsafeWhen: (v) => v.length > 0, effect: "pre-confirms DDL against the configured database" },
];

/** Collected for both staging and production — staging is a deployed host, not a laptop. */
export function unsafeBypassErrors(): ProductionConfigError[] {
  const errors: ProductionConfigError[] = [];
  for (const { key, unsafeWhen, effect } of UNSAFE_IN_DEPLOYED_ENV) {
    const raw = process.env[key]?.trim();
    if (raw && unsafeWhen(raw)) {
      errors.push({ key, message: `${key} must not be set in a deployed environment — it ${effect}` });
    }
  }
  return errors;
}

export function validateProductionConfig(): ProductionConfigError[] {
  // Deployment, not NODE_ENV. `.env.staging` ships NODE_ENV=development, so the previous
  // `NODE_ENV !== "production"` early return skipped EVERYTHING below on staging — including the
  // unsafe-bypass check whose own comment says "applies to staging as well", and the OTP_SECRET
  // check that stops OTP services falling back to the literal "unsafe-dev-otp-secret". Measured on
  // 2026-09-21: `.env.staging` sets neither OTP_SECRET nor ENCRYPTION_KEY, and nothing refused it.
  if (!isDeployedEnvironment()) return [];

  const errors: ProductionConfigError[] = [];
  const isStaging = process.env.APP_ENV === "staging";

  // Applies to staging as well: the early return below must not let a bypass through.
  errors.push(...unsafeBypassErrors());

  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    errors.push({ key: "JWT", message: "JWT_SECRET and JWT_REFRESH_SECRET are required in production" });
  }
  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    errors.push({
      key: "ENCRYPTION_KEY",
      message: "ENCRYPTION_KEY must be 64 hex characters (256 bits) in production",
    });
  }
  const otpSecret = process.env.OTP_SECRET?.trim();
  if (!otpSecret || otpSecret === "unsafe-dev-otp-secret" || otpSecret.length < 16) {
    errors.push({
      key: "OTP_SECRET",
      message: "A strong OTP_SECRET is required in production (min 16 chars)",
    });
  }
  if (!process.env.REDIS_URL?.trim()) {
    errors.push({ key: "REDIS", message: "REDIS_URL is required in production for rate limits and WS fan-out" });
  } else if (!redisClient.isAvailable) {
    errors.push({ key: "REDIS", message: "REDIS_URL is set but Redis is not reachable at startup" });
  }
  // The database is not optional, and a deployed host pointed at a *test* database is a misrouted
  // deployment (or a test run pointed at a deployed config) — either way it must not start.
  const dbTarget = parseDdlTarget(process.env.DATABASE_URL);
  if (!dbTarget) {
    errors.push({ key: "DATABASE_URL", message: "DATABASE_URL is required and must be a postgres URL" });
  } else if (dbTarget.isTestDatabase) {
    errors.push({ key: "DATABASE_URL", message: "a deployed host must not run against a test database" });
  }

  // Staging runs NODE_ENV=production but must not require live payouts or prod-only integrations.
  if (isStaging) {
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
    if (razorpayKeyId.startsWith("rzp_live_")) {
      errors.push({ key: "RAZORPAY_KEY_ID", message: "staging must not use live Razorpay credentials" });
    }
    return errors;
  }

  if (!razorpayService.isConfigured) {
    errors.push({ key: "RAZORPAY", message: "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production" });
  }
  if (!razorpayService.isWebhookConfigured) {
    errors.push({ key: "RAZORPAY_WEBHOOK", message: "RAZORPAY_WEBHOOK_SECRET is required in production" });
  }
  if (!process.env.RAZORPAY_ACCOUNT_NUMBER?.trim()) {
    errors.push({
      key: "RAZORPAY_ACCOUNT_NUMBER",
      message: "RAZORPAY_ACCOUNT_NUMBER is required in production for RazorpayX payouts",
    });
  }
  if (!emailService.isConfigured) {
    errors.push({ key: "EMAIL", message: "RESEND_API_KEY is required in production" });
  }
  /**
   * Object storage must be a decision, not a fallback. With no bucket the service silently writes
   * chargeback evidence, partner documents and support attachments to the local disk — which on a
   * container platform is wiped on every restart. Either a bucket, or OBJECT_STORAGE_DRIVER=local set
   * on purpose (a single VM with a persistent, backed-up disk).
   */
  const storageDriver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();
  if (!process.env.AWS_S3_BUCKET?.trim() && storageDriver !== "local") {
    errors.push({
      key: "OBJECT_STORAGE",
      message: "set AWS_S3_BUCKET, or OBJECT_STORAGE_DRIVER=local deliberately (local disk must be persistent)",
    });
  }
  // Public origins are used in CORS, e-mail links and redirects; plain http or a loopback origin in
  // production is always a configuration slip. PUBLIC_API_ORIGIN addresses stored rating photos — without
  // it they could only be built from the request's Host header (lib/rating-photos refuses to).
  if (!process.env.PUBLIC_API_ORIGIN?.trim()) {
    errors.push({ key: "PUBLIC_API_ORIGIN", message: "PUBLIC_API_ORIGIN (this API's public https origin) is required in production" });
  }
  for (const key of ["FRONTEND_URL", "PARTNER_WEB_URL", "ADMIN_WEB_URL", "PUBLIC_API_ORIGIN"] as const) {
    const value = process.env[key]?.trim();
    if (value && !isPublicHttpsOrigin(value)) {
      errors.push({ key, message: `${key} must be a public https origin in production` });
    }
  }

  return errors;
}

function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.0\.2\.2)/.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Deployed-host settings that are not wrong enough to refuse boot but must not go unnoticed.
 * Logged once at startup next to assertProductionConfig.
 */
export function productionConfigWarnings(): ProductionConfigError[] {
  if (!isDeployedEnvironment()) return [];
  const warnings: ProductionConfigError[] = [];
  const trustProxy = process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production";
  if (trustProxy && !process.env.TRUST_PROXY_HOPS?.trim()) {
    warnings.push({
      key: "TRUST_PROXY_HOPS",
      message: "unset: the client IP is the LEFT-most X-Forwarded-For entry, which the client controls — set it to the number of trusted proxies",
    });
  }
  // Not errors: these fall back to ENCRYPTION_KEY, and forcing a new value would make existing
  // ciphertext/hashes unreadable. They should be set explicitly — to the value in use today.
  for (const key of ["MASTER_ENCRYPTION_KEY", "HASH_HMAC_KEY"] as const) {
    if (!process.env[key]?.trim()) {
      warnings.push({ key, message: "unset: falls back to ENCRYPTION_KEY (no key separation)" });
    }
  }
  return warnings;
}

export function assertProductionConfig(): void {
  const errors = validateProductionConfig();
  if (errors.length > 0) {
    const msg = errors.map((e) => `${e.key}: ${e.message}`).join("; ");
    throw new Error(`Production configuration invalid — ${msg}`);
  }
}

import { emailService } from "../services/email.service";
import { razorpayService } from "../services/razorpay.service";
import { redisClient } from "./redis";

export type ProductionConfigError = { key: string; message: string };

export function validateProductionConfig(): ProductionConfigError[] {
  if (process.env.NODE_ENV !== "production") return [];

  const errors: ProductionConfigError[] = [];
  const isStaging = process.env.APP_ENV === "staging";

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

  return errors;
}

export function assertProductionConfig(): void {
  const errors = validateProductionConfig();
  if (errors.length > 0) {
    const msg = errors.map((e) => `${e.key}: ${e.message}`).join("; ");
    throw new Error(`Production configuration invalid — ${msg}`);
  }
}

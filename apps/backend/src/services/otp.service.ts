import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import twilio from "twilio";
import { userPiiService } from "./user-pii.service";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";

export class OTPService {
  private readonly twilioPhoneNumber: string;
  private readonly twilioClient: twilio.Twilio | null;
  private readonly otpSecret: string;

  constructor(private readonly prisma: PrismaClient) {
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || "";
    this.otpSecret = process.env.OTP_SECRET || "unsafe-dev-otp-secret";
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.twilioClient = sid && token ? twilio(sid, token) : null;
  }

  private generateOTP(): string {
    return `${crypto.randomInt(100000, 999999)}`;
  }

  private hashOTP(otp: string): string {
    return crypto.createHash("sha256").update(`${otp}:${this.otpSecret}`).digest("hex");
  }

  async sendOTP(phoneNumber: string, userId?: string) {
    const phoneHash = userPiiService.hashPhone(phoneNumber);
    // Production stays strict; local dev needs a higher ceiling for repeated testing.
    const hourlyLimit = process.env.NODE_ENV === "production"
      ? 3
      : Number(process.env.OTP_HOURLY_LIMIT) || 50;

    // ATOMIC anti-flood gate. The DB count() below is a TOCTOU race under concurrency
    // (N parallel requests all read count<limit before any insert → flood). The Redis
    // INCR limiter (per-process atomic fallback when Redis is down) enforces the cap
    // atomically; the DB count remains a persistent backstop across restarts/flushes.
    const gate = await consumeRateLimitSmart(`otp:send:${phoneHash}`, hourlyLimit, 60 * 60 * 1000);
    if (!gate.allowed) {
      return { success: false, message: "Too many OTP requests", error: "RATE_LIMIT_EXCEEDED" };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await this.prisma.oTP.count({
      where: {
        OR: [{ phoneHash }, { phoneNumber }],
        createdAt: { gte: oneHourAgo },
        isUsed: false,
      },
    });
    if (count >= hourlyLimit) {
      return { success: false, message: "Too many OTP requests", error: "RATE_LIMIT_EXCEEDED" };
    }

    if (process.env.NODE_ENV === "production" && (!this.twilioClient || !this.twilioPhoneNumber)) {
      return {
        success: false,
        message: "SMS provider is not configured",
        error: "TWILIO_NOT_CONFIGURED",
      };
    }

    const otp = this.generateOTP();
    await this.prisma.oTP.create({
      data: {
        userId,
        phoneNumber: null,
        phoneHash,
        otpHash: this.hashOTP(otp),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const smsEnabled = process.env.SMS_ENABLED !== "false";
    const usingTwilio = smsEnabled && Boolean(this.twilioClient && this.twilioPhoneNumber);
    if (usingTwilio && this.twilioClient) {
      try {
        const message = await this.twilioClient.messages.create({
          body: `Your HOMEEIGO verification code is: ${otp}. Expires in 5 minutes.`,
          from: this.twilioPhoneNumber,
          to: phoneNumber,
        });
        if (process.env.NODE_ENV !== "production") {
          console.log(`[OTP] Twilio SMS sent sid=${message.sid} to=${phoneNumber}`);
        }
      } catch (err) {
        const twilioMsg = err instanceof Error ? err.message : "SMS delivery failed";
        // Non-production: Twilio trial accounts cannot SMS arbitrary numbers — keep OTP for E2E/dev.
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[OTP] Twilio send failed (dev fallback) to=${phoneNumber}:`, twilioMsg);
          return {
            success: true,
            message: "OTP sent successfully (dev fallback — Twilio SMS skipped)",
            devOtp: otp,
          };
        }
        await this.prisma.oTP.deleteMany({ where: { phoneHash, otpHash: this.hashOTP(otp) } });
        console.error(`[OTP] Twilio send failed to=${phoneNumber}:`, twilioMsg);
        return {
          success: false,
          message: twilioMsg.includes("unverified")
            ? "This phone number must be verified in Twilio before SMS can be sent (trial account)."
            : "Could not send SMS. Please try again.",
          error: "SMS_DELIVERY_FAILED",
        };
      }
    } else if (!smsEnabled) {
      console.log(`[OTP] SMS_ENABLED=false — logging OTP for ${phoneNumber}`);
    } else {
      console.log(
        [
          "",
          "  ┌──────────────────────────────────────────────┐",
          "  │           HOMIGO DEV OTP (no SMS sent)         │",
          "  ├──────────────────────────────────────────────┤",
          `  │  Phone : ${phoneNumber.padEnd(36)}│`,
          `  │  OTP   : ${otp.padEnd(36)}│`,
          "  │  Valid : 5 minutes                             │",
          "  └──────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    }

    // In non-production we surface the OTP so the UI can show it without SMS.
    const exposeDevOtp = !usingTwilio && process.env.NODE_ENV !== "production";
    return {
      success: true,
      message: "OTP sent successfully",
      ...(exposeDevOtp ? { devOtp: otp } : {}),
    };
  }

  async verifyOTP(phoneNumber: string, otp: string) {
    const phoneHash = userPiiService.hashPhone(phoneNumber);
    const storedOTP = await this.prisma.oTP.findFirst({
      where: {
        OR: [{ phoneHash }, { phoneNumber }],
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!storedOTP) return { isValid: false, error: "No valid OTP found" };
    if (storedOTP.attemptCount >= 3) return { isValid: false, error: "Max attempts exceeded" };

    if (storedOTP.otpHash !== this.hashOTP(otp)) {
      await this.prisma.oTP.update({
        where: { id: storedOTP.id },
        data: { attemptCount: { increment: 1 } },
      });
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[OTP] failed attempt phone=${phoneNumber} id=${storedOTP.id}`);
      }
      return { isValid: false, error: "Invalid OTP" };
    }

    await this.prisma.oTP.update({
      where: { id: storedOTP.id },
      data: { isUsed: true, usedAt: new Date() },
    });
    return { isValid: true, userId: storedOTP.userId ?? undefined };
  }

  async deleteExpiredOTPs(): Promise<number> {
    const result = await this.prisma.oTP.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }

  async deleteOldUsedOTPs(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.oTP.deleteMany({
      where: { isUsed: true, usedAt: { lt: cutoff } },
    });
    return result.count;
  }
}

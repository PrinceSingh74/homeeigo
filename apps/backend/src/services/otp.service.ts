import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import twilio from "twilio";

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
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const count = await this.prisma.oTP.count({
      where: { phoneNumber, createdAt: { gte: oneHourAgo }, isUsed: false },
    });
    if (count >= 3) return { success: false, message: "Too many OTP requests", error: "RATE_LIMIT_EXCEEDED" };

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
        phoneNumber,
        otpHash: this.hashOTP(otp),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    if (this.twilioClient && this.twilioPhoneNumber) {
      await this.twilioClient.messages.create({
        body: `Your HOMIGO verification code is: ${otp}. Expires in 5 minutes.`,
        from: this.twilioPhoneNumber,
        to: phoneNumber,
      });
    } else {
      console.log(`[DEV OTP] ${phoneNumber}: ${otp}`);
    }

    return { success: true, message: "OTP sent successfully" };
  }

  async verifyOTP(phoneNumber: string, otp: string) {
    const storedOTP = await this.prisma.oTP.findFirst({
      where: { phoneNumber, isUsed: false, expiresAt: { gt: new Date() } },
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

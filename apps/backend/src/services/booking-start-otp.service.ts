import crypto from "crypto";
import twilio from "twilio";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { emailService } from "./email.service";
import { encryptionService } from "./encryption.service";
import { notificationService } from "./notification.service";
import { userPiiService } from "./user-pii.service";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";

/**
 * Service-start verification ("start PIN") — proof-of-presence gate.
 *
 * When the partner is at the doorstep and taps "Start job", a 6-digit PIN is
 * dispatched to the CUSTOMER (in-app notification + email + SMS). The partner
 * can only begin work after the customer reads the PIN back to them in person.
 *
 * Security posture:
 *  - only a salted SHA-256 hash is persisted; plaintext travels solely over
 *    the customer's own channels
 *  - the hash is bound to the bookingId, so a code for one job can never be
 *    replayed against another
 *  - constant-time comparison, max 5 attempts per code, 10-minute expiry,
 *    30-second resend cooldown, 6 sends/hour/booking flood cap
 *  - verification stamps `booking.startOtpVerifiedAt`, which is the durable
 *    gate `POST /bookings/:id/start` checks — retries after a network error
 *    do not demand a fresh code
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_SENDS_PER_HOUR = 6;

const STARTABLE_STATUSES = ["ACCEPTED", "ASSIGNED", "EN_ROUTE"] as const;

export type StartOtpIssueResult =
  | {
      ok: true;
      alreadyVerified: boolean;
      channels: string[];
      sentTo: { email: string | null; phone: string | null };
      expiresInSec: number;
      resendInSec: number;
    }
  | {
      ok: false;
      error: "NOT_FOUND" | "INVALID_STATUS" | "RESEND_COOLDOWN" | "RATE_LIMITED";
      retryAfterSec?: number;
    };

export type StartOtpVerifyResult =
  | { ok: true; alreadyVerified: boolean }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        | "OTP_REQUIRED"
        | "OTP_NOT_REQUESTED"
        | "OTP_EXPIRED"
        | "OTP_LOCKED"
        | "OTP_INVALID";
      attemptsLeft?: number;
    };

class BookingStartOtpService {
  private readonly secret = process.env.OTP_SECRET || "unsafe-dev-otp-secret";
  private readonly twilioClient: twilio.Twilio | null;
  private readonly twilioFrom: string;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.twilioClient = sid && token ? twilio(sid, token) : null;
    this.twilioFrom = process.env.TWILIO_PHONE_NUMBER || "";
  }

  /** Enforcement is on unless explicitly disabled (ops escape hatch). */
  get isRequired(): boolean {
    return process.env.SERVICE_START_OTP_REQUIRED !== "false";
  }

  /** Binding the hash to the booking prevents cross-booking replay. */
  private hash(bookingId: string, otp: string): string {
    return crypto
      .createHash("sha256")
      .update(`start:${bookingId}:${otp}:${this.secret}`)
      .digest("hex");
  }

  /**
   * Issue (or re-issue) the start PIN and dispatch it to the customer.
   * Called when the partner opens the "Start job" verification sheet.
   */
  async issue(providerId: string, bookingId: string): Promise<StartOtpIssueResult> {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, providerId },
      select: {
        id: true,
        status: true,
        startOtpVerifiedAt: true,
        userId: true,
        user: true,
        service: { select: { name: true } },
        provider: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!booking) return { ok: false, error: "NOT_FOUND" };

    if (booking.startOtpVerifiedAt) {
      return {
        ok: true,
        alreadyVerified: true,
        channels: [],
        sentTo: { email: null, phone: null },
        expiresInSec: 0,
        resendInSec: 0,
      };
    }

    if (!STARTABLE_STATUSES.includes(booking.status as (typeof STARTABLE_STATUSES)[number])) {
      return { ok: false, error: "INVALID_STATUS" };
    }

    // Resend cooldown — the latest active code governs it.
    const latest = await prisma.bookingStartOtp.findFirst({
      where: { bookingId, isUsed: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latest) {
      const sinceMs = Date.now() - latest.createdAt.getTime();
      if (sinceMs < RESEND_COOLDOWN_MS) {
        return {
          ok: false,
          error: "RESEND_COOLDOWN",
          retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - sinceMs) / 1000),
        };
      }
    }

    // Atomic flood cap per booking (Redis with in-process fallback).
    const gate = await consumeRateLimitSmart(
      `booking-start-otp:${bookingId}`,
      MAX_SENDS_PER_HOUR,
      60 * 60 * 1000,
    );
    if (!gate.allowed) return { ok: false, error: "RATE_LIMITED" };

    const otp = `${crypto.randomInt(100000, 999999)}`;
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Exactly one active code per booking: kill previous ones, then create.
    const channels: string[] = [];
    const partnerName = booking.provider
      ? `${booking.provider.user.firstName} ${booking.provider.user.lastName}`.trim()
      : "Your professional";
    const serviceTitle = booking.service?.name ?? "your booked service";

    // Encrypted-at-rest copy lets the booking OWNER read their own PIN in-app.
    // Best-effort: if the KMS hiccups, delivery channels still carry the code.
    let otpCiphertext: string | null = null;
    try {
      const enc = await encryptionService.encrypt(otp, "PII", booking.userId);
      otpCiphertext = enc.ciphertext;
    } catch (err) {
      logger.warn("start_otp_encrypt_failed", {
        category: "APPLICATION",
        bookingId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }

    await prisma.$transaction([
      prisma.bookingStartOtp.updateMany({
        where: { bookingId, isUsed: false },
        data: { expiresAt: new Date() },
      }),
      prisma.bookingStartOtp.create({
        data: { bookingId, otpHash: this.hash(bookingId, otp), otpCiphertext, expiresAt },
      }),
    ]);

    // ---- Delivery (customer-owned channels only) -----------------------
    const { email, phoneNumber } = await userPiiService.resolveEmailAndPhone(booking.user, {
      actorId: booking.userId,
      authorized: true,
    });

    // 1. In-app notification — always available, instant, shows in the bell.
    try {
      await notificationService.createForUser({
        userId: booking.userId,
        type: "SERVICE_START_OTP",
        title: "Service start PIN",
        message: `Your start PIN is ${otp}. Share it with ${partnerName} in person to begin your ${serviceTitle}. Valid for 10 minutes.`,
        referenceId: bookingId,
        referenceType: "booking",
        priority: "high",
      });
      channels.push("app");
    } catch (err) {
      logger.warn("start_otp_notification_failed", {
        category: "APPLICATION",
        bookingId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }

    // 2. Email — premium template with anti-phishing guidance.
    if (email) {
      const sent = await emailService.sendServiceStartOtp(
        email,
        { otp, serviceTitle, partnerName, expiresMinutes: OTP_TTL_MS / 60_000 },
        booking.user.firstName,
      );
      if (sent.delivered) channels.push("email");
    }

    // 3. SMS — only when Twilio is configured and enabled.
    if (phoneNumber && this.twilioClient && this.twilioFrom && process.env.SMS_ENABLED !== "false") {
      try {
        await this.twilioClient.messages.create({
          body: `HOMEEIGO start PIN: ${otp}. Share only in person with ${partnerName} to begin your service. Valid 10 min.`,
          from: this.twilioFrom,
          to: phoneNumber,
        });
        channels.push("sms");
      } catch (err) {
        logger.warn("start_otp_sms_failed", {
          category: "APPLICATION",
          bookingId,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    // Audit trail: record which channels actually carried the code.
    await prisma.bookingStartOtp.updateMany({
      where: { bookingId, isUsed: false, expiresAt: { gt: new Date() } },
      data: { channels },
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(
        [
          "",
          "  ┌──────────────────────────────────────────────┐",
          "  │      HOMIGO SERVICE-START PIN (dev log)        │",
          "  ├──────────────────────────────────────────────┤",
          `  │  Booking : ${bookingId.padEnd(34)}│`,
          `  │  PIN     : ${otp.padEnd(34)}│`,
          "  │  Valid   : 10 minutes                          │",
          "  └──────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    }

    const masked = userPiiService.maskUserPii({ email, phoneNumber });
    return {
      ok: true,
      alreadyVerified: false,
      channels,
      sentTo: { email: masked.email, phone: masked.phoneNumber },
      expiresInSec: OTP_TTL_MS / 1000,
      resendInSec: RESEND_COOLDOWN_MS / 1000,
    };
  }

  /**
   * Verify the PIN the partner typed and, on success, durably stamp
   * `startOtpVerifiedAt` so job-start retries never re-prompt.
   */
  async verify(providerId: string, bookingId: string, otp: string): Promise<StartOtpVerifyResult> {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, providerId },
      select: { id: true, startOtpVerifiedAt: true },
    });
    if (!booking) return { ok: false, error: "NOT_FOUND" };
    if (booking.startOtpVerifiedAt) return { ok: true, alreadyVerified: true };

    const normalized = otp.trim();
    if (!/^\d{6}$/.test(normalized)) return { ok: false, error: "OTP_INVALID" };

    const record = await prisma.bookingStartOtp.findFirst({
      where: { bookingId, isUsed: false },
      orderBy: { createdAt: "desc" },
    });
    if (!record) return { ok: false, error: "OTP_NOT_REQUESTED" };
    if (record.expiresAt.getTime() <= Date.now()) return { ok: false, error: "OTP_EXPIRED" };
    if (record.attemptCount >= record.maxAttempts) return { ok: false, error: "OTP_LOCKED" };

    const expected = Buffer.from(record.otpHash, "hex");
    const actual = Buffer.from(this.hash(bookingId, normalized), "hex");
    const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

    if (!matches) {
      const updated = await prisma.bookingStartOtp.update({
        where: { id: record.id },
        data: { attemptCount: { increment: 1 } },
        select: { attemptCount: true, maxAttempts: true },
      });
      const attemptsLeft = Math.max(0, updated.maxAttempts - updated.attemptCount);
      logger.warn("start_otp_invalid_attempt", {
        category: "SECURITY",
        bookingId,
        providerId,
        attemptsLeft,
      });
      return attemptsLeft === 0
        ? { ok: false, error: "OTP_LOCKED" }
        : { ok: false, error: "OTP_INVALID", attemptsLeft };
    }

    await prisma.$transaction([
      prisma.bookingStartOtp.update({
        where: { id: record.id },
        data: { isUsed: true, usedAt: new Date() },
      }),
      prisma.booking.update({
        where: { id: bookingId },
        data: { startOtpVerifiedAt: new Date() },
      }),
    ]);

    logger.info("start_otp_verified", { category: "SECURITY", bookingId, providerId });
    return { ok: true, alreadyVerified: false };
  }

  /**
   * The CUSTOMER's own view of their start PIN (Urban-Company style in-app
   * display). Owner-only: the partner can never reach this — the whole gate
   * relies on the code travelling person-to-person at the doorstep.
   */
  async customerView(
    userId: string,
    bookingId: string,
  ): Promise<
    | { ok: false; error: "NOT_FOUND" }
    | {
        ok: true;
        state: "verified" | "waiting" | "active";
        pin: string | null;
        expiresAt: string | null;
        verifiedAt: string | null;
      }
  > {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: { startOtpVerifiedAt: true },
    });
    if (!booking) return { ok: false, error: "NOT_FOUND" };

    if (booking.startOtpVerifiedAt) {
      return {
        ok: true,
        state: "verified",
        pin: null,
        expiresAt: null,
        verifiedAt: booking.startOtpVerifiedAt.toISOString(),
      };
    }

    const record = await prisma.bookingStartOtp.findFirst({
      where: { bookingId, isUsed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { otpCiphertext: true, expiresAt: true, attemptCount: true, maxAttempts: true },
    });

    // No live code (not requested yet, expired, or locked out) — the partner
    // will trigger a fresh one from their side.
    if (!record || record.attemptCount >= record.maxAttempts || !record.otpCiphertext) {
      return { ok: true, state: "waiting", pin: null, expiresAt: null, verifiedAt: null };
    }

    let pin: string | null = null;
    try {
      pin = await encryptionService.decrypt(record.otpCiphertext, "PII", {
        actorId: userId,
        authorized: true,
      });
    } catch (err) {
      logger.warn("start_otp_decrypt_failed", {
        category: "APPLICATION",
        bookingId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return { ok: true, state: "waiting", pin: null, expiresAt: null, verifiedAt: null };
    }

    return {
      ok: true,
      state: "active",
      pin,
      expiresAt: record.expiresAt.toISOString(),
      verifiedAt: null,
    };
  }

  /**
   * The gate `POST /bookings/:id/start` calls. Passes when verification already
   * happened, when enforcement is disabled, or when the supplied PIN is valid.
   */
  async ensureCanStart(
    providerId: string,
    bookingId: string,
    otp?: string,
  ): Promise<StartOtpVerifyResult> {
    if (!this.isRequired) return { ok: true, alreadyVerified: true };

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, providerId },
      select: { startOtpVerifiedAt: true },
    });
    if (!booking) return { ok: false, error: "NOT_FOUND" };
    if (booking.startOtpVerifiedAt) return { ok: true, alreadyVerified: true };
    if (!otp) return { ok: false, error: "OTP_REQUIRED" };
    return this.verify(providerId, bookingId, otp);
  }
}

export const bookingStartOtpService = new BookingStartOtpService();

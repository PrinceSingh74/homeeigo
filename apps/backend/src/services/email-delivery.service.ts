/**
 * Enterprise email delivery hub — audit log, retry, metrics, suppression.
 * All transactional email should go through this service.
 */
import prisma from "../lib/prisma";
import { emailService } from "./email.service";
import { incCounter } from "../lib/metrics";
import { redisClient } from "../lib/redis";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const SUPPRESS_PREFIX = "email:suppress:";
const SUPPRESS_TTL_SEC = 60 * 60 * 24 * 90; // 90 days

export type EmailType =
  | "password_reset"
  | "email_verification"
  | "welcome"
  | "otp"
  | "booking_confirmation"
  | "booking_assigned"
  | "booking_completed"
  | "payment_receipt"
  | "invoice"
  | "membership_purchase"
  | "referral_reward"
  | "gift_card"
  | "partner_approval"
  | "partner_rejection"
  | "partner_registration_admin"
  | "admin_alert"
  | "fraud_alert"
  | "system_alert";

type DispatchArgs = {
  to: string;
  emailType: EmailType;
  subject: string;
  html: string;
  text?: string;
  metadata?: Record<string, unknown>;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

class EmailDeliveryService {
  async isSuppressed(email: string): Promise<boolean> {
    const key = `${SUPPRESS_PREFIX}${email.toLowerCase()}`;
    try {
      const v = await redisClient.get(key);
      return v === "1";
    } catch {
      return false;
    }
  }

  async suppress(email: string, reason: string): Promise<void> {
    const key = `${SUPPRESS_PREFIX}${email.toLowerCase()}`;
    try {
      await redisClient.set(key, "1", SUPPRESS_TTL_SEC);
    } catch {
      /* redis optional */
    }
    await prisma.emailLog.create({
      data: {
        to: email,
        emailType: "bounce_suppression",
        subject: `Suppressed: ${reason}`,
        status: "bounced",
        content: JSON.stringify({ reason }),
      },
    });
    incCounter("email_bounced_total", { type: "bounce" });
  }

  /** Fire-and-forget with audit trail + retry. Never blocks caller. */
  enqueue(args: DispatchArgs): void {
    void this.dispatchWithRetry(args).catch((err) => {
      console.error(`[EMAIL] enqueue failed type=${args.emailType} to=${args.to}`, err);
    });
  }

  async dispatchWithRetry(args: DispatchArgs): Promise<{ delivered: boolean; logId: string }> {
    if (await this.isSuppressed(args.to)) {
      const log = await prisma.emailLog.create({
        data: {
          to: args.to,
          emailType: args.emailType,
          subject: args.subject,
          content: args.metadata ? JSON.stringify(args.metadata) : undefined,
          status: "suppressed",
        },
      });
      incCounter("email_failed_total", { type: args.emailType, reason: "suppressed" });
      return { delivered: false, logId: log.id };
    }

    const log = await prisma.emailLog.create({
      data: {
        to: args.to,
        emailType: args.emailType,
        subject: args.subject,
        content: args.metadata ? JSON.stringify(args.metadata) : undefined,
        status: "queued",
      },
    });

    let lastError: string | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
      }
      const result = await emailService.send({
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        attachments: args.attachments,
      });
      if (result.delivered) {
        await prisma.emailLog.update({
          where: { id: log.id },
          data: { status: "sent", content: JSON.stringify({ providerId: result.id, provider: result.provider }) },
        });
        incCounter("email_sent_total", { type: args.emailType });
        return { delivered: true, logId: log.id };
      }
      lastError = result.error;
      if (result.error === "EMAIL_CIRCUIT_OPEN") break;
    }

    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "failed", content: JSON.stringify({ error: lastError }) },
    });
    incCounter("email_failed_total", { type: args.emailType, reason: lastError ?? "unknown" });
    return { delivered: false, logId: log.id };
  }

  // ── Typed senders ──

  sendPasswordReset(to: string, token: string, firstName?: string | null) {
    void emailService.sendPasswordReset(to, token, firstName).then(async (r) => {
      await this.recordTypedResult("password_reset", to, "Reset your HOMEEIGO password", r);
    });
  }

  sendVerification(to: string, token: string, firstName?: string | null) {
    void emailService.sendVerificationEmail(to, token, firstName).then(async (r) => {
      await this.recordTypedResult("email_verification", to, "Verify your HOMEEIGO account", r);
    });
  }

  sendWelcome(to: string, firstName?: string | null) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    this.enqueue({
      to,
      emailType: "welcome",
      subject: "Welcome to HOMEEIGO",
      html: `<p>${greeting}</p><p>Your account is ready. Book premium home services in minutes.</p><p><a href="${process.env.FRONTEND_URL ?? "http://localhost:3001"}">Open HOMEEIGO</a></p>`,
    });
  }

  sendBookingConfirmation(
    to: string,
    booking: { id: string; serviceTitle: string; dateLabel: string; total: number },
    firstName?: string | null,
  ) {
    void emailService.sendBookingConfirmation(to, booking, firstName).then(async (r) => {
      await this.recordTypedResult("booking_confirmation", to, "Your HOMEEIGO booking is confirmed", r, { bookingId: booking.id });
    });
  }

  sendBookingAssigned(
    to: string,
    booking: { id: string; serviceTitle: string; proName: string },
    firstName?: string | null,
  ) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    this.enqueue({
      to,
      emailType: "booking_assigned",
      subject: "Your pro is on the way — HOMEEIGO",
      html: `<p>${greeting}</p><p><strong>${booking.proName}</strong> has accepted your <strong>${booking.serviceTitle}</strong> booking.</p><p>Track live in the HOMEEIGO app.</p>`,
      metadata: { bookingId: booking.id },
    });
  }

  sendBookingCompleted(
    to: string,
    booking: { id: string; serviceTitle: string },
    firstName?: string | null,
  ) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    this.enqueue({
      to,
      emailType: "booking_completed",
      subject: "Service completed — rate your experience",
      html: `<p>${greeting}</p><p>Your <strong>${booking.serviceTitle}</strong> service is complete. Please rate your experience in the app.</p>`,
      metadata: { bookingId: booking.id },
    });
  }

  sendPaymentReceipt(to: string, amount: number, bookingNumber: string, firstName?: string | null) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
    this.enqueue({
      to,
      emailType: "payment_receipt",
      subject: `Payment received — ₹${amount} · HOMEEIGO`,
      html: `<p>${greeting}</p><p>We've received your payment of <b>₹${amount}</b> for booking <b>${bookingNumber}</b>. Your invoice PDF is attached.</p>`,
      metadata: { amount, bookingNumber },
    });
  }

  /** Invoice email with PDF attachment. */
  sendInvoiceWithPdf(
    to: string,
    invoiceNo: string,
    amount: number,
    pdf: Buffer,
    firstName?: string | null,
  ) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
    this.enqueue({
      to,
      emailType: "invoice",
      subject: `Invoice ${invoiceNo} — HOMEEIGO`,
      html: `<p>${greeting}</p><p>Your invoice <b>${invoiceNo}</b> for <b>₹${amount}</b> is attached as PDF.</p>`,
      metadata: { invoiceNo, amount },
      attachments: [{ filename: `${invoiceNo}.pdf`, content: pdf }],
    });
  }

  sendRecoveryAlert(to: string, event: string, detail: string) {
    this.enqueue({
      to,
      emailType: "system_alert",
      subject: `[HOMEEIGO Recovery] ${event}`,
      html: `<p><strong>Recovery event:</strong> ${event}</p><p>${detail}</p>`,
      metadata: { event },
    });
  }

  sendPartnerApproval(to: string, firstName: string | null, notes?: string) {
    this.enqueue({
      to,
      emailType: "partner_approval",
      subject: "Welcome! Your HOMEEIGO Partner Application is Approved",
      html: `<p>Hi ${firstName ?? "Partner"},</p><p>Your partner application has been approved. You can now log in to your partner dashboard.</p>${notes ? `<p>${notes}</p>` : ""}`,
      metadata: { notes },
    });
  }

  sendPartnerRejection(to: string, firstName: string | null, reason?: string) {
    this.enqueue({
      to,
      emailType: "partner_rejection",
      subject: "HOMEEIGO Partner Application Status",
      html: `<p>Hi ${firstName ?? "Partner"},</p><p>Unfortunately we cannot approve your application at this time.</p>${reason ? `<p>Reason: ${reason}</p>` : ""}`,
      metadata: { reason },
    });
  }

  sendAdminAlert(to: string, subject: string, body: string) {
    this.enqueue({
      to,
      emailType: "admin_alert",
      subject: `[HOMEEIGO Admin] ${subject}`,
      html: `<p>${body}</p>`,
    });
  }

  sendFraudAlert(to: string, alertType: string, detail: string) {
    this.enqueue({
      to,
      emailType: "fraud_alert",
      subject: `[HOMEEIGO Risk] ${alertType}`,
      html: `<p><strong>Fraud alert:</strong> ${alertType}</p><p>${detail}</p>`,
      metadata: { alertType },
    });
  }

  sendMembershipPurchase(to: string, planName: string, amount: number, expiresAt: Date, firstName?: string | null) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    this.enqueue({
      to,
      emailType: "membership_purchase",
      subject: `Welcome to ${planName} — HOMEEIGO Membership`,
      html: `<p>${greeting}</p><p>Your <strong>${planName}</strong> membership is active.</p><p>Amount paid: <b>₹${amount}</b></p><p>Valid until: <b>${expiresAt.toLocaleDateString("en-IN")}</b></p>`,
      metadata: { planName, amount, expiresAt: expiresAt.toISOString() },
    });
  }

  sendReferralReward(to: string, amount: number, firstName?: string | null) {
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    this.enqueue({
      to,
      emailType: "referral_reward",
      subject: `You earned ₹${amount} — HOMEEIGO Referral Reward`,
      html: `<p>${greeting}</p><p>Your referral completed their first booking. <strong>₹${amount}</strong> has been credited to your referral balance.</p>`,
      metadata: { amount },
    });
  }

  async getHealthSummary() {
    const [total, sent, failed, queued, bounced, last24h] = await Promise.all([
      prisma.emailLog.count(),
      prisma.emailLog.count({ where: { status: "sent" } }),
      prisma.emailLog.count({ where: { status: "failed" } }),
      prisma.emailLog.count({ where: { status: "queued" } }),
      prisma.emailLog.count({ where: { status: "bounced" } }),
      prisma.emailLog.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);
    const byType = await prisma.emailLog.groupBy({ by: ["emailType", "status"], _count: true });
    return {
      configured: emailService.isConfigured,
      provider: emailService.isConfigured ? "resend" : process.env.NODE_ENV === "production" ? "none" : "console",
      totals: { total, sent, failed, queued, bounced, last24h },
      byType: byType.map((r) => ({ type: r.emailType, status: r.status, count: r._count })),
      retryPolicy: `${MAX_RETRIES} attempts, exponential backoff`,
      queue: "async in-process (non-blocking)",
    };
  }

  private async recordTypedResult(
    emailType: EmailType,
    to: string,
    subject: string,
    result: { delivered: boolean; id?: string; error?: string; provider: string },
    metadata?: Record<string, unknown>,
  ) {
    await prisma.emailLog.create({
      data: {
        to,
        emailType,
        subject,
        status: result.delivered ? "sent" : "failed",
        content: JSON.stringify({ providerId: result.id, error: result.error, ...metadata }),
      },
    });
    if (result.delivered) incCounter("email_sent_total", { type: emailType });
    else incCounter("email_failed_total", { type: emailType, reason: result.error ?? "unknown" });
  }
}

export const emailDeliveryService = new EmailDeliveryService();

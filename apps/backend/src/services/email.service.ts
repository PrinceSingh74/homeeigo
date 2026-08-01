import { Resend } from "resend";
import { emailBreaker, CircuitOpenError } from "../lib/circuit-breaker";

const API_KEY = process.env.RESEND_API_KEY || "";
const FROM_ADDRESS = process.env.EMAIL_FROM || "HOMEEIGO <noreply@homigo.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "";
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3001").replace(/\/$/, "");
const MOBILE_DEEP_LINK_BASE = (process.env.MOBILE_DEEP_LINK_BASE || "homigo:/").replace(/\/$/, "");
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@homigo.com";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
};

type SendResult = {
  delivered: boolean;
  provider: "resend" | "console";
  id?: string;
  error?: string;
};

class EmailService {
  private readonly resend: Resend | null;

  constructor() {
    this.resend = API_KEY ? new Resend(API_KEY) : null;
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  async send(args: SendArgs): Promise<SendResult> {
    if (!this.resend) {
      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[EMAIL:console] to=${args.to} subject=${args.subject}\n${args.text ?? this.stripHtml(args.html)}`,
        );
        return { delivered: true, provider: "console" };
      }
      return { delivered: false, provider: "console", error: "EMAIL_NOT_CONFIGURED" };
    }

    try {
      const resend = this.resend;
      // Circuit breaker: isolate a failing email provider so repeated send failures
      // fast-fail instead of blocking request paths that fire off emails.
      const res = await emailBreaker.execute(async () => {
        const r = await resend.emails.send({
          from: FROM_ADDRESS,
          to: args.to,
          subject: args.subject,
          html: args.html,
          text: args.text ?? this.stripHtml(args.html),
          replyTo: REPLY_TO || undefined,
          attachments: args.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
          })),
        });
        if (r.error) throw new Error(r.error.message);
        return r;
      });
      return { delivered: true, provider: "resend", id: res.data?.id };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return { delivered: false, provider: "resend", error: "EMAIL_CIRCUIT_OPEN" };
      }
      return {
        delivered: false,
        provider: "resend",
        error: error instanceof Error ? error.message : "EMAIL_SEND_FAILED",
      };
    }
  }

  async sendPasswordReset(to: string, rawToken: string, firstName?: string | null): Promise<SendResult> {
    const webLink = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const mobileLink = `${MOBILE_DEEP_LINK_BASE}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const greeting = firstName ? `Hi ${this.escapeHtml(firstName)},` : "Hi,";
    const html = baseTemplate({
      title: "Reset your HOMEEIGO password",
      preview: "Secure reset link inside · expires in 30 minutes",
      body: `
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">${greeting}</p>
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">We received a request to reset your password. Click the button below to set a new password. This link will expire in 30 minutes.</p>
        <p style="margin:24px 0;text-align:center">
          <a href="${webLink}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#2563EB 100%);color:#ffffff;padding:14px 28px;border-radius:12px;font-weight:600;text-decoration:none;font-size:15px">Reset password (web)</a>
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280">On the HOMEEIGO mobile app, open this link:</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#7C3AED;word-break:break-all"><a href="${mobileLink}" style="color:#7C3AED;text-decoration:none">${mobileLink}</a></p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280">Or paste this URL into your browser:</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#7C3AED;word-break:break-all">${webLink}</p>
        <p style="margin:0;font-size:13px;color:#6b7280">If you didn't request this, you can safely ignore this email. Need help? Contact <a href="mailto:${SUPPORT_EMAIL}" style="color:#2563EB;text-decoration:none">${SUPPORT_EMAIL}</a>.</p>
      `,
    });
    return this.send({ to, subject: "Reset your HOMEEIGO password", html });
  }

  async sendVerificationEmail(to: string, rawToken: string, firstName?: string | null): Promise<SendResult> {
    const webLink = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const mobileLink = `${MOBILE_DEEP_LINK_BASE}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const greeting = firstName ? `Hi ${this.escapeHtml(firstName)},` : "Hi,";
    const html = baseTemplate({
      title: "Verify your HOMEEIGO email",
      preview: "Confirm your email · link expires in 24 hours",
      body: `
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">${greeting}</p>
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">Welcome to HOMEEIGO! Please confirm your email address to unlock all features. This link will expire in 24 hours.</p>
        <p style="margin:24px 0;text-align:center">
          <a href="${webLink}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#2563EB 100%);color:#ffffff;padding:14px 28px;border-radius:12px;font-weight:600;text-decoration:none;font-size:15px">Verify email</a>
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280">On the HOMEEIGO mobile app, open this link:</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#7C3AED;word-break:break-all"><a href="${mobileLink}" style="color:#7C3AED;text-decoration:none">${mobileLink}</a></p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280">Or paste this URL into your browser:</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#7C3AED;word-break:break-all">${webLink}</p>
        <p style="margin:0;font-size:13px;color:#6b7280">If you didn't sign up for HOMEEIGO, you can safely ignore this email.</p>
      `,
    });
    return this.send({ to, subject: "Verify your HOMEEIGO account", html });
  }

  async sendOtpEmail(to: string, otp: string, firstName?: string | null): Promise<SendResult> {
    const greeting = firstName ? `Hi ${this.escapeHtml(firstName)},` : "Hi,";
    const html = baseTemplate({
      title: "Your HOMEEIGO verification code",
      preview: `OTP ${otp} · expires in 5 minutes`,
      body: `
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">${greeting}</p>
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">Use the code below to verify your account. It expires in 5 minutes.</p>
        <p style="margin:24px 0;text-align:center;font-family:monospace;font-size:32px;letter-spacing:8px;color:#1f2937;font-weight:700">${this.escapeHtml(otp)}</p>
        <p style="margin:0;font-size:13px;color:#6b7280">If you didn't request this, you can ignore this email.</p>
      `,
    });
    return this.send({ to, subject: "Your HOMEEIGO verification code", html });
  }

  async sendBookingConfirmation(
    to: string,
    booking: { id: string; serviceTitle: string; dateLabel: string; total: number },
    firstName?: string | null,
  ): Promise<SendResult> {
    const greeting = firstName ? `Hi ${this.escapeHtml(firstName)},` : "Hi,";
    const html = baseTemplate({
      title: "Booking confirmed",
      preview: `${booking.serviceTitle} confirmed for ${booking.dateLabel}`,
      body: `
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">${greeting}</p>
        <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937">Your booking is confirmed.</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:12px">
          <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280">Service</td><td style="padding:12px 16px;font-size:14px;color:#1f2937;font-weight:600;text-align:right">${this.escapeHtml(booking.serviceTitle)}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280">Schedule</td><td style="padding:12px 16px;font-size:14px;color:#1f2937;font-weight:600;text-align:right">${this.escapeHtml(booking.dateLabel)}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280">Total</td><td style="padding:12px 16px;font-size:14px;color:#1f2937;font-weight:600;text-align:right">₹${booking.total}</td></tr>
          <tr><td style="padding:12px 16px;font-size:13px;color:#6b7280">Booking ID</td><td style="padding:12px 16px;font-size:13px;color:#7C3AED;font-family:monospace;text-align:right">${this.escapeHtml(booking.id)}</td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:#6b7280">Track live updates in your HOMEEIGO app.</p>
      `,
    });
    return this.send({ to, subject: "Your HOMEEIGO booking is confirmed", html });
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

function baseTemplate({
  title,
  preview,
  body,
}: {
  title: string;
  preview: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${preview}</span>
    <table role="presentation" style="width:100%;background:#f5f3ff;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.06)">
          <tr>
            <td style="background:linear-gradient(135deg,#7C3AED 0%,#2563EB 100%);padding:24px 28px">
              <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.5px">HOMEEIGO</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px">
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#0f172a;font-weight:700">${title}</h1>
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;font-size:12px;color:#94a3b8">
              HOMEEIGO · Premium home services · This is an automated message.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export const emailService = new EmailService();

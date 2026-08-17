import { emailService } from "../../services/email.service";
import type { NotificationChannelAdapter } from "../types";

/**
 * Email, over the existing email service.
 *
 * `emailDeliveryService` owns retry, suppression, the EmailLog audit and bounce handling; that hub
 * is left exactly as it is. This adapter renders an approved template and hands the result to the
 * same provider path, so nothing about deliverability is reimplemented here.
 */

/**
 * Templates carry text, never markup.
 *
 * `emailService.send` requires an HTML body, so the rendered text is escaped into a minimal
 * document rather than passed through. Escaping here is what makes "no arbitrary HTML" true in
 * practice: a template — or a variable inside one — cannot introduce a script tag, an iframe or a
 * `javascript:` link, because every angle bracket and quote is neutralised before it reaches the
 * provider.
 */
function toSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5">${escaped.replace(/\n/g, "<br/>")}</div>`;
}

export const emailAdapter: NotificationChannelAdapter = {
  channel: "EMAIL",

  canSend: (recipient) => recipient.targets.some((t) => t.channel === "EMAIL"),

  async send(recipient, message) {
    const target = recipient.targets.find((t) => t.channel === "EMAIL");
    if (!target || target.channel !== "EMAIL") {
      return { status: "UNAVAILABLE", reasonCode: "no_email_target" };
    }

    try {
      const result = await emailService.send({
        to: target.email,
        subject: message.title ?? "HOMEEIGO",
        html: toSafeHtml(message.body),
        text: message.body,
      });

      // The provider confirms it accepted the send, not that the recipient received it.
      return result.delivered
        ? { status: "SENT", providerRef: result.id }
        : { status: "FAILED", reasonCode: (result.error ?? "email_rejected").slice(0, 120) };
    } catch (err) {
      return {
        status: "FAILED",
        reasonCode: err instanceof Error ? err.message.slice(0, 120) : "email_failed",
      };
    }
  },
};

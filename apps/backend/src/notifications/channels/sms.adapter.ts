import twilio from "twilio";
import { logger } from "../../lib/logger";
import type { NotificationChannelAdapter } from "../types";

/**
 * General-purpose SMS — deliberately separate from the OTP path.
 *
 * HOMEEIGO's only existing SMS sender lives inside `booking-start-otp.service`, which exists to
 * deliver one-time codes. Automation messaging is a different thing with different risk: an OTP
 * is a security credential, and its send path should not be reachable from a workflow. Sharing the
 * client would put one behind the other, so this builds its own — same provider, separate route,
 * separate accounting, and no way for an automation step to reach the OTP sender.
 *
 * Two independent switches gate it. `SMS_ENABLED=false` matches the existing convention, and
 * `AUTOMATION_SMS_ENABLED` governs automation traffic on its own — SMS costs real money per
 * message, so it stays off unless deliberately turned on.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM = process.env.TWILIO_PHONE_NUMBER ?? "";

let client: twilio.Twilio | null | undefined;

function getClient(): twilio.Twilio | null {
  if (client !== undefined) return client;
  client = ACCOUNT_SID && AUTH_TOKEN ? twilio(ACCOUNT_SID, AUTH_TOKEN) : null;
  return client;
}

export function automationSmsEnabled(): boolean {
  if (process.env.SMS_ENABLED === "false") return false;
  return process.env.AUTOMATION_SMS_ENABLED === "true";
}

export const smsAdapter: NotificationChannelAdapter = {
  channel: "SMS",

  canSend: (recipient) => recipient.targets.some((t) => t.channel === "SMS"),

  async send(recipient, message, ctx) {
    const target = recipient.targets.find((t) => t.channel === "SMS");
    if (!target || target.channel !== "SMS") {
      return { status: "UNAVAILABLE", reasonCode: "no_phone_target" };
    }

    if (!automationSmsEnabled()) {
      return { status: "UNAVAILABLE", reasonCode: "automation_sms_disabled" };
    }

    const sms = getClient();
    if (!sms || !FROM) {
      return { status: "UNAVAILABLE", reasonCode: "sms_not_configured" };
    }

    try {
      const result = await sms.messages.create({ to: target.phone, from: FROM, body: message.body });
      // Twilio acknowledges the request and reports delivery asynchronously, so the strongest
      // truthful state here is QUEUED.
      return { status: "QUEUED", providerRef: result.sid };
    } catch (err) {
      // The phone number is never logged — the notification id and recipient id are enough to
      // trace this, and an SMS failure should not put a contact detail into the log stream.
      logger.warn("automation_sms_failed", {
        notificationType: ctx.notificationType,
        traceId: ctx.traceId,
        error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
      });
      return {
        status: "FAILED",
        reasonCode: err instanceof Error ? err.message.slice(0, 120) : "sms_failed",
      };
    }
  },
};

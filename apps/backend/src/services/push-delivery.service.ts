import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import prisma from "../lib/prisma";
import { devicePushService } from "./device-push.service";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { liveProviderAllowed } from "../lib/test-egress";

const expo = new Expo();

/**
 * X-45 — bounded retry for push delivery. A thrown chunk (network, 429, 5xx) and a
 * `MessageRateExceeded` ticket are TRANSIENT: retried with exponential backoff and jitter, at most
 * `maxAttempts` sends per chunk — never an endless loop. Every other ticket error is PERMANENT and not
 * retried. Exported so tests can shrink the delays; production uses the defaults.
 */
export const pushRetryPolicy = { maxAttempts: 3, baseDelayMs: 400, maxDelayMs: 5_000 };

const RETRYABLE_TICKET_ERRORS = new Set(["MessageRateExceeded"]);

function backoffMs(attempt: number): number {
  const ceiling = Math.min(pushRetryPolicy.maxDelayMs, pushRetryPolicy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ticketError = (t: ExpoPushTicket): string | null => (t.status === "error" ? (t.details?.error ?? "UnknownError") : null);
const tokenOf = (m: ExpoPushMessage | undefined): string => (typeof m?.to === "string" ? m.to : Array.isArray(m?.to) ? (m?.to[0] ?? "") : "");

export class PushDeliveryService {
  async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      data?: Record<string, unknown>;
      notificationId?: string;
      /**
       * Set only by callers that have already applied notification preference themselves.
       *
       * The notification router decides channel eligibility through `evaluatePreference`, which
       * knows SECURITY and TRANSACTIONAL cannot be refused. Re-applying the legacy `User`
       * boolean underneath it would overrule that decision one layer too late.
       */
      preferenceAlreadyApplied?: boolean;
    },
  ): Promise<{ sent: number; invalid: string[]; exhausted?: number; permanent?: number; duplicate?: boolean }> {
    // X-45: a repeated event for a notification already handed to the provider is not sent twice.
    if (payload.notificationId) {
      const row = await prisma.notification.findUnique({ where: { id: payload.notificationId }, select: { isPushed: true } });
      if (row?.isPushed) {
        incCounter("push_duplicate_suppressed_total");
        return { sent: 0, invalid: [], duplicate: true };
      }
    }

    const tokens = [...new Set(await devicePushService.getActiveTokens(userId, {
      includeOptedOut: payload.preferenceAlreadyApplied === true,
    }))];
    if (!tokens.length) return { sent: 0, invalid: [] as string[] };

    const messages: ExpoPushMessage[] = [];
    for (const token of tokens) {
      if (!Expo.isExpoPushToken(token)) continue;
      messages.push({
        to: token,
        sound: "default",
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    }

    if (!messages.length) return { sent: 0, invalid: [] as string[] };
    // A test runtime never reaches Expo's push service (lib/test-egress.ts): the rows/telemetry are
    // written by the caller, only the outward delivery is skipped.
    if (!liveProviderAllowed("HOMIGO_REQUIRE_PUSH")) return { sent: 0, invalid: [] as string[] };

    const chunks = expo.chunkPushNotifications(messages);
    let sent = 0;
    let exhausted = 0;
    const permanentErrors: string[] = [];
    const invalid: string[] = [];
    let credentialFault = false;

    for (const chunk of chunks) {
      let pending = chunk;
      for (let attempt = 1; pending.length > 0; attempt++) {
        let retry: ExpoPushMessage[] = [];
        try {
          const tickets = await expo.sendPushNotificationsAsync(pending);
          incCounter("push_send_attempt_total", { outcome: "accepted" });
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i]!;
            const error = ticketError(ticket);
            if (!error) { sent += 1; continue; }
            incCounter("push_ticket_error_total", { error });
            if (error === "DeviceNotRegistered") {
              const token = tokenOf(pending[i]);
              if (token) invalid.push(token);
            } else if (error === "InvalidCredentials") {
              // The Expo project's FCM/APNs credentials are missing or wrong — true for every device at
              // once. Unlinking devices for it would silently cut every user off; alert instead.
              credentialFault = true;
              permanentErrors.push(error);
            } else if (RETRYABLE_TICKET_ERRORS.has(error) && pending[i]) {
              retry.push(pending[i]!);
            } else {
              permanentErrors.push(error);
            }
          }
        } catch (error) {
          incCounter("push_send_attempt_total", { outcome: "threw" });
          logger.error("Expo push chunk failed", { userId, attempt, error: String(error) });
          retry = pending; // the whole chunk is unconfirmed: transient by definition
        }
        if (!retry.length) break;
        if (attempt >= pushRetryPolicy.maxAttempts) {
          exhausted += retry.length;
          incCounter("push_send_exhausted_total", undefined, retry.length);
          break;
        }
        incCounter("push_send_retry_total");
        await sleep(backoffMs(attempt));
        pending = retry;
      }
    }

    if (invalid.length) {
      await devicePushService.markTokensInvalid(invalid);
    }
    if (credentialFault) {
      logger.error("push_credentials_invalid", { userId, hint: "configure FCM/APNs credentials for the Expo project" });
    }

    if (payload.notificationId && sent > 0) {
      await prisma.notification.updateMany({
        where: { id: payload.notificationId, userId },
        data: { isPushed: true, pushedAt: new Date() },
      });
    } else if (payload.notificationId && (exhausted > 0 || permanentErrors.length > 0)) {
      // X-45: the routed delivery (QUEUED — accepted by the router, fire-and-forget to the device) is
      // settled as FAILED with why, instead of staying QUEUED forever. Nothing is claimed as delivered.
      const reasonCode = exhausted > 0 ? "push_retries_exhausted" : `push_${permanentErrors[0]}`;
      await prisma.notificationDelivery.updateMany({
        where: { providerRef: payload.notificationId, channel: "PUSH", status: "QUEUED" },
        data: { status: "FAILED", reasonCode },
      });
      logger.warn("push_delivery_failed", { userId, notificationId: payload.notificationId, reasonCode, exhausted, permanent: permanentErrors.length });
    }

    return { sent, invalid, exhausted, permanent: permanentErrors.length };
  }
}

export const pushDeliveryService = new PushDeliveryService();

import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import prisma from "../lib/prisma";
import { devicePushService } from "./device-push.service";
import { logger } from "../lib/logger";

const expo = new Expo();

export class PushDeliveryService {
  async sendToUser(
    userId: string,
    payload: {
      title: string;
      body: string;
      data?: Record<string, unknown>;
      notificationId?: string;
    },
  ) {
    const tokens = await devicePushService.getActiveTokens(userId);
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

    const chunks = expo.chunkPushNotifications(messages);
    let sent = 0;
    const invalid: string[] = [];

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const tokenRaw = chunk[i]?.to;
          const token = typeof tokenRaw === "string" ? tokenRaw : Array.isArray(tokenRaw) ? tokenRaw[0] : "";
          if (ticket.status === "ok") {
            sent += 1;
          } else if (
            ticket.status === "error" &&
            (ticket.details?.error === "DeviceNotRegistered" ||
              ticket.details?.error === "InvalidCredentials")
          ) {
            if (token) invalid.push(token);
          }
        }
      } catch (error) {
        logger.error("Expo push chunk failed", { userId, error: String(error) });
      }
    }

    if (invalid.length) {
      await devicePushService.markTokensInvalid(invalid);
    }

    if (payload.notificationId && sent > 0) {
      await prisma.notification.updateMany({
        where: { id: payload.notificationId, userId },
        data: { isPushed: true, pushedAt: new Date() },
      });
    }

    return { sent, invalid };
  }
}

export const pushDeliveryService = new PushDeliveryService();

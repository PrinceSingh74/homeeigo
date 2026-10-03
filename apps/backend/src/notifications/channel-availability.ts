import type { NotificationChannel } from "@prisma/client";
import prisma from "../lib/prisma";
import { emailService } from "../services/email.service";
import { devicePushService } from "../services/device-push.service";
import { automationSmsEnabled } from "./channels/sms.adapter";

/**
 * What a given recipient can actually be reached on, right now.
 *
 * A settings screen that offers a channel the platform cannot use is a promise it will break: the
 * toggle saves, nothing changes, and the recipient concludes the product is broken. So availability
 * is answered from the same facts the adapters use — a registered device, a configured provider, a
 * contact detail on file — and never from a hardcoded list.
 *
 * WhatsApp is absent on purpose. HOMEEIGO has no WhatsApp adapter, no provider credentials and no
 * `NotificationChannel` value for it, so there is nothing to expose. It is a product decision that
 * has not been taken, not a control that is temporarily off.
 */

export type ChannelAvailability = {
  channel: NotificationChannel;
  available: boolean;
  /** Why not, when unavailable — shown to the recipient so a dead toggle is never a mystery. */
  reason?: "no_registered_device" | "no_email_on_file" | "no_phone_on_file" | "provider_not_configured";
};

export async function resolveChannelAvailability(userId: string): Promise<ChannelAvailability[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailEncrypted: true, phoneNumber: true, phoneEncrypted: true },
  });

  const hasEmail = Boolean(user?.email || user?.emailEncrypted);
  const hasPhone = Boolean(user?.phoneNumber || user?.phoneEncrypted);

  /**
   * Asked with `includeOptedOut` because this is about capability, not permission: a recipient who
   * has turned push off still has a device, and the toggle that turns it back on must remain
   * reachable. Hiding it would make the choice irreversible.
   */
  const tokens = await devicePushService
    .getActiveTokens(userId, { includeOptedOut: true })
    .catch(() => [] as string[]);

  return [
    { channel: "IN_APP", available: true },
    tokens.length > 0
      ? { channel: "PUSH", available: true }
      : { channel: "PUSH", available: false, reason: "no_registered_device" },
    !emailService.isConfigured
      ? { channel: "EMAIL", available: false, reason: "provider_not_configured" }
      : hasEmail
        ? { channel: "EMAIL", available: true }
        : { channel: "EMAIL", available: false, reason: "no_email_on_file" },
    !automationSmsEnabled()
      ? { channel: "SMS", available: false, reason: "provider_not_configured" }
      : hasPhone
        ? { channel: "SMS", available: true }
        : { channel: "SMS", available: false, reason: "no_phone_on_file" },
  ];
}

import prisma from "../lib/prisma";
import { userPiiService } from "../services/user-pii.service";
import { devicePushService } from "../services/device-push.service";
import { preferredLanguage } from "./preferences.service";
import type { ChannelTarget, RecipientType, ResolvedRecipient } from "./types";

/**
 * Turns a recipient id into the channels that recipient can actually be reached on.
 *
 * This is the only place a contact detail enters the platform, and it is deliberately the only
 * way in: callers name a person by id and never supply a phone number or an email address. A
 * workflow therefore cannot be made to message an arbitrary destination, and a bug in calling
 * code cannot send someone else's booking update to an attacker-chosen address.
 *
 * Contact fields are read through `userPiiService`, not off the row. Most users here have their
 * email and phone encrypted at rest — 279 of 296 at the time of writing — so reading the plain
 * columns directly would silently find nothing for the overwhelming majority and quietly degrade
 * every email and SMS into "no target".
 */

export type ResolveOutcome =
  | { ok: true; recipient: ResolvedRecipient }
  | { ok: false; reason: "RECIPIENT_NOT_FOUND" };

/** PARTNER means a provider id; the messages still reach the person behind it. */
async function resolveUserId(type: RecipientType, recipientId: string): Promise<string | null> {
  if (type === "PARTNER") {
    const provider = await prisma.provider.findUnique({
      where: { id: recipientId },
      select: { userId: true },
    });
    return provider?.userId ?? null;
  }
  return recipientId;
}

export async function resolveRecipient(
  type: RecipientType,
  recipientId: string,
): Promise<ResolveOutcome> {
  const userId = await resolveUserId(type, recipientId);
  if (!userId) return { ok: false, reason: "RECIPIENT_NOT_FOUND" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phoneNumber: true,
      emailEncrypted: true,
      phoneEncrypted: true,
      isActive: true,
    },
  });
  if (!user) return { ok: false, reason: "RECIPIENT_NOT_FOUND" };

  const { email, phoneNumber } = await userPiiService.resolveEmailAndPhone(user, {
    actorId: "system:notifications",
    authorized: true,
  });

  const targets: ChannelTarget[] = [];

  // Push is available only if the person actually has a live device registered. Claiming the
  // channel without a token would turn every send into a silent failure.
  const tokens = await devicePushService.getActiveTokens(userId).catch(() => [] as string[]);
  if (tokens.length > 0) targets.push({ channel: "PUSH", userId });

  if (email && email.includes("@")) targets.push({ channel: "EMAIL", email });
  if (phoneNumber && phoneNumber.replace(/\D/g, "").length >= 10) {
    targets.push({ channel: "SMS", phone: phoneNumber });
  }

  const language = (await preferredLanguage(userId)) ?? "en";

  return { ok: true, recipient: { userId, language, targets } };
}

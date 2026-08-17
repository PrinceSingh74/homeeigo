import prisma from "../lib/prisma";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";

/**
 * Whether a recipient may be contacted on a channel for a category.
 *
 * Precedence, in order:
 *   1. an explicit preference the recipient set
 *   2. the category default
 *   3. the system default
 *
 * With one rule that overrides all three: TRANSACTIONAL and SECURITY notifications cannot be
 * switched off. A booking that was cancelled, a payment that failed, a login code — these are not
 * marketing. Letting a preference silence them would leave someone unable to use the product and
 * unable to understand why, and they would reasonably assume the app was broken rather than that
 * they had opted out. Only OPTIONAL traffic is the recipient's to refuse.
 *
 * Absence of a preference always means "use the default", never "off".
 */

/** Channels a category may use at all, before any recipient preference is considered. */
const CATEGORY_DEFAULT_CHANNELS: Record<NotificationCategory, NotificationChannel[]> = {
  SECURITY: ["SMS", "EMAIL"],
  TRANSACTIONAL: ["PUSH", "EMAIL"],
  OPTIONAL: ["PUSH"],
};

export function isMandatory(category: NotificationCategory): boolean {
  return category === "TRANSACTIONAL" || category === "SECURITY";
}

export function categoryDefaultChannels(category: NotificationCategory): NotificationChannel[] {
  return CATEGORY_DEFAULT_CHANNELS[category];
}

export type PreferenceDecision = {
  allowed: boolean;
  reason: "EXPLICIT_PREFERENCE" | "CATEGORY_DEFAULT" | "SYSTEM_DEFAULT" | "MANDATORY_CATEGORY";
  language?: string;
};

export async function evaluatePreference(input: {
  userId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
}): Promise<PreferenceDecision> {
  const explicit = await prisma.notificationPreference.findUnique({
    where: {
      userId_channel_category: {
        userId: input.userId,
        channel: input.channel,
        category: input.category,
      },
    },
    select: { enabled: true, language: true },
  });

  // Mandatory categories ignore an opt-out but still honour a language choice — the recipient
  // controls how the message reads, not whether it arrives.
  if (isMandatory(input.category)) {
    return { allowed: true, reason: "MANDATORY_CATEGORY", language: explicit?.language ?? undefined };
  }

  if (explicit) {
    return {
      allowed: explicit.enabled,
      reason: "EXPLICIT_PREFERENCE",
      language: explicit.language ?? undefined,
    };
  }

  if (CATEGORY_DEFAULT_CHANNELS[input.category].includes(input.channel)) {
    return { allowed: true, reason: "CATEGORY_DEFAULT" };
  }

  return { allowed: false, reason: "SYSTEM_DEFAULT" };
}

/** Reads a recipient's stated language, if they set one on any preference row. */
export async function preferredLanguage(userId: string): Promise<string | null> {
  const row = await prisma.notificationPreference.findFirst({
    where: { userId, language: { not: null } },
    select: { language: true },
  });
  return row?.language ?? null;
}

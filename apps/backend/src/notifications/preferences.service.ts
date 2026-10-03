import prisma from "../lib/prisma";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";
import { typePermitsChannel } from "./governance/channel-policy";

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

/** A recipient's stored preference for one (channel, category), or `null` if they never set one. */
export type ExplicitPreference = { enabled: boolean; language: string | null } | null;

export type PreferenceInput = {
  channel: NotificationChannel;
  category: NotificationCategory;
  /**
   * Lets a single type be offered a channel its category does not enable by default.
   *
   * Read only after an explicit preference has been consulted, so widening what the platform offers
   * can never overrule what the recipient asked for. Absent, behaviour is exactly as before.
   */
  notificationType?: string;
};

/**
 * The precedence rules, with the database taken out.
 *
 * This is deliberately the ONLY place the order is written down. The preferences screen renders a
 * 3x4 matrix and used to call the async evaluator once per cell, which re-read rows the endpoint had
 * already fetched — twelve queries to restate data it was holding. The obvious repair is for the
 * screen to decide the cells itself from those rows, and that is exactly the repair that lets the
 * screen and the router drift: what a recipient is shown would be computed by different code from
 * what the platform actually does.
 *
 * So the decision is pure and shared, and both the per-cell and batched evaluators are thin wrappers
 * over it.
 */
export function decidePreference(
  input: PreferenceInput & { explicit: ExplicitPreference },
): PreferenceDecision {
  const { explicit } = input;

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

  /**
   * One notification type may be offered a channel its category does not enable by default.
   *
   * Reached only when the recipient has expressed no preference, so this can widen what is offered
   * and never narrow what they chose. Payment recovery is the only entry today: OPTIONAL is
   * push-only, and push-only meant an automation aimed at people who abandoned a web checkout could
   * not reach the ones who had never installed the app.
   */
  if (input.notificationType && typePermitsChannel(input.notificationType, input.channel)) {
    return { allowed: true, reason: "CATEGORY_DEFAULT" };
  }

  return { allowed: false, reason: "SYSTEM_DEFAULT" };
}

export async function evaluatePreference(
  input: PreferenceInput & { userId: string },
): Promise<PreferenceDecision> {
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
  return decidePreference({ ...input, explicit });
}

/**
 * Decide many cells for one recipient from a SINGLE read of their preferences.
 *
 * Every cell goes through `decidePreference`, so this cannot disagree with `evaluatePreference`
 * about anything — it only changes how many times the same rows are fetched.
 */
export async function evaluatePreferences(
  userId: string,
  cells: PreferenceInput[],
): Promise<PreferenceDecision[]> {
  if (cells.length === 0) return [];
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { channel: true, category: true, enabled: true, language: true },
  });
  const byCell = new Map(
    rows.map((r) => [`${r.channel}:${r.category}`, { enabled: r.enabled, language: r.language }]),
  );
  return cells.map((cell) =>
    decidePreference({ ...cell, explicit: byCell.get(`${cell.channel}:${cell.category}`) ?? null }),
  );
}

/** Reads a recipient's stated language, if they set one on any preference row. */
export async function preferredLanguage(userId: string): Promise<string | null> {
  const row = await prisma.notificationPreference.findFirst({
    where: { userId, language: { not: null } },
    select: { language: true },
  });
  return row?.language ?? null;
}

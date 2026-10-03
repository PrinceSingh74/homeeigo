import type { NotificationChannel } from "@prisma/client";
import prisma from "../lib/prisma";
import { categoryDefaultChannels } from "./preferences.service";

/**
 * Translates the legacy `User` notification booleans into canonical `NotificationPreference` rows.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Two preference systems had drifted apart. `User.emailNotifications` and `User.smsNotifications`
 * were written by both settings UIs and read by *nothing* — the notification router decides channel
 * eligibility from `NotificationPreference`, which no client had ever written. A partner who turned
 * "Email alerts" off kept receiving email, and the product had no way to know it was lying.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A legacy boolean is a statement about a *channel*, and the only category a recipient may refuse
 * is OPTIONAL. So each flag maps to exactly one (channel, OPTIONAL) row. Mandatory categories are
 * never written from here — not as `true`, not as `false` — because a preference row for them would
 * imply the recipient has a say they do not have.
 *
 * ── Restrict-only ───────────────────────────────────────────────────────────
 *
 * Turning a flag *off* writes an explicit opt-out. Turning it back *on* deletes the row rather than
 * writing `enabled: true`, so the platform default applies again. The asymmetry is deliberate: an
 * explicit `true` would be stronger than the category default and would start sending OPTIONAL
 * email and SMS to everyone who ever opened the settings screen, since both UIs default their
 * toggles to on. A preference the recipient never consciously granted must not increase what they
 * receive.
 */

const LEGACY_CHANNEL_MAP = {
  notificationsEnabled: "IN_APP",
  pushNotifications: "PUSH",
  emailNotifications: "EMAIL",
  smsNotifications: "SMS",
} as const satisfies Record<string, NotificationChannel>;

type LegacyFlag = keyof typeof LEGACY_CHANNEL_MAP;

export type LegacyNotificationFlags = Partial<Record<LegacyFlag, boolean>>;

export type LegacyMirrorResult = {
  /** Channels now explicitly opted out of. */
  optedOut: NotificationChannel[];
  /** Channels returned to the platform default. */
  reset: NotificationChannel[];
};

/**
 * Mirrors whichever legacy flags were supplied into canonical preference rows.
 *
 * Only the keys actually present are touched: a settings screen that saves one toggle must not
 * silently reset the other three.
 */
export async function mirrorLegacyFlagsToPreferences(
  userId: string,
  flags: LegacyNotificationFlags,
): Promise<LegacyMirrorResult> {
  const optedOut: NotificationChannel[] = [];
  const reset: NotificationChannel[] = [];

  for (const [flag, channel] of Object.entries(LEGACY_CHANNEL_MAP) as Array<[LegacyFlag, NotificationChannel]>) {
    const value = flags[flag];
    if (value === undefined) continue;

    const where = {
      userId_channel_category: { userId, channel, category: "OPTIONAL" as const },
    };

    if (value === false) {
      await prisma.notificationPreference.upsert({
        where,
        create: { userId, channel, category: "OPTIONAL", enabled: false },
        update: { enabled: false },
      });
      optedOut.push(channel);
    } else {
      await prisma.notificationPreference.deleteMany({
        where: { userId, channel, category: "OPTIONAL" },
      });
      reset.push(channel);
    }
  }

  return { optedOut, reset };
}

/**
 * The legacy view of a user's canonical preferences, for clients still reading booleans.
 *
 * Absence of a row means "use the default", which is what `evaluatePreference` also concludes, so
 * the two surfaces cannot disagree.
 */
export async function legacyFlagsFromPreferences(
  userId: string,
): Promise<Required<LegacyNotificationFlags>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId, category: "OPTIONAL" },
    select: { channel: true, enabled: true },
  });
  const byChannel = new Map(rows.map((r) => [r.channel, r.enabled]));
  const defaults = categoryDefaultChannels("OPTIONAL");

  const read = (channel: NotificationChannel): boolean =>
    byChannel.get(channel) ?? defaults.includes(channel);

  return {
    notificationsEnabled: byChannel.get("IN_APP") ?? true,
    pushNotifications: read("PUSH"),
    emailNotifications: read("EMAIL"),
    smsNotifications: read("SMS"),
  };
}

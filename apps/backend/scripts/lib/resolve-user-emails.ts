/**
 * Resolve every user's e-mail address for provenance classification — plaintext or encrypted.
 *
 * The provenance e-mail rules were run against `users.email`, which after PII encryption is NULL for
 * 794 of 882 users (measured 2026-09-21): the address lives in `email_encrypted`. So the rules only
 * ever saw 88 legacy accounts, every user-level classification figure was taken over ~10% of the
 * population, and a backfill would have left 90% of fixture accounts silently UNKNOWN. This is the
 * one place both `provenance-report.ts` and `dq7-scope-impact.ts` get addresses from, so they cannot
 * diverge again.
 *
 * Two properties callers must know:
 *
 *   - Decrypting writes one `DATA_DECRYPTED` enterprise-audit row per encrypted address. That is
 *     correct — it is PII access and it should be on the record — but it means a run is not free of
 *     writes. The actor is recorded as `system:<purpose>`.
 *   - Data keys are resolved through the APP's Prisma client (DATABASE_URL). Decrypting rows read
 *     from a different database with those keys would fail or, worse, silently mismatch, so this
 *     refuses unless `targetDb` is the database the app is configured for.
 */
import { PrismaClient } from "@prisma/client";

export async function resolveUserEmails(
  target: PrismaClient,
  purpose: string,
): Promise<{ emails: Map<string, string | null>; decrypted: number; failed: number }> {
  const appPrisma = (await import("../../src/lib/prisma")).default;
  const [{ db: targetDb }] = await target.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  const [{ db: appDb }] = await appPrisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");

  const users = await target.user.findMany({ select: { id: true, email: true, emailEncrypted: true } });
  const needsDecrypt = users.some((u) => !u.email && u.emailEncrypted);
  if (needsDecrypt && targetDb !== appDb) {
    throw new Error(
      `REFUSING to decrypt: target database "${targetDb}" is not the app's configured database "${appDb}". ` +
        `Data keys are resolved from the app database, so decrypting another database's rows with them is invalid.`,
    );
  }

  const { userPiiService } = await import("../../src/services/user-pii.service");
  const emails = new Map<string, string | null>();
  let decrypted = 0;
  let failed = 0;
  for (const u of users) {
    if (u.email) {
      emails.set(u.id, u.email);
      continue;
    }
    if (!u.emailEncrypted) {
      emails.set(u.id, null);
      continue;
    }
    try {
      emails.set(u.id, await userPiiService.resolveEmail(u, { actorId: `system:${purpose}` }));
      decrypted++;
    } catch {
      // An address that cannot be decrypted is UNKNOWN, never guessed.
      emails.set(u.id, null);
      failed++;
    }
  }
  return { emails, decrypted, failed };
}

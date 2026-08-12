/**
 * Backfill existing users: encrypt email/phone, populate hash columns, clear plaintext.
 *
 * Usage: bun --env-file=.env run scripts/migrate-user-pii-encryption.ts
 * Optional: --dry-run
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { keyManagementService } from "../src/services/key-management.service";
import { userPiiService } from "../src/services/user-pii.service";
import { normalizeEmail, normalizePhone } from "../src/lib/pii-normalize";

const dryRun = process.argv.includes("--dry-run");
const BATCH = 100;

async function main() {
  await keyManagementService.bootstrap();

  let cursor: string | undefined;
  let migrated = 0;
  let skipped = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [{ email: { not: null } }, { phoneNumber: { not: null } }],
        dataEncryptionStatus: { not: "ENCRYPTED" },
      },
      take: BATCH,
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        emailEncrypted: true,
        phoneEncrypted: true,
      },
    });

    if (users.length === 0) break;

    for (const user of users) {
      const email = user.email ? normalizeEmail(user.email) : null;
      const phone = user.phoneNumber ? normalizePhone(user.phoneNumber) : null;

      if (!email && !phone) {
        skipped++;
        continue;
      }

      const patch = await userPiiService.buildEncryptedUpdateFields(
        {
          ...(email ? { email } : {}),
          ...(phone ? { phoneNumber: phone } : {}),
        },
        user.id,
      );

      if (!dryRun) {
        await prisma.user.update({
          where: { id: user.id },
          data: patch,
        });
      }

      migrated++;
      console.log(`[migrate-pii] user=${user.id} encrypted=${!dryRun}`);
    }

    cursor = users[users.length - 1]!.id;
    if (users.length < BATCH) break;
  }

  console.log(`[migrate-pii] done migrated=${migrated} skipped=${skipped} dryRun=${dryRun}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

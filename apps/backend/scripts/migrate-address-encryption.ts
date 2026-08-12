/**
 * Backfill address PII encryption.
 * Usage: bun --env-file=.env run scripts/migrate-address-encryption.ts [--dry-run]
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { keyManagementService } from "../src/services/key-management.service";
import { addressPiiService } from "../src/services/address-pii.service";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await keyManagementService.bootstrap();

  const rows = await prisma.address.findMany({
    where: {
      OR: [
        { addressLine1: { not: null } },
        { fullAddress: { not: null } },
        { landmark: { not: null } },
        { specialInstructions: { not: null } },
      ],
      dataEncryptionStatus: { not: "ENCRYPTED" },
    },
  });

  let migrated = 0;
  for (const row of rows) {
    const decrypted = await addressPiiService.withDecrypted(row);
    const patch = await addressPiiService.buildEncryptedUpdateFields(
      {
        addressLine1: decrypted.addressLine1,
        addressLine2: decrypted.addressLine2,
        fullAddress: decrypted.fullAddress,
        landmark: decrypted.landmark,
        specialInstructions: decrypted.specialInstructions,
      },
      row,
      row.userId,
    );
    if (!dryRun) {
      await prisma.address.update({ where: { id: row.id }, data: patch });
    }
    migrated++;
    console.log(`[migrate-address] id=${row.id} encrypted=${!dryRun}`);
  }

  console.log(`[migrate-address] done migrated=${migrated} dryRun=${dryRun}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

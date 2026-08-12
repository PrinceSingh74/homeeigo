/**
 * Backfill provider KYC/bank fields: encrypt plaintext, populate hash columns.
 * Usage: bun --env-file=.env run scripts/migrate-provider-sensitive.ts [--dry-run]
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { getEncryptionService } from "../src/utils/encryption";
import { encryptProviderKycFields } from "../src/services/sensitive-data.service";

const dryRun = process.argv.includes("--dry-run");
const enc = () => getEncryptionService();

function isPlaintext(value: string | null | undefined): boolean {
  if (!value) return false;
  return !enc().isEncrypted(value);
}

async function main() {
  const providers = await prisma.provider.findMany({
    select: {
      id: true,
      panNumber: true,
      aadharNumber: true,
      bankAccountNumber: true,
      bankAccountHolder: true,
      bankIfscCode: true,
      bankName: true,
      taxId: true,
      upiId: true,
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const p of providers) {
    const needs =
      isPlaintext(p.panNumber) ||
      isPlaintext(p.aadharNumber) ||
      isPlaintext(p.bankAccountNumber) ||
      isPlaintext(p.bankAccountHolder) ||
      isPlaintext(p.bankIfscCode) ||
      isPlaintext(p.bankName) ||
      isPlaintext(p.taxId) ||
      isPlaintext(p.upiId);

    if (!needs) {
      skipped++;
      continue;
    }

    const patch = encryptProviderKycFields({
      panNumber: isPlaintext(p.panNumber) ? p.panNumber : undefined,
      aadharNumber: isPlaintext(p.aadharNumber) ? p.aadharNumber : undefined,
      bankAccountNumber: isPlaintext(p.bankAccountNumber) ? p.bankAccountNumber : undefined,
      bankAccountHolder: isPlaintext(p.bankAccountHolder) ? p.bankAccountHolder : undefined,
      bankIfscCode: isPlaintext(p.bankIfscCode) ? p.bankIfscCode : undefined,
      bankName: isPlaintext(p.bankName) ? p.bankName : undefined,
      taxId: isPlaintext(p.taxId) ? p.taxId : undefined,
      upiId: isPlaintext(p.upiId) ? p.upiId : undefined,
    });

    if (Object.keys(patch).length === 0) {
      skipped++;
      continue;
    }

    if (!dryRun) {
      await prisma.provider.update({ where: { id: p.id }, data: patch });
    }
    migrated++;
    console.log(`[migrate-provider] id=${p.id} encrypted=${!dryRun}`);
  }

  console.log(`[migrate-provider] done migrated=${migrated} skipped=${skipped} dryRun=${dryRun}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

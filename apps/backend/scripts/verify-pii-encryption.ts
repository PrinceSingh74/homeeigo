/**
 * Verify PII encryption integrity after backfill.
 * Usage: bun --env-file=.env run scripts/verify-pii-encryption.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { userPiiService } from "../src/services/user-pii.service";
import { getEncryptionService } from "../src/utils/encryption";
const enc = () => getEncryptionService();

async function verifyUsers() {
  const total = await prisma.user.count();
  const plaintextEmail = await prisma.user.count({
    where: { email: { not: null } },
  });
  const plaintextPhone = await prisma.user.count({
    where: { phoneNumber: { not: null } },
  });
  const encrypted = await prisma.user.count({
    where: { dataEncryptionStatus: "ENCRYPTED" },
  });

  const sample = await prisma.user.findMany({
    take: 50,
    where: { dataEncryptionStatus: "ENCRYPTED" },
    select: {
      id: true,
      email: true,
      phoneNumber: true,
      emailEncrypted: true,
      phoneEncrypted: true,
      emailHash: true,
      phoneHash: true,
    },
  });

  let hashMismatches = 0;
  let decryptErrors = 0;

  for (const user of sample) {
    try {
      const email = await userPiiService.resolveEmail(user);
      const phone = await userPiiService.resolvePhone(user);
      if (email && user.emailHash !== userPiiService.hashEmail(email)) hashMismatches++;
      if (phone && user.phoneHash !== userPiiService.hashPhone(phone)) hashMismatches++;
      if (user.email !== null) throw new Error(`plaintext email remains for ${user.id}`);
      if (user.phoneNumber !== null) throw new Error(`plaintext phone remains for ${user.id}`);
    } catch {
      decryptErrors++;
    }
  }

  return {
    total,
    plaintextEmail,
    plaintextPhone,
    encrypted,
    sampleSize: sample.length,
    hashMismatches,
    decryptErrors,
    pass: plaintextEmail === 0 && plaintextPhone === 0 && hashMismatches === 0 && decryptErrors === 0,
  };
}

async function verifyProviders() {
  const providers = await prisma.provider.findMany({
    select: {
      id: true,
      panNumber: true,
      aadharNumber: true,
      bankAccountNumber: true,
    },
  });

  let plaintextSensitive = 0;
  for (const p of providers) {
    for (const field of [p.panNumber, p.aadharNumber, p.bankAccountNumber]) {
      if (field && !enc().isEncrypted(field)) plaintextSensitive++;
    }
  }

  return { providerCount: providers.length, plaintextSensitiveFields: plaintextSensitive };
}

async function verifyOtps() {
  const recentPlain = await prisma.oTP.count({
    where: { phoneNumber: { not: null } },
  });
  return { otpsWithPlaintextPhone: recentPlain };
}

async function main() {
  const [users, providers, otps] = await Promise.all([
    verifyUsers(),
    verifyProviders(),
    verifyOtps(),
  ]);

  const report = { users, providers, otps, verifiedAt: new Date().toISOString() };
  console.log(JSON.stringify(report, null, 2));

  if (!users.pass) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

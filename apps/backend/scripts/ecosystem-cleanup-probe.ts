/**
 * Proves ecosystem cert cleanup is transactional and idempotent (double-run safe).
 *
 *   bun --env-file=.env run scripts/ecosystem-cleanup-probe.ts
 */
import "../src/load-env";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/lib/prisma";
import { fixturePhone } from "../src/__tests__/helpers/adversarial-fixtures";
import {
  cleanupEcoCertFixtures,
  cleanupEcoCertFixturesIdempotent,
  type EcoCertFixtures,
} from "./lib/ecosystem-cert-cleanup";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const OUT_JSON = join(REPO, "homigo-mobile", ".certification-evidence", "ecosystem-cleanup-probe.json");

async function seedProbeFixtures(runId: string): Promise<EcoCertFixtures & { bookingId: string }> {
  const passwordHash = await Bun.password.hash("Eco@123", { algorithm: "bcrypt", cost: 4 });

  const service = await prisma.service.create({
    data: {
      name: `Probe Service ${runId}`,
      slug: `probe-svc-${runId}`,
      description: "Cleanup probe",
      category: "cleaning",
      basePrice: 500,
      estimatedDuration: 60,
      isActive: true,
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: `eco-cust-${runId}@homigo.test`,
      phoneNumber: fixturePhone(runId, "cust"),
      firstName: "Probe",
      lastName: "Customer",
      password: passwordHash,
      role: "CUSTOMER",
      isEmailVerified: true,
      walletBalance: 1000,
    },
  });

  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "1 Probe St",
      city: "Mumbai",
      state: "MH",
      zipCode: "400001",
      latitude: 19.076,
      longitude: 72.8777,
    },
  });

  const vendorUser = await prisma.user.create({
    data: {
      email: `eco-prov-${runId}@homigo.test`,
      phoneNumber: fixturePhone(runId, "prov"),
      firstName: "Probe",
      lastName: "Partner",
      password: passwordHash,
      role: "VENDOR",
      isEmailVerified: true,
    },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: vendorUser.id,
      isActive: true,
      isApproved: true,
      isOnline: true,
      serviceCategories: [service.id],
      walletBalance: 100,
    },
  });

  await prisma.location.create({
    data: { providerId: provider.id, latitude: 19.0765, longitude: 72.878 },
  });

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `PROBE-${runId}`,
      userId: customer.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: address.id,
      status: "COMPLETED",
      scheduledDate: new Date(),
      completedAt: new Date(),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
    },
  });

  await prisma.earning.create({
    data: {
      bookingId: booking.id,
      providerId: provider.id,
      grossAmount: 500,
      commission: 100,
      netEarning: 400,
    },
  });

  // Simulates booking completion hcoinService.earn() upsert — root cause of FK violation.
  await prisma.hCoinWallet.upsert({
    where: { userId: customer.id },
    create: { userId: customer.id, balance: 50, lifetimeEarned: 50 },
    update: { balance: { increment: 50 }, lifetimeEarned: { increment: 50 } },
  });

  await prisma.hCoinTransaction.create({
    data: {
      userId: customer.id,
      type: "EARN",
      amount: 50,
      reason: "BOOKING_COMPLETE",
      balanceAfter: 50,
      description: "probe earn",
    },
  });

  return {
    runId,
    serviceId: service.id,
    customerId: customer.id,
    vendorUserId: vendorUser.id,
    providerId: provider.id,
    addressId: address.id,
    bookingId: booking.id,
  };
}

async function main() {
  const runId = `probe-${Date.now().toString(36)}`;
  console.log(`\n=== Ecosystem Cleanup Probe (${runId}) ===\n`);

  const fx = await seedProbeFixtures(runId);

  const walletBefore = await prisma.hCoinWallet.count({ where: { userId: fx.customerId } });
  console.log(`[probe] hcoin_wallets before cleanup: ${walletBefore}`);

  const pass1 = await cleanupEcoCertFixtures(prisma, fx);
  const pass2 = await cleanupEcoCertFixturesIdempotent(prisma, fx);

  const walletAfter = await prisma.hCoinWallet.count({ where: { userId: fx.customerId } });
  const usersAfter = await prisma.user.count({
    where: { id: { in: [fx.customerId, fx.vendorUserId] } },
  });

  const ok =
    pass1.ok &&
    pass2.ok &&
    walletBefore === 1 &&
    walletAfter === 0 &&
    usersAfter === 0 &&
    pass2.steps.every((s) => s.deleted === 0);

  const evidence = {
    generatedAt: new Date().toISOString(),
    runId,
    exactFailingRelation: "hcoin_wallets_user_id_fkey",
    walletBefore,
    walletAfter,
    usersAfter,
    pass1: {
      ok: pass1.ok,
      transactional: pass1.transactional,
      totalDeleted: pass1.steps.reduce((n, s) => n + s.deleted, 0),
      hcoinWalletsDeleted: pass1.steps.find((s) => s.table === "hcoin_wallets")?.deleted ?? 0,
      usersDeleted: pass1.steps.find((s) => s.table === "users")?.deleted ?? 0,
      error: pass1.error,
    },
    pass2: {
      ok: pass2.ok,
      transactional: pass2.transactional,
      totalDeleted: pass2.steps.reduce((n, s) => n + s.deleted, 0),
      idempotent: pass2.steps.every((s) => s.deleted === 0),
      error: pass2.error,
    },
    verdict: ok ? "PASS" : "FAIL",
  };

  writeFileSync(OUT_JSON, JSON.stringify(evidence, null, 2));
  console.log(`\n[probe] verdict=${evidence.verdict} evidence=${OUT_JSON}\n`);

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(3);
});

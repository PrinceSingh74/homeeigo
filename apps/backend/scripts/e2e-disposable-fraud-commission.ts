/**
 * Disposable PENDING ReferralCommission for Section 10 admin fraud mutation e2e.
 * Usage (from apps/backend):
 *   bun --env-file=.env.test run scripts/e2e-disposable-fraud-commission.ts            (local, isolated stack)
 *   bun --env-file=.env run scripts/e2e-disposable-fraud-commission.ts --allow-live    (CI's throwaway homigo_db only)
 * Prints JSON: { commissionId, refereeId, bookingId }
 *
 * Declared target (scripts/lib/script-target.ts): refuses any non-test database unless `--allow-live`.
 * The Section 10 spec launched this with a hard-coded `--env-file=.env`; on 2026-09-30 the live
 * database held 12 `S10F-*` bookings and 12 referral commissions it wrote there (2026-09-03..06).
 */
import { CommissionStatus, ReferralStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { requireDeclaredTarget } from "./lib/script-target";

const stamp = Date.now();

async function main() {
  requireDeclaredTarget({ label: "e2e-disposable-fraud-commission" });
  const referrer = await prisma.user.findFirst({ where: { email: "customer@homigo.demo" } });
  if (!referrer) throw new Error("customer@homigo.demo missing");

  const referee = await prisma.user.create({
    data: { dataOrigin: "TEST",
      email: `s10comm${stamp}@homigo.test`,
      phoneNumber: `+9199${String(stamp).slice(-8)}`,
      firstName: "S10",
      lastName: "Comm",
      password: "x".repeat(20),
      referralCode: `S10C${stamp}`.slice(0, 16),
    },
  });

  const txn = await prisma.referralTransaction.create({
    data: {
      referrerId: referrer.id,
      refereeId: referee.id,
      code: referrer.referralCode ?? "DEMO2026",
      status: ReferralStatus.QUALIFIED,
      qualifiedAt: new Date(),
    },
  });

  const svc = await prisma.service.findFirst({ where: { isActive: true } });
  if (!svc) throw new Error("no active service");

  const addr = await prisma.address.create({
    data: {
      userId: referee.id,
      label: "Home",
      addressLine1: "1 Test St",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: 12.97,
      longitude: 77.59,
    },
  });

  const booking = await prisma.booking.create({
    data: { dataOrigin: "TEST",
      bookingNumber: `S10F-${stamp}`,
      userId: referee.id,
      serviceId: svc.id,
      addressId: addr.id,
      scheduledDate: new Date(Date.now() + 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: "SUCCESS",
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  const commission = await prisma.referralCommission.create({
    data: {
      referrerId: referrer.id,
      refereeId: referee.id,
      transactionId: txn.id,
      bookingId: booking.id,
      amount: 100,
      status: CommissionStatus.PENDING,
      riskScore: 12,
    },
  });

  console.log(JSON.stringify({ commissionId: commission.id, refereeId: referee.id, bookingId: booking.id }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

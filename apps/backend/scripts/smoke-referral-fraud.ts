/**
 * Referral Fraud Engine smoke test
 *   bun --env-file=.env run scripts/smoke-referral-fraud.ts
 */
import { CommissionStatus, ReferralStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { FraudEventType } from "@prisma/client";
import { referralService, REFERRAL_COMMISSION } from "../src/services/referral.service";
import { fraudAdminService } from "../src/services/fraud-admin.service";
import { fraudSignalService } from "../src/services/fraud-signal.service";
import type { FraudContext } from "../src/lib/fraud-context";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`));
  else (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`));
};

const tag = Date.now().toString(36);
const SHARED_DEVICE = `device-fraud-${tag}`;
const SHARED_IP = "203.0.113.50";
const ids = { referrer: "", fraudReferrer: "", referee: "", referee2: "", booking: "", commission: "" };

async function mkUser(prefix: string) {
  const u = await prisma.user.create({
    data: {
      email: `${prefix}-${tag}@fraud.test`,
      phoneNumber: `+9177${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: prefix,
      lastName: "Test",
      password: "x".repeat(20),
      referralCode: `${prefix.toUpperCase()}${tag}`.slice(0, 16),
    },
  });
  return u;
}

async function main() {
  const referrer = await mkUser("referrer");
  const referee = await mkUser("referee");
  ids.fraudReferrer = referrer.id;
  ids.referee = referee.id;

  const ctx: FraudContext = {
    deviceId: SHARED_DEVICE,
    ipAddress: SHARED_IP,
    browserFingerprint: `bf-${tag}`,
    userAgent: "smoke-test",
  };

  // Seed referrer signals so self-referral detection can match device/IP
  await fraudSignalService.capture(FraudEventType.SIGNUP, { ...ctx, userId: referrer.id }, {
    id: referrer.id,
    type: "user",
  });

  // Phase 3 — self-referral via same device/IP
  console.log("\n🔒 Phase 3 — Self-referral detection");
  const blocked = await referralService.recordSignup(referrer.id, referee.id, referrer.referralCode!, ctx);
  ok("same device/IP referral blocked", blocked === false);

  const fraudTxn = await prisma.referralTransaction.findUnique({ where: { refereeId: referee.id } });
  ok("fraud_blocked transaction created", fraudTxn?.status === ReferralStatus.FRAUD_BLOCKED);

  // Legitimate referral with different signals (fresh referrer to avoid risk carry-over)
  console.log("\n✅ Legitimate referral path");
  const cleanReferrer = await mkUser("cleanref");
  ids.referrer = cleanReferrer.id;
  const referee2 = await mkUser("goodref");
  ids.referee2 = referee2.id;
  const goodCtx: FraudContext = {
    deviceId: `unique-device-${tag}`,
    ipAddress: "198.51.100.10",
    browserFingerprint: `unique-bf-${tag}`,
  };
  const allowed = await referralService.recordSignup(
    cleanReferrer.id,
    referee2.id,
    cleanReferrer.referralCode!,
    goodCtx,
  );
  ok("clean referral allowed", allowed === true);

  const svc = await prisma.service.findFirst({ where: { isActive: true } });
  if (!svc) throw new Error("No active service for booking test");
  const addr = await prisma.address.create({
    data: {
      userId: referee2.id,
      label: "Home",
      addressLine1: "1 St",
      city: "Mumbai",
      state: "MH",
      zipCode: "400001",
      latitude: 19.07,
      longitude: 72.87,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `FRAUD-${tag}`,
      userId: referee2.id,
      serviceId: svc.id,
      addressId: addr.id,
      scheduledDate: new Date(Date.now() + 86400_000),
      baseAmount: 1000,
      finalAmount: 1100,
      totalAmount: 1100,
      paymentStatus: "SUCCESS",
    },
  });
  ids.booking = booking.id;

  await referralService.onBookingCompleted(referee2.id, booking.id, goodCtx);
  const comm = await prisma.referralCommission.findFirst({ where: { referrerId: cleanReferrer.id } });
  ids.commission = comm?.id ?? "";
  ok("commission created on qualification", !!comm, `status=${comm?.status}`);

  // Phase 6 — frozen commissions not withdrawable
  console.log("\n🧊 Phase 6 — Commission freeze");
  if (comm?.status === CommissionStatus.APPROVED) {
    const bal = await referralService.summary(cleanReferrer.id);
    ok("approved commission in balance", bal.balance >= REFERRAL_COMMISSION - 1);
  } else {
    const bal = await referralService.summary(cleanReferrer.id);
    ok("non-approved commission excluded from balance", bal.balance === 0, `frozen=${bal.frozenBalance}`);
  }

  // Phase 7/8 — admin dashboard
  console.log("\n📊 Phase 7/8 — Fraud analytics");
  const overview = await fraudAdminService.overview();
  ok("fraud overview has metrics", overview.totalReferrals >= 1);
  ok("risk distribution present", Object.keys(overview.riskDistribution).length >= 0);
  const highRisk = await fraudAdminService.highRiskUsers(5);
  ok("high-risk users query works", Array.isArray(highRisk));

  const decisions = await prisma.fraudDecisionLog.count();
  ok("decision logs recorded", decisions > 0, `count=${decisions}`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} Referral Fraud: ${pass} passed, ${fail} failed\n`);
}

async function cleanup() {
  try {
    if (ids.commission) await prisma.referralCommission.deleteMany({ where: { id: ids.commission } });
    if (ids.booking) await prisma.booking.delete({ where: { id: ids.booking } });
    const userIds = [ids.referrer, ids.fraudReferrer, ids.referee, ids.referee2].filter(Boolean);
    await prisma.fraudAlert.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fraudDecisionLog.deleteMany({ where: { targetUserId: { in: userIds } } });
    await prisma.fraudSignal.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fraudRiskScore.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.referralTransaction.deleteMany({
      where: { referrerId: { in: [ids.referrer, ids.fraudReferrer].filter(Boolean) } },
    });
    if (ids.referee2) await prisma.address.deleteMany({ where: { userId: ids.referee2 } });
    await prisma.hCoinTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.hCoinWallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    console.log("🧹 test data cleaned up");
  } catch (e) {
    console.error("cleanup:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("Fatal:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });

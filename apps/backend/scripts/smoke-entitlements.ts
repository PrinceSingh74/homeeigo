/**
 * Live entitlement-engine proof (service layer, no HTTP). Proves benefits are
 * BACKEND-ENFORCED, not display-only:
 *   - premium-only service blocked for normal user, allowed for premium
 *   - membership discount applied server-side (tamper-proof) only for premium
 *   - usage ledgered in MembershipBenefitUsage
 * Creates isolated test data and cleans it up in a finally block.
 *
 *   bun --env-file=.env run scripts/smoke-entitlements.ts
 */
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { subscriptionService } from "../src/services/subscription.service";
import { entitlementService } from "../src/services/entitlement.service";
import { SubscriptionStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`));
  else (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`));
};

const tag = Date.now().toString(36);
const ids = { plan: "", normalSvc: "", premiumSvc: "", normalUser: "", premiumUser: "", normalAddr: "", premiumAddr: "", bookings: [] as string[] };

async function mkUser(prefix: string) {
  const u = await prisma.user.create({
    data: {
      email: `${prefix}-${tag}@entl.test`,
      phoneNumber: `+9199${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: prefix,
      lastName: "Test",
      password: "x".repeat(20),
    },
  });
  const a = await prisma.address.create({
    data: {
      userId: u.id,
      label: "Home",
      addressLine1: "1 Test St",
      city: "Mumbai",
      state: "MH",
      zipCode: "400001",
      latitude: 19.07,
      longitude: 72.87,
    },
  });
  return { userId: u.id, addressId: a.id };
}

const future = (days = 3) => new Date(Date.now() + days * 86400_000).toISOString();

async function main() {
  // ── Setup: plan with STRUCTURED benefits, a normal + a premium-only service ──
  const plan = await subscriptionService.adminCreatePlan({
    name: `TEST Gold ${tag}`,
    interval: "MONTHLY",
    price: 199,
    tier: "gold",
    benefits: [
      { label: "10% off every booking", type: "DISCOUNT_PCT", value: 10 },
      { label: "5% cashback", type: "CASHBACK_PCT", value: 5 },
      { label: "Access to premium-only services", type: "PREMIUM_ONLY_ACCESS" },
      { label: "Priority support", type: "PRIORITY_SUPPORT" },
      "Member-only seasonal offers", // legacy display-only label
    ],
  });
  ids.plan = plan.id;

  const normalSvc = await prisma.service.create({
    data: { name: `TEST Normal Clean ${tag}`, slug: `test-normal-${tag}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60, premiumOnly: false },
  });
  const premiumSvc = await prisma.service.create({
    data: { name: `TEST Premium Spa ${tag}`, slug: `test-premium-${tag}`, description: "x", category: "spa", basePrice: 2000, estimatedDuration: 90, premiumOnly: true },
  });
  ids.normalSvc = normalSvc.id;
  ids.premiumSvc = premiumSvc.id;

  const normal = await mkUser("normal");
  const premium = await mkUser("premium");
  ids.normalUser = normal.userId;
  ids.premiumUser = premium.userId;
  ids.normalAddr = normal.addressId;
  ids.premiumAddr = premium.addressId;

  // premium user gets an ACTIVE subscription on the plan
  await prisma.userSubscription.create({
    data: {
      userId: premium.userId,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    },
  });

  // ── Phase 1: entitlement resolution ──
  console.log("\n🧩 Entitlement resolution (server-side authority)");
  const eNormal = await entitlementService.resolve(normal.userId);
  const ePrem = await entitlementService.resolve(premium.userId);
  ok("normal: no membership", eNormal.hasMembership === false);
  ok("normal: discount 0, no premium access", eNormal.discountPct === 0 && eNormal.premiumAccess === false);
  ok("premium: hasMembership + tier gold", ePrem.hasMembership && ePrem.tier === "gold");
  ok("premium: discount 10, cashback 5", ePrem.discountPct === 10 && ePrem.cashbackPct === 5, `disc=${ePrem.discountPct} cb=${ePrem.cashbackPct}`);
  ok("premium: premiumAccess + prioritySupport", ePrem.premiumAccess && ePrem.prioritySupport);

  // ── Phase 6: premium-only gate (backend-enforced) ──
  console.log("\n🔒 Premium-only service gate");
  const r1 = await bookingService.create(normal.userId, { serviceId: premiumSvc.id, scheduledDate: future(), addressId: normal.addressId });
  ok("normal user BLOCKED from premium-only", "error" in r1 && r1.error === "UPGRADE_REQUIRED", "error" in r1 ? r1.error : "created!");

  // ── Phase 5: membership discount (tamper-proof, server-computed) ──
  console.log("\n💸 Membership discount applied server-side");
  // Distinct dates so the overlap-guard doesn't reject the second premium booking.
  const rNormalBook = await bookingService.create(normal.userId, { serviceId: normalSvc.id, scheduledDate: future(3), addressId: normal.addressId });
  const rPremBook = await bookingService.create(premium.userId, { serviceId: normalSvc.id, scheduledDate: future(5), addressId: premium.addressId });
  const rPremPremium = await bookingService.create(premium.userId, { serviceId: premiumSvc.id, scheduledDate: future(12), addressId: premium.addressId });

  for (const r of [rNormalBook, rPremBook, rPremPremium]) if ("booking" in r) ids.bookings.push(r.booking.id);

  const bNormal = "booking" in rNormalBook ? await prisma.booking.findUnique({ where: { id: rNormalBook.booking.id } }) : null;
  const bPrem = "booking" in rPremBook ? await prisma.booking.findUnique({ where: { id: rPremBook.booking.id } }) : null;
  const bPremPrem = "booking" in rPremPremium ? await prisma.booking.findUnique({ where: { id: rPremPremium.booking.id } }) : null;

  ok("normal: no discount, ₹1000+10% tax = ₹1100", bNormal?.discount === 0 && bNormal?.finalAmount === 1100, `disc=${bNormal?.discount} final=${bNormal?.finalAmount}`);
  ok("premium: 10% off ₹1000 → disc ₹100, final ₹990", bPrem?.discount === 100 && bPrem?.finalAmount === 990, `disc=${bPrem?.discount} final=${bPrem?.finalAmount}`);
  ok("premium can BOOK premium-only, 10% off ₹2000 → disc ₹200, final ₹1980", bPremPrem?.discount === 200 && bPremPrem?.finalAmount === 1980, `disc=${bPremPrem?.discount} final=${bPremPrem?.finalAmount}`);

  // ── Phase 1: usage ledger ──
  console.log("\n📒 Benefit usage ledger");
  const usage = await prisma.membershipBenefitUsage.findFirst({ where: { userId: premium.userId, benefitType: "DISCOUNT_PCT" } });
  ok("discount usage ledgered (count 2, amount 300)", usage?.count === 2 && usage?.amount === 300, `count=${usage?.count} amount=${usage?.amount}`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} Entitlements: ${pass} passed, ${fail} failed\n`);
}

async function cleanup() {
  try {
    await prisma.membershipBenefitUsage.deleteMany({ where: { userId: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids.bookings } } });
    await prisma.userSubscription.deleteMany({ where: { userId: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.address.deleteMany({ where: { id: { in: [ids.normalAddr, ids.premiumAddr] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.service.deleteMany({ where: { id: { in: [ids.normalSvc, ids.premiumSvc] } } });
    if (ids.plan) await prisma.membershipPlan.delete({ where: { id: ids.plan } });
    console.log("🧹 test data cleaned up");
  } catch (e) {
    console.error("cleanup warning:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("Fatal:", e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });

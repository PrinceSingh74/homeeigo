/**
 * Membership Premium Engine smoke test (Phases A–G).
 *   bun --env-file=.env run scripts/smoke-membership-premium.ts
 */
import { PaymentStatus, SubscriptionStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { subscriptionService } from "../src/services/subscription.service";
import { entitlementService } from "../src/services/entitlement.service";
import { cashbackService } from "../src/services/cashback.service";
import { bookingPriorityService } from "../src/services/booking-priority.service";
import { matchingService } from "../src/services/matching.service";
import { campaignService } from "../src/services/campaign.service";
import { supportTicketService } from "../src/services/support-ticket.service";
import { membershipAnalyticsService } from "../src/services/membership-analytics.service";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`));
  else (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`));
};

const tag = Date.now().toString(36);
const ids = {
  plan: "",
  svc: "",
  normalUser: "",
  premiumUser: "",
  normalAddr: "",
  premiumAddr: "",
  providerUser: "",
  providerId: "",
  bookings: [] as string[],
  campaignId: "",
};

async function mkUser(prefix: string) {
  const u = await prisma.user.create({
    data: {
      email: `${prefix}-${tag}@mp.test`,
      phoneNumber: `+9188${Math.floor(1000000 + Math.random() * 8999999)}`,
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
  const plan = await subscriptionService.adminCreatePlan({
    name: `TEST Premium ${tag}`,
    interval: "MONTHLY",
    price: 299,
    tier: "platinum",
    benefits: [
      { label: "10% off", type: "DISCOUNT_PCT", value: 10 },
      { label: "5% cashback", type: "CASHBACK_PCT", value: 5 },
      { label: "Premium access", type: "PREMIUM_ONLY_ACCESS" },
      { label: "Priority booking", type: "PRIORITY_BOOKING" },
      { label: "Priority support", type: "PRIORITY_SUPPORT" },
    ],
  });
  ids.plan = plan.id;

  const svc = await prisma.service.create({
    data: {
      name: `TEST Service ${tag}`,
      slug: `test-svc-${tag}`,
      description: "x",
      category: "cleaning",
      basePrice: 2000,
      estimatedDuration: 60,
    },
  });
  ids.svc = svc.id;

  const normal = await mkUser("normal");
  const premium = await mkUser("premium");
  ids.normalUser = normal.userId;
  ids.premiumUser = premium.userId;
  ids.normalAddr = normal.addressId;
  ids.premiumAddr = premium.addressId;

  await prisma.userSubscription.create({
    data: {
      userId: premium.userId,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400_000),
    },
  });

  const campaign = await campaignService.adminCreate({
    code: `PREM${tag}`.slice(0, 20),
    name: "Premium Test Coupon",
    type: "COUPON",
    status: "ACTIVE",
    premiumOnly: true,
    discountPct: 5,
  });
  ids.campaignId = campaign.id;

  // Phase B — priority queue
  console.log("\n📋 Phase B — Booking Priority Queue");
  const rNormal = await bookingService.create(normal.userId, {
    serviceId: svc.id,
    scheduledDate: future(3),
    addressId: normal.addressId,
  });
  const rPrem = await bookingService.create(premium.userId, {
    serviceId: svc.id,
    scheduledDate: future(5),
    addressId: premium.addressId,
    couponCode: campaign.code,
  });
  if ("booking" in rNormal) ids.bookings.push(rNormal.booking.id);
  if ("booking" in rPrem) ids.bookings.push(rPrem.booking.id);

  const bNormal = await prisma.booking.findUnique({ where: { id: "booking" in rNormal ? rNormal.booking.id : "" } });
  const bPrem = await prisma.booking.findUnique({ where: { id: "booking" in rPrem ? rPrem.booking.id : "" } });
  ok("normal queue priority NORMAL", bNormal?.queuePriority === "NORMAL");
  ok("premium queue priority HIGH", bPrem?.queuePriority === "HIGH");
  ok("premium booking has campaign discount", (bPrem?.campaignDiscount ?? 0) > 0, `disc=${bPrem?.campaignDiscount}`);

  ok(
    "premium queue position before normal (server-assigned)",
    (bPrem?.queuePosition ?? 99) < (bNormal?.queuePosition ?? 0),
    `premPos=${bPrem?.queuePosition} normPos=${bNormal?.queuePosition}`,
  );
  const queue = await bookingPriorityService.getAssignmentQueue(100);
  const premIdx = queue.findIndex((q) => q.bookingId === bPrem?.id);
  const normIdx = queue.findIndex((q) => q.bookingId === bNormal?.id);
  if (premIdx >= 0 && normIdx >= 0) {
    ok("premium ahead of normal in assignment queue", premIdx < normIdx, `prem=${premIdx} norm=${normIdx}`);
  }

  // Phase C — premium matching
  console.log("\n🎯 Phase C — Premium Provider Matching");
  const provUser = await prisma.user.create({
    data: {
      email: `prov-${tag}@mp.test`,
      phoneNumber: `+9177${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Pro",
      lastName: "Vider",
      password: "x".repeat(20),
      role: "VENDOR",
    },
  });
  const provider = await prisma.provider.create({
    data: {
      userId: provUser.id,
      serviceCategories: [svc.id],
      isActive: true,
      isApproved: true,
      isOnline: true,
      rating: 4.9,
      totalReviews: 50,
      responseRate: 95,
      completionRate: 98,
    },
  });
  ids.providerUser = provUser.id;
  ids.providerId = provider.id;
  await prisma.location.create({
    data: { providerId: provider.id, latitude: 19.071, longitude: 72.871 },
  });

  const matchNormal = await matchingService.findBestProviders({
    serviceId: svc.id,
    customerId: normal.userId,
    latitude: 19.07,
    longitude: 72.87,
    scheduledDate: new Date(future(7)),
  });
  const matchPrem = await matchingService.findBestProviders({
    serviceId: svc.id,
    customerId: premium.userId,
    latitude: 19.07,
    longitude: 72.87,
    scheduledDate: new Date(future(7)),
  });
  ok("premium match has premiumBoost", (matchPrem[0]?.premiumBoost ?? 0) > 0, `boost=${matchPrem[0]?.premiumBoost}`);
  ok("normal match has no premiumBoost", matchNormal[0]?.premiumBoost == null);

  // Phase A — cashback on payment settlement
  console.log("\n💰 Phase A — Cashback Engine");
  if (bPrem) {
    await prisma.booking.update({
      where: { id: bPrem.id },
      data: { paymentStatus: PaymentStatus.SUCCESS },
    });
    const cb = await cashbackService.settleOnPayment(premium.userId, bPrem.id);
    ok("cashback credited server-side", cb.credited && cb.amount > 0, `₹${cb.amount}`);
    const ledger = await prisma.membershipCashback.findUnique({ where: { bookingId: bPrem.id } });
    ok("cashback ledger created", !!ledger);
    const usage = await prisma.membershipBenefitUsage.findFirst({
      where: { userId: premium.userId, benefitType: "CASHBACK_PCT" },
    });
    ok("cashback usage recorded", (usage?.amount ?? 0) > 0);
  }

  // Phase E — support priority
  console.log("\n🎫 Phase E — Support Priority Queue");
  const tNormal = await supportTicketService.create(normal.userId, {
    subject: "Help",
    description: "Need assistance with booking",
    category: "booking",
  });
  const tPrem = await supportTicketService.create(premium.userId, {
    subject: "Priority help",
    description: "Premium member needs urgent help",
    category: "billing",
  });
  ok("normal support priority NORMAL", tNormal.priorityLevel === "normal");
  ok("premium support priority HIGH", tPrem.priorityLevel === "high");
  ok("premium SLA shorter than normal", (tPrem.slaDueAt?.getTime() ?? 0) < (tNormal.slaDueAt?.getTime() ?? 0));

  // Phase F — analytics
  console.log("\n📊 Phase F — Membership Analytics");
  const analytics = await membershipAnalyticsService.dashboard();
  ok("MRR computed", analytics.mrr >= 0, `mrr=${analytics.mrr}`);
  ok("active subscribers counted", analytics.activeSubscribers >= 1);
  ok("upgrade funnel present", analytics.upgradeFunnel.totalCustomers > 0);

  console.log(`\n${fail === 0 ? "✅" : "❌"} Membership Premium: ${pass} passed, ${fail} failed\n`);
}

async function cleanup() {
  try {
    await prisma.membershipCashback.deleteMany({
      where: { userId: { in: [ids.normalUser, ids.premiumUser] } },
    });
    await prisma.couponUsage.deleteMany({ where: { userId: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.membershipBenefitUsage.deleteMany({
      where: { userId: { in: [ids.normalUser, ids.premiumUser] } },
    });
    await prisma.supportTicket.deleteMany({
      where: { userId: { in: [ids.normalUser, ids.premiumUser] } },
    });
    await prisma.booking.deleteMany({ where: { id: { in: ids.bookings } } });
    if (ids.campaignId) await prisma.campaign.delete({ where: { id: ids.campaignId } }).catch(() => {});
    if (ids.providerId) {
      await prisma.location.deleteMany({ where: { providerId: ids.providerId } });
      await prisma.provider.delete({ where: { id: ids.providerId } });
    }
    if (ids.providerUser) await prisma.user.delete({ where: { id: ids.providerUser } });
    await prisma.userSubscription.deleteMany({ where: { userId: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.address.deleteMany({ where: { id: { in: [ids.normalAddr, ids.premiumAddr] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.normalUser, ids.premiumUser] } } });
    await prisma.service.delete({ where: { id: ids.svc } });
    if (ids.plan) await prisma.membershipPlan.delete({ where: { id: ids.plan } });
    console.log("🧹 test data cleaned up");
  } catch (e) {
    console.error("cleanup warning:", e instanceof Error ? e.message : e);
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

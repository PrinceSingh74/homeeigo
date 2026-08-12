/**
 * Ensures partner@homigo.demo has an approved Provider row (fixes 403 on /api/providers/me/*).
 * Safe to re-run — upserts provider for the demo vendor user.
 *
 * Usage: bun --env-file=.env run scripts/ensure-demo-partner.ts
 */
import prisma from "../src/lib/prisma";

const PARTNER_EMAIL = "partner@homigo.demo";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: PARTNER_EMAIL } });
  if (!user) {
    console.error(`User ${PARTNER_EMAIL} not found — run db:seed first.`);
    process.exit(1);
  }

  const services = await prisma.service.findMany({ take: 3, orderBy: { createdAt: "asc" } });
  if (services.length === 0) {
    console.error("No services in DB — run db:seed-services or db:seed.");
    process.exit(1);
  }

  const existing = await prisma.provider.findUnique({ where: { userId: user.id } });
  if (existing) {
    console.log(`Provider already exists: ${existing.id}`);
    return;
  }

  const provider = await prisma.provider.create({
    data: {
      userId: user.id,
      serviceCategories: services.map((s) => s.id),
      serviceRegions: ["Noida", "Delhi"],
      isVerified: true,
      isApproved: true,
      isOnline: true,
      rating: 4.8,
      totalReviews: 320,
      completedBookings: 1240,
      completionRate: 92,
      responseRate: 95,
      onTimeRate: 90,
      cancellationRate: 2,
      acceptanceRate: 92,
      walletBalance: 12480,
      reservedBalance: 0,
      totalEarnings: 124850,
      thisMonthEarnings: 54320,
      thisWeekEarnings: 18650,
      pushTokens: [],
      registrationStatus: "APPROVED",
      partnerApprovedAt: new Date(),
    },
  });

  await prisma.location.create({
    data: {
      providerId: provider.id,
      latitude: 28.63,
      longitude: 77.38,
      accuracy: 12,
    },
  });

  console.log(`Created demo provider ${provider.id} for ${PARTNER_EMAIL}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

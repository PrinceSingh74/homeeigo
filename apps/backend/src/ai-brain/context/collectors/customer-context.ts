import prisma from "../../../lib/prisma";

export async function collectCustomerContext(customerId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      defaultLanguage: true,
      walletBalance: true,
      totalSpent: true,
      _count: { select: { bookings: true, addresses: true } },
    },
  });

  if (!user) return {};

  const [activeBooking, recentBookings, subscription, hcoinWallet, savedAddresses, supportTickets] =
    await Promise.all([
      prisma.booking.findFirst({
        where: {
          userId: customerId,
          status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          scheduledDate: true,
          service: { select: { name: true, category: true } },
          provider: { select: { businessName: true, rating: true } },
        },
      }),
      prisma.booking.findMany({
        where: { userId: customerId, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 5,
        select: {
          id: true,
          completedAt: true,
          service: { select: { name: true } },
          totalAmount: true,
        },
      }),
      prisma.userSubscription.findFirst({
        where: { userId: customerId, status: "ACTIVE" },
        select: { plan: { select: { name: true, tier: true } } },
      }),
      prisma.hCoinWallet.findUnique({
        where: { userId: customerId },
        select: { balance: true },
      }),
      prisma.address.findMany({
        where: { userId: customerId },
        take: 3,
        select: { label: true, city: true, pincode: true },
      }),
      prisma.supportTicket.count({
        where: { userId: customerId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }).catch(() => 0),
    ]);

  const tier = user._count.bookings >= 20 ? "gold" : user._count.bookings >= 5 ? "silver" : "standard";

  return {
    profile: {
      id: user.id,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Guest",
      memberSince: user.createdAt.toISOString(),
      language: user.defaultLanguage,
      tier,
    },
    wallet: { balance: user.walletBalance, totalSpent: user.totalSpent },
    hcoin: hcoinWallet?.balance ?? 0,
    subscription: subscription?.plan ? { name: subscription.plan.name, tier: subscription.plan.tier } : null,
    currentBooking: activeBooking,
    serviceHistory: recentBookings,
    savedLocations: savedAddresses,
    bookingCount: user._count.bookings,
    openSupportTickets: supportTickets,
  };
}

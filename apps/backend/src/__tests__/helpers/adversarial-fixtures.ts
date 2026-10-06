import { BookingStatus, PaymentStatus, UserRole, type User } from "@prisma/client";
import { provenanceForNewUser } from "../../lib/data-provenance";
import { JWTService } from "../../services/jwt.service";
import { RefreshTokenService } from "../../services/refresh-token.service";
import { partnerPresenceService } from "../../services/partner-presence.service";
import { rbacService } from "../../services/rbac.service";
import prisma from "../../lib/prisma";
import { walletService } from "../../services/wallet.service";
import { walletCheckoutService } from "../../services/wallet-checkout.service";
import { LIVE_FIXTURE_SERVICE } from "./live-fixture-service";

const jwt = new JWTService();

export { prisma };

export type AdvCtx = {
  runId: string;
  serviceId: string;
  providerId: string;
  vendorUserId: string;
  customerA: User;
  customerB: User;
  addressAId: string;
  addressBId: string;
  legacyAdmin: User;
  supportAdmin: User;
  financeAdmin: User;
  superAdmin: User;
  paymentForRefundId: string;
  /** Presence session for the fixture partner — reuse via `heartbeatFresh(ctx)`. */
  presenceSessionId: string;
  presenceDeviceId: string;
};

/**
 * Deterministic Indian mobile per (run, slot), drawn from the FULL 64-bit hash.
 *
 * The previous version concatenated the hash's decimal digits with the run id's digits and kept the last
 * ten, so every phone in a run shared its last few digits and only ~10^6 values remained for the slot.
 * A 500-customer seeding then collided on `phone_hash` in roughly one run in five (the reverse-order
 * `release-blocker-elimination` failure). Now: a valid 6–9 prefix and 4×10^9 values per slot.
 */
export function fixturePhone(runId: string, slot: number | string): string {
  const h = BigInt(Bun.hash(`${runId}:${slot}`));
  return `+91${6_000_000_000n + (h % 4_000_000_000n)}`;
}

export async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    /**
     * 26 suites `return` silently when this is false, reporting green with zero assertions.
     * That is tolerable on a laptop with Postgres down; in CI (or wherever REQUIRE_TEST_DB is
     * set) an unreachable test database must fail the run, not pass it.
     */
    if (process.env.CI || process.env.REQUIRE_TEST_DB) {
      throw new Error(
        `Test database unreachable and REQUIRE_TEST_DB/CI is set: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    return false;
  }
}

async function hashPassword(plain: string) {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost: 10 });
}

export function bearer(user: Pick<User, "id" | "email">): string {
  return jwt.generateAccessToken({
    userId: user.id,
    email: user.email ?? `${user.id}@adv.test`,
  });
}

export async function seedAdversarialFixtures(runId: string): Promise<AdvCtx> {
  await rbacService.bootstrap();

  const passwordHash = await hashPassword("AdvTest@123");
  const tag = `adv-${runId}`;

  const service = await prisma.service.create({
    data: { ...LIVE_FIXTURE_SERVICE,
      name: `Adv Service ${tag}`,
      slug: `adv-service-${tag}`,
      description: "Adversarial integration fixture",
      category: "cleaning",
      basePrice: 500,
      estimatedDuration: 60,
      availableCities: ["Noida"],
      tags: ["adv"],
    },
  });

  const customerA = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-a@adv.test`),
      email: `${tag}-a@adv.test`,
      phoneNumber: fixturePhone(runId, "a"),
      firstName: "Adv",
      lastName: "UserA",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
    },
  });

  const customerB = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-b@adv.test`),
      email: `${tag}-b@adv.test`,
      phoneNumber: fixturePhone(runId, "b"),
      firstName: "Adv",
      lastName: "UserB",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
    },
  });

  const vendorUser = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-vendor@adv.test`),
      email: `${tag}-vendor@adv.test`,
      phoneNumber: fixturePhone(runId, "vendor"),
      firstName: "Adv",
      lastName: "Vendor",
      password: passwordHash,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: vendorUser.id,
      serviceCategories: [service.id],
      // No named regions: `serviceRegions: ["Noida"]` made every direct booking depend on which
      // SERVICE_ZONE geofences happen to exist in the test database (OUTSIDE_SERVICE_AREA).
      // A radius around a base point is self-contained.
      serviceRegions: [],
      serviceRadiusKm: 50,
      baseLatitude: 28.62,
      baseLongitude: 77.37,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      isVerified: true,
      isApproved: true,
      // `lifecycle_state` defaults to APPLIED, which left the fixture in a state the platform does
      // not produce: verified and approved, yet never activated. `readinessFor` correctly refuses to
      // put such a partner online, so the fixture — not the gate — was wrong.
      lifecycleState: "ACTIVE",
      isActive: true,
      isOnline: true,
      rating: 4.5,
    },
  });

  // Direct booking / matching fail closed without presence evidence. The fixture
  // partner is ACTIVE+AVAILABLE; seed a real heartbeat so booking tests exercise
  // capacity races, not STALE_PRESENCE.
  const presenceDeviceId = `fixture-${provider.id.slice(-8)}`;
  const presenceTokens = await new RefreshTokenService(prisma, jwt).createSessionTokens({
    userId: vendorUser.id,
    email: `${tag}-vendor@adv.test`,
    deviceId: presenceDeviceId,
  });
  await heartbeatFresh({
    providerId: provider.id,
    vendorUserId: vendorUser.id,
    presenceSessionId: presenceTokens.sessionId,
    presenceDeviceId,
  });

  const addressA = await prisma.address.create({
    data: {
      userId: customerA.id,
      label: "Home",
      addressLine1: "1 Adv Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 Adv Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });

  const addressB = await prisma.address.create({
    data: {
      userId: customerB.id,
      label: "Home",
      addressLine1: "2 Adv Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "2 Adv Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });

  const legacyAdmin = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-legacy-admin@adv.test`),
      email: `${tag}-legacy-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "legacy-admin"),
      firstName: "Legacy",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
    },
  });

  const supportRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "SUPPORT_ADMIN" } });
  const financeRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "FINANCE_ADMIN" } });
  const superRole = await prisma.adminRole.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });

  const supportAdmin = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-support-admin@adv.test`),
      email: `${tag}-support-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "support-admin"),
      firstName: "Support",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: supportRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const financeAdmin = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-finance-admin@adv.test`),
      email: `${tag}-finance-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "finance-admin"),
      firstName: "Finance",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: financeRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${tag}-super-admin@adv.test`),
      email: `${tag}-super-admin@adv.test`,
      phoneNumber: fixturePhone(runId, "super-admin"),
      firstName: "Super",
      lastName: "Admin",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
      adminProfile: {
        create: {
          roleId: superRole.id,
          grantedBy: "adv-test",
        },
      },
    },
  });

  const refundBooking = await prisma.booking.create({
    data: {
      bookingNumber: `ADV-${tag}-REF`,
      userId: customerA.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: addressA.id,
      status: BookingStatus.COMPLETED,
      // `booking_completed_requires_timestamp` refuses a COMPLETED booking with no completion time.
      // It was a hand-added CHECK on the live database only until 20260921140000 put it in the
      // migration history and the test-DB replay; `db-invariants.test.ts` asserts it is present.
      completedAt: new Date(),
      scheduledDate: new Date(Date.now() + 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
    },
  });

  const paymentForRefund = await prisma.payment.create({
    data: {
      bookingId: refundBooking.id,
      idempotencyKey: `booking_order:${refundBooking.id}`,
      userId: customerA.id,
      amount: 500,
      amountPaid: 500,
      paymentMethod: "razorpay",
      razorpayOrderId: `order_adv_${tag}`,
      razorpayPaymentId: `pay_adv_${tag}`,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });

  return {
    runId,
    serviceId: service.id,
    providerId: provider.id,
    vendorUserId: vendorUser.id,
    customerA,
    customerB,
    addressAId: addressA.id,
    addressBId: addressB.id,
    legacyAdmin,
    supportAdmin,
    financeAdmin,
    superAdmin,
    paymentForRefundId: paymentForRefund.id,
    presenceSessionId: presenceTokens.sessionId,
    presenceDeviceId,
  };
}

/**
 * Re-send a presence heartbeat for the fixture partner, reusing the fixture session/device and
 * continuing the per-provider location sequence.
 *
 * Presence is fresh for PRESENCE_FRESH_SEC (30 s) and location for 60 s. A suite that seeds
 * hundreds of customers (bcrypt + inserts through a 5-connection pool) before its concurrent
 * creates was measuring STALE_PRESENCE, not the capacity race it claimed — call this immediately
 * before the action under test. Idempotent: the sequence is read from the row, so it can never
 * regress (`Location sequence must increase`) however many suites share a provider.
 */
export async function heartbeatFresh(
  ctx: Pick<AdvCtx, "providerId" | "vendorUserId" | "presenceSessionId" | "presenceDeviceId">,
  location: { latitude: number; longitude: number } = { latitude: 28.62, longitude: 77.37 },
): Promise<void> {
  const current = await prisma.partnerPresence.findUnique({
    where: { providerId: ctx.providerId },
    select: { lastLocationSeq: true },
  });
  const sequence = (current?.lastLocationSeq ?? 0) + 1;
  await partnerPresenceService.heartbeat(
    { providerId: ctx.providerId, userId: ctx.vendorUserId },
    {
      sessionId: ctx.presenceSessionId,
      deviceId: ctx.presenceDeviceId,
      timestamp: new Date(),
      appState: "foreground",
      platform: "android",
      location: { ...location, accuracy: 12, capturedAt: new Date(), sequence },
    },
  );
}

/**
 * For long sequential setup loops: heartbeat only when the last beat is older than `maxAgeSec`,
 * as a real partner app does. Calling `heartbeatFresh` on every iteration instead trips the
 * product's heartbeat rate limit (PRESENCE_HEARTBEAT_RATE_LIMIT per 10 s) and fails the loop.
 */
export async function keepPresenceFresh(
  ctx: Pick<AdvCtx, "providerId" | "vendorUserId" | "presenceSessionId" | "presenceDeviceId">,
  maxAgeSec = 10,
): Promise<void> {
  const row = await prisma.partnerPresence.findUnique({
    where: { providerId: ctx.providerId },
    select: { lastHeartbeatAt: true },
  });
  const age = row?.lastHeartbeatAt ? (Date.now() - row.lastHeartbeatAt.getTime()) / 1000 : Infinity;
  if (age > maxAgeSec) await heartbeatFresh(ctx);
}

export async function deleteBookingsForUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  const bookings = await prisma.booking.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  if (bookingIds.length > 0) {
    await prisma.couponUsage.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.membershipCouponRedemption.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.membershipCashback.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.rating.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.tracking.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.assignmentJob.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.activityLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.supportTicket.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
}

/**
 * Remove the ledger journals the fixture's OWN money movements created, before the rows they
 * reference are deleted.
 *
 * Why (measured 2026-10-03 on a homigo_test rebuilt from migrations, then one full `bun run test`):
 * CUSTOMER_WALLET ledger ₹13,541.75 vs SUM(users.wallet_balance) ₹13,241.75, PROVIDER_PAYABLE
 * ₹4,820 vs ₹0, HCOIN_LIABILITY ₹5 vs −₹50 — 173 wallet journals whose wallet_transaction no longer
 * existed. The ledger is append-only and nothing links a journal to a user, so hard-deleting a
 * fixture user takes its wallet rows with it (CASCADE) and leaves every journal those rows produced
 * behind. Production never hard-deletes a wallet holder (account deletion is a soft delete, and the
 * 20260920090000 financial_history_delete_guard refuses ledger deletes on a non-test database), so
 * the invariant `ledger == SUM(balances)` the integrity detector enforces holds there and only the
 * test database drifted — deterministically, by the same ₹300 / ₹4,820 / ₹55 on every run.
 *
 * Every business journal carries `reference_id` (wallet txn, booking, payment, H-Coin txn,
 * withdrawal, incentive payout, referral, gift card), so the fixture can find exactly its own
 * journals and remove them with their lines and balance snapshots. `liability_reconciliation`
 * adjustments carry no reference and are untouched. This is fixture cleanup on a test database;
 * it is not a code path the application has.
 */
export async function purgeFixtureJournals(userIds: string[]): Promise<void> {
  const providers = await prisma.provider.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const providerIds = providers.map((p) => p.id);
  const [wallet, bookings, hcoin, giftCards, withdrawals, incentives, referralRewards] = await Promise.all([
    prisma.walletTransaction.findMany({ where: { userId: { in: userIds } }, select: { id: true } }),
    prisma.booking.findMany({
      where: { OR: [{ userId: { in: userIds } }, ...(providerIds.length ? [{ providerId: { in: providerIds } }] : [])] },
      select: { id: true },
    }),
    prisma.hCoinTransaction.findMany({ where: { userId: { in: userIds } }, select: { id: true } }),
    prisma.giftCard.findMany({
      where: { OR: [{ purchaserId: { in: userIds } }, { recipientId: { in: userIds } }] },
      select: { id: true },
    }),
    providerIds.length
      ? prisma.withdrawal.findMany({ where: { providerId: { in: providerIds } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    providerIds.length
      ? prisma.partnerIncentivePayout.findMany({ where: { providerId: { in: providerIds } }, select: { id: true } })
      : Promise.resolve([] as Array<{ id: string }>),
    providerIds.length
      ? prisma.partnerReferralReward.findMany({
          where: { referrerProviderId: { in: providerIds } },
          select: { referralId: true },
        })
      : Promise.resolve([] as Array<{ referralId: string }>),
  ]);
  const bookingIds = bookings.map((b) => b.id);
  const payments = bookingIds.length
    ? await prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } })
    : [];
  const refs = new Set<string>([
    ...wallet.map((w) => w.id),
    ...bookingIds,
    ...payments.map((p) => p.id),
    ...hcoin.map((h) => h.id),
    ...giftCards.map((g) => g.id),
    ...withdrawals.map((w) => w.id),
    ...incentives.map((i) => i.id),
    ...referralRewards.map((r) => r.referralId),
  ]);
  if (refs.size === 0) return;
  const journals = await prisma.journalEntry.findMany({
    where: { referenceId: { in: [...refs] } },
    select: { id: true },
  });
  const journalIds = journals.map((j) => j.id);
  if (journalIds.length === 0) return;
  // Snapshots are raw-SQL-only on some databases; best effort. Lines and entries stay strict.
  await prisma
    .$executeRaw`DELETE FROM ledger_balance_snapshots WHERE journal_id = ANY(${journalIds})`
    .catch(() => undefined);
  await prisma.ledgerEntry.deleteMany({ where: { journalId: { in: journalIds } } });
  await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
}

export async function cleanupAdversarialFixtures(runId: string): Promise<void> {
  const tag = `adv-${runId}`;
  /**
   * X-4 (2026-09-26): `email: { contains: tag }` matched NOTHING once the PII extension started
   * storing users.email as NULL (encrypted + hash columns), so this helper was a silent no-op and
   * every suite leaked its fixtures into homigo_test (measured: 34,663 NULL-email users). The hash
   * is deterministic and this helper is the same module that MINTS the addresses, so it derives the
   * exact hash set from its own list; the plaintext `contains` stays as a fallback for rows created
   * before encryption or with the extension off.
   */
  const { userPiiService } = await import("../../services/user-pii.service");
  const fixtureEmails = ["a", "b", "vendor", "legacy-admin", "support-admin", "finance-admin", "super-admin"].map(
    (who) => `${tag}-${who}@adv.test`,
  );
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: tag } },
        { emailHash: { in: fixtureEmails.map((e) => userPiiService.hashEmail(e)) } },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length === 0) return;

  await purgeFixtureJournals(userIds);
  await deleteBookingsForUsers(userIds);
  await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  // §11: a REWORK/REVISIT child references its parent with ON DELETE RESTRICT (silently deleting a
  // live follow-up along with its parent would be wrong in production), so children go first. The
  // column is raw-SQL only (not in the Prisma model), and pre-§11 databases don't have it.
  await prisma
    .$executeRaw`DELETE FROM bookings WHERE user_id = ANY(${userIds}) AND parent_booking_id IS NOT NULL`
    .catch(() => undefined);
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminUser.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.provider.deleteMany({ where: { userId: { in: userIds } } });
  /**
   * Everything that references users WITHOUT ON DELETE CASCADE (measured from pg_constraint on
   * 2026-09-26). While cleanup was the X-4 no-op these FKs were never exercised; the moment it
   * worked, any fixture flow that had credited H-Coins, used a coupon or persisted a match score
   * made the user delete fail P2003 and the whole suite report "(unnamed)" failures. Best-effort
   * per table (older test databases may predate some models); the user delete itself stays strict.
   */
  const userScoped: Array<{ table: string; cols: string[] }> = [
    { table: "hcoin_transactions", cols: ["user_id"] },
    { table: "hcoin_wallets", cols: ["user_id"] },
    { table: "activity_logs", cols: ["user_id"] },
    { table: "consent_records", cols: ["user_id"] },
    { table: "coupon_usages", cols: ["user_id"] },
    { table: "fraud_alerts", cols: ["user_id"] },
    { table: "fraud_signals", cols: ["user_id"] },
    { table: "gift_card_transactions", cols: ["user_id"] },
    { table: "gift_cards", cols: ["purchaser_id", "recipient_id"] },
    { table: "membership_benefit_usage", cols: ["user_id"] },
    { table: "membership_cashbacks", cols: ["user_id"] },
    { table: "membership_coupon_redemptions", cols: ["user_id"] },
    { table: "partner_leads", cols: ["user_id"] },
    { table: "provider_match_scores", cols: ["user_id"] },
    { table: "referral_commissions", cols: ["referrer_id"] },
    { table: "referral_transactions", cols: ["referrer_id", "referee_id"] },
    { table: "referral_withdrawals", cols: ["user_id"] },
    { table: "support_tickets", cols: ["user_id"] },
    { table: "user_subscriptions", cols: ["user_id"] },
    { table: "wallet_transfers", cols: ["sender_id", "recipient_id"] },
    { table: "compliance_request_audits", cols: ["actor_id"] },
  ];
  for (const { table, cols } of userScoped) {
    const predicate = cols.map((c) => `"${c}" = ANY($1)`).join(" OR ");
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${predicate}`, userIds).catch(() => undefined);
  }
  /**
   * A matching run a suite started can still be recording `provider_match_scores` (background record
   * write) after the purge above — the user delete then fails on that foreign key and the whole file
   * reports an unnamed failure. Clear the late rows and retry, bounded; any other error still throws.
   */
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      break;
    } catch (err) {
      const fk = (err as { code?: string; meta?: { constraint?: string } }).meta?.constraint ?? "";
      if (attempt >= 3 || (err as { code?: string }).code !== "P2003" || !fk.startsWith("provider_match_scores")) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      await prisma.$executeRawUnsafe(`DELETE FROM "provider_match_scores" WHERE "user_id" = ANY($1)`, userIds);
    }
  }
  /**
   * A suite may create bookings on the fixture service from users this helper does not own
   * (its own extra customers, admin-created rows). Those still reference the service, so the
   * service delete needs the same booking purge, service-scoped. Children (REWORK/REVISIT) first.
   */
  const services = await prisma.service.findMany({ where: { slug: { contains: tag } }, select: { id: true } });
  const serviceIds = services.map((s) => s.id);
  if (serviceIds.length > 0) {
    const rows = await prisma.booking.findMany({ where: { serviceId: { in: serviceIds } }, select: { id: true } });
    const ids = rows.map((b) => b.id);
    if (ids.length > 0) {
      await prisma.$executeRaw`DELETE FROM bookings WHERE service_id = ANY(${serviceIds}) AND parent_booking_id IS NOT NULL`.catch(() => undefined);
      await prisma.assignmentJob.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.activityLog.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.supportTicket.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.booking.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.service.deleteMany({ where: { slug: { contains: tag } } });
}

export function futureSlot(hoursAhead = 48): Date {
  const d = new Date(Date.now() + hoursAhead * 3_600_000);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * Settle a booking through the REAL wallet checkout: a ledger-consistent top-up of exactly its price
 * (a dev order, since NODE_ENV=test has no gateway keys) followed by `payBookingFromWallet`.
 *
 * This replaces fixtures that hand-set `paymentStatus: SUCCESS, paymentMethod: "wallet"` — a
 * "wallet-paid" booking with no wallet debit and no journal behind it, which production can never
 * produce and which once hid a refund path that paid ₹0. The checkout moves a booking that already has
 * a partner to ACCEPTED; the lifecycle status the test asked for is restored afterwards, which leaves
 * the money (wallet debit, journal, payment status) exactly as the real checkout wrote it.
 */
export async function payWithRealWallet(bookingId: string, userId: string): Promise<void> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { finalAmount: true, status: true } });
  const topUp = await walletService.addMoney(userId, booking.finalAmount);
  if ("error" in topUp) throw new Error(`fixture top-up failed: ${topUp.error}`);
  await walletService.verifyTopUp(userId, {
    razorpayOrderId: topUp.razorpayOrderId,
    razorpayPaymentId: `pay_fixture_${bookingId}`,
    razorpaySignature: "fixture",
  });
  const paid = await walletCheckoutService.payBookingFromWallet(userId, bookingId);
  if (!("ok" in paid)) throw new Error(`fixture wallet checkout failed: ${JSON.stringify(paid)}`);
  const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } });
  if (after.status !== booking.status) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: booking.status } });
  }
}

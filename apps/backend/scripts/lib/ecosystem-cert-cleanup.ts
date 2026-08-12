/**
 * FK-ordered, transactional teardown for ecosystem-enterprise-certification fixtures.
 * Idempotent: safe to run multiple times; zero deleted rows is OK.
 */
import type { PrismaClient } from "@prisma/client";
import {
  CLEANUP_DELETE_ORDER_AFTER,
  CLEANUP_DELETE_ORDER_BEFORE,
  renderFkGraphMermaid,
  USER_RESTRICT_EDGES,
} from "./ecosystem-cert-fk-graph";

export type EcoCertFixtures = {
  runId: string;
  serviceId: string;
  customerId: string;
  vendorUserId: string;
  providerId: string;
  addressId: string;
  bookingId?: string;
};

export type CleanupStep = {
  table: string;
  deleted: number;
};

export type CleanupResult = {
  ok: boolean;
  steps: CleanupStep[];
  remaining: Record<string, number>;
  error?: string;
  transactional: boolean;
};

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends" | "$use"
>;

async function wipe(table: string, op: () => Promise<{ count: number }>): Promise<CleanupStep> {
  const { count } = await op();
  console.log(`[cleanup] ${table}: deleted=${count}`);
  return { table, deleted: count };
}

async function deleteBookingSubtree(tx: Tx, bookingId: string, steps: CleanupStep[]) {
  const tracking = await tx.tracking.findUnique({ where: { bookingId }, select: { id: true } });
  if (tracking) {
    steps.push(
      await wipe("location_history", () =>
        tx.locationHistory.deleteMany({ where: { trackingId: tracking.id } }),
      ),
    );
  }

  steps.push(
    await wipe("membership_coupon_redemptions", () =>
      tx.membershipCouponRedemption.deleteMany({ where: { bookingId } }),
    ),
    await wipe("membership_cashbacks", () => tx.membershipCashback.deleteMany({ where: { bookingId } })),
    await wipe("coupon_usages", () => tx.couponUsage.deleteMany({ where: { bookingId } })),
    await wipe("ratings", () => tx.rating.deleteMany({ where: { bookingId } })),
    await wipe("fraud_alerts", () =>
      tx.fraudAlert.deleteMany({ where: { commission: { bookingId } } }),
    ),
    await wipe("referral_commissions", () => tx.referralCommission.deleteMany({ where: { bookingId } })),
    await wipe("assignment_audits", () =>
      tx.assignmentAudit.deleteMany({ where: { job: { bookingId } } }),
    ),
    await wipe("assignment_attempts", () =>
      tx.assignmentAttempt.deleteMany({ where: { job: { bookingId } } }),
    ),
    await wipe("assignment_jobs", () => tx.assignmentJob.deleteMany({ where: { bookingId } })),
    await wipe("activity_logs", () => tx.activityLog.deleteMany({ where: { bookingId } })),
    await wipe("support_tickets", () => tx.supportTicket.deleteMany({ where: { bookingId } })),
    await wipe("payment_settlements", () =>
      tx.paymentSettlement.deleteMany({ where: { payment: { bookingId } } }),
    ),
    await wipe("payments", () => tx.payment.deleteMany({ where: { bookingId } })),
    await wipe("earnings", () => tx.earning.deleteMany({ where: { bookingId } })),
    await wipe("notifications", () => tx.notification.deleteMany({ where: { bookingId } })),
    await wipe("provider_match_scores", () => tx.providerMatchScore.deleteMany({ where: { bookingId } })),
    await wipe("tracking", () => tx.tracking.deleteMany({ where: { bookingId } })),
    await wipe("bookings", () => tx.booking.deleteMany({ where: { id: bookingId } })),
  );
}

async function deleteProviderSubtree(tx: Tx, fx: EcoCertFixtures, steps: CleanupStep[]) {
  steps.push(
    await wipe("wallet_transactions", () =>
      tx.walletTransaction.deleteMany({
        where: { OR: [{ providerId: fx.providerId }, { userId: { in: [fx.customerId, fx.vendorUserId] } }] },
      }),
    ),
    await wipe("locations", () => tx.location.deleteMany({ where: { providerId: fx.providerId } })),
    await wipe("provider_match_scores", () =>
      tx.providerMatchScore.deleteMany({ where: { providerId: fx.providerId } }),
    ),
    await wipe("notifications", () => tx.notification.deleteMany({ where: { providerId: fx.providerId } })),
    await wipe("provider_wallet_reservations", () =>
      tx.providerWalletReservation.deleteMany({ where: { providerId: fx.providerId } }),
    ),
    await wipe("providers", () => tx.provider.deleteMany({ where: { id: fx.providerId } })),
  );
}

async function deleteUserSubtree(tx: Tx, userIds: string[], steps: CleanupStep[]) {
  const subscriptions = await tx.userSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const subscriptionIds = subscriptions.map((s) => s.id);
  if (subscriptionIds.length > 0) {
    steps.push(
      await wipe("subscription_invoices", () =>
        tx.subscriptionInvoice.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } }),
      ),
    );
  }

  steps.push(
    await wipe("hcoin_transactions", () => tx.hCoinTransaction.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("hcoin_wallets", () => tx.hCoinWallet.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("membership_benefit_usage", () =>
      tx.membershipBenefitUsage.deleteMany({ where: { userId: { in: userIds } } }),
    ),
    await wipe("membership_cashbacks", () => tx.membershipCashback.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("membership_coupon_redemptions", () =>
      tx.membershipCouponRedemption.deleteMany({ where: { userId: { in: userIds } } }),
    ),
    await wipe("provider_match_scores", () => tx.providerMatchScore.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("referral_commissions", () =>
      tx.referralCommission.deleteMany({
        where: { OR: [{ referrerId: { in: userIds } }, { refereeId: { in: userIds } }] },
      }),
    ),
    await wipe("fraud_alerts", () => tx.fraudAlert.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("referral_transactions", () =>
      tx.referralTransaction.deleteMany({
        where: { OR: [{ referrerId: { in: userIds } }, { refereeId: { in: userIds } }] },
      }),
    ),
    await wipe("referral_withdrawals", () =>
      tx.referralWithdrawal.deleteMany({ where: { userId: { in: userIds } } }),
    ),
    await wipe("user_subscriptions", () => tx.userSubscription.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("wallet_transfers", () =>
      tx.walletTransfer.deleteMany({
        where: { OR: [{ senderId: { in: userIds } }, { recipientId: { in: userIds } }] },
      }),
    ),
    await wipe("gift_card_transactions", () =>
      tx.giftCardTransaction.deleteMany({ where: { userId: { in: userIds } } }),
    ),
    await wipe("gift_cards", () =>
      tx.giftCard.deleteMany({
        where: { OR: [{ purchaserId: { in: userIds } }, { recipientId: { in: userIds } }] },
      }),
    ),
    await wipe("coupon_usages", () => tx.couponUsage.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("activity_logs", () => tx.activityLog.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("fraud_signals", () => tx.fraudSignal.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("notifications", () => tx.notification.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("payments", () => tx.payment.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("addresses", () => tx.address.deleteMany({ where: { userId: { in: userIds } } })),
    await wipe("users", () => tx.user.deleteMany({ where: { id: { in: userIds } } })),
  );
}

async function runCleanupTx(tx: Tx, fx: EcoCertFixtures): Promise<CleanupStep[]> {
  const userIds = [fx.customerId, fx.vendorUserId];
  const steps: CleanupStep[] = [];

  if (fx.bookingId) {
    await deleteBookingSubtree(tx, fx.bookingId, steps);
  }

  await deleteProviderSubtree(tx, fx, steps);
  await deleteUserSubtree(tx, userIds, steps);
  steps.push(await wipe("services", () => tx.service.deleteMany({ where: { id: fx.serviceId } })));

  return steps;
}

async function verifyNoFixtureRows(
  db: Tx,
  fx: EcoCertFixtures,
  userIds: string[],
): Promise<Record<string, number>> {
  const [
    users,
    providers,
    addresses,
    services,
    bookings,
    hcoinWallets,
    hcoinTxns,
    walletTxns,
    notifications,
  ] = await Promise.all([
    db.user.count({ where: { id: { in: userIds } } }),
    db.provider.count({ where: { id: fx.providerId } }),
    db.address.count({ where: { userId: { in: userIds } } }),
    db.service.count({ where: { id: fx.serviceId } }),
    fx.bookingId ? db.booking.count({ where: { id: fx.bookingId } }) : Promise.resolve(0),
    db.hCoinWallet.count({ where: { userId: { in: userIds } } }),
    db.hCoinTransaction.count({ where: { userId: { in: userIds } } }),
    db.walletTransaction.count({
      where: { OR: [{ userId: { in: userIds } }, { providerId: fx.providerId }] },
    }),
    db.notification.count({
      where: {
        OR: [{ userId: { in: userIds } }, { providerId: fx.providerId }, { bookingId: fx.bookingId ?? "__none__" }],
      },
    }),
  ]);

  return {
    users,
    providers,
    addresses,
    services,
    bookings,
    hcoin_wallets: hcoinWallets,
    hcoin_transactions: hcoinTxns,
    wallet_transactions: walletTxns,
    notifications,
  };
}

export async function cleanupEcoCertFixtures(db: PrismaClient, fx: EcoCertFixtures): Promise<CleanupResult> {
  const userIds = [fx.customerId, fx.vendorUserId];

  try {
    const { steps, remaining } = await db.$transaction(
      async (tx) => {
        const steps = await runCleanupTx(tx, fx);
        const remaining = await verifyNoFixtureRows(tx, fx, userIds);
        return { steps, remaining };
      },
      { timeout: 120_000 },
    );

    const leftover = Object.values(remaining).reduce((sum, n) => sum + n, 0);
    const ok = leftover === 0;
    if (!ok) {
      console.log(`[cleanup] VERIFY FAIL remaining=${JSON.stringify(remaining)}`);
    } else {
      console.log("[cleanup] VERIFY PASS all fixture rows removed");
    }
    return { ok, steps, remaining, transactional: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cleanup] FAIL ${message}`);
    return { ok: false, steps: [], remaining: {}, error: message, transactional: true };
  }
}

/** Idempotent second pass — no-op when fixtures already removed. */
export async function cleanupEcoCertFixturesIdempotent(
  db: PrismaClient,
  fx: EcoCertFixtures,
): Promise<CleanupResult> {
  return cleanupEcoCertFixtures(db, fx);
}

export function renderCleanupMarkdown(result: CleanupResult, fx: EcoCertFixtures, runId: string): string {
  const lines = [
    "# Ecosystem Cleanup Certification",
    "",
    `**Run ID:** ${runId}`,
    `**Certified at:** ${new Date().toISOString()}`,
    `**Verdict:** **${result.ok ? "PASS" : "FAIL"}**`,
    `**Transactional:** ${result.transactional ? "yes" : "no"}`,
    "",
    "## Exact failing relation (historical)",
    "",
    "`hcoin_wallets_user_id_fkey` — `hcoin_wallets.user_id` → `users.id` (NO onDelete CASCADE).",
    "",
    "Booking completion calls `hcoinService.earn()` which upserts `hcoin_wallets` for the customer.",
    "Deleting `users` before `hcoin_wallets` triggered the FK violation.",
    "",
    "## Cleanup order — before (broken)",
    "",
    "```",
    ...CLEANUP_DELETE_ORDER_BEFORE,
    "```",
    "",
    "## Cleanup order — after (fixed)",
    "",
    "```",
    ...CLEANUP_DELETE_ORDER_AFTER,
    "```",
    "",
    "## User FK dependency graph (Restrict relations)",
    "",
    "```mermaid",
    renderFkGraphMermaid(),
    "```",
    "",
    "| Child table | Parent | onDelete |",
    "|-------------|--------|----------|",
  ];

  for (const e of USER_RESTRICT_EDGES) {
    lines.push(`| ${e.child} | ${e.parent} | ${e.onDelete} |`);
  }

  lines.push(
    "",
    "## Fixture IDs",
    "",
    "| Entity | ID |",
    "|--------|-----|",
    `| customer | \`${fx.customerId}\` |`,
    `| vendor | \`${fx.vendorUserId}\` |`,
    `| provider | \`${fx.providerId}\` |`,
    `| address | \`${fx.addressId}\` |`,
    `| service | \`${fx.serviceId}\` |`,
    `| booking | \`${fx.bookingId ?? "none"}\` |`,
    "",
    "## Cleanup steps",
    "",
    "| Table | Deleted |",
    "|-------|---------|",
  );

  for (const s of result.steps) {
    lines.push(`| ${s.table} | ${s.deleted} |`);
  }

  lines.push(
    "",
    "## Post-cleanup verification",
    "",
    "| Table | Remaining |",
    "|-------|-----------|",
  );
  for (const [table, count] of Object.entries(result.remaining)) {
    lines.push(`| ${table} | ${count} |`);
  }

  if (result.error) {
    lines.push("", "## Error", "", "```", result.error, "```");
  }

  lines.push(
    "",
    "## Re-run",
    "",
    "```powershell",
    "cd apps/backend",
    "bun --env-file=.env run scripts/ecosystem-enterprise-certification.ts",
    "bun --env-file=.env run scripts/ecosystem-cleanup-probe.ts",
    "```",
    "",
  );

  return lines.join("\n");
}

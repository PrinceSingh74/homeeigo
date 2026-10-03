/**
 * Backfill missing earnings for COMPLETED bookings that pre-date the
 * transactional completion+earning fix in booking.service.ts.
 *
 *   bun --env-file=.env run scripts/recovery/backfill-missing-earnings.ts --dry-run
 *   bun --env-file=.env run scripts/recovery/backfill-missing-earnings.ts --apply
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { earningsService } from "../../src/services/earnings.service";
import { financialLedgerService } from "../../src/services/financial-ledger.service";
import { rupeesToPaise } from "../../src/lib/money-paise";
import { AuditLogService } from "../../src/services/audit-log.service";

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");

if (!dryRun && !apply) {
  console.error("Usage: --dry-run | --apply");
  process.exit(1);
}

type Candidate = {
  id: string;
  providerId: string;
  finalAmount: number;
  completedAt: Date | null;
  paymentStatus: string;
};

const candidates = await prisma.$queryRaw<Candidate[]>`
  SELECT b.id, b.provider_id AS "providerId", b.final_amount AS "finalAmount",
         b.completed_at AS "completedAt", b.payment_status AS "paymentStatus"
  FROM bookings b
  WHERE b.status = 'COMPLETED' AND b.provider_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM earnings e WHERE e.booking_id = b.id)
  ORDER BY b.completed_at ASC NULLS LAST
`;

const eligible: Candidate[] = [];
const ineligible: Array<{ id: string; reason: string }> = [];

for (const row of candidates) {
  if (row.paymentStatus !== "SUCCESS" && row.paymentStatus !== "PARTIALLY_REFUNDED") {
    ineligible.push({ id: row.id, reason: `paymentStatus=${row.paymentStatus}` });
    continue;
  }
  if (row.finalAmount <= 0) {
    ineligible.push({ id: row.id, reason: "finalAmount<=0" });
    continue;
  }
  eligible.push(row);
}

console.log(
  JSON.stringify(
    {
      mode: dryRun ? "dry-run" : "apply",
      total: candidates.length,
      eligible: eligible.length,
      ineligible,
      sampleEligible: eligible.slice(0, 5).map((r) => r.id),
    },
    null,
    2,
  ),
);

if (dryRun || eligible.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

let backfilled = 0;
let failed = 0;

for (const row of eligible) {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.earning.findUnique({ where: { bookingId: row.id } });
      if (existing) return;

      const breakdown = await earningsService.calculateBookingEarning(row.id, tx);
      await tx.provider.update({
        where: { id: row.providerId },
        data: {
          walletBalance: { increment: breakdown.netEarning },
          walletBalancePaise: { increment: rupeesToPaise(breakdown.netEarning) },
          totalEarnings: { increment: breakdown.netEarning },
          completedBookings: { increment: 1 },
        },
      });
      await tx.earning.create({
        data: {
          providerId: row.providerId,
          bookingId: row.id,
          grossAmount: breakdown.bookingAmount,
          commission: breakdown.commission,
          netEarning: breakdown.netEarning,
        },
      });
      await financialLedgerService.recordProviderEarningInTransaction(
        tx,
        row.id,
        breakdown.bookingAmount,
        breakdown.commission,
        breakdown.netEarning,
        breakdown.bonus,
        breakdown.deduction,
      );
    });
    backfilled += 1;
    void AuditLogService.success("EARNING_BACKFILL", {
      details: { bookingId: row.id, providerId: row.providerId },
    });
  } catch (e) {
    failed += 1;
    console.error("FAILED", row.id, e instanceof Error ? e.message : e);
  }
}

console.log(JSON.stringify({ backfilled, failed, remaining: eligible.length - backfilled - failed }, null, 2));
await prisma.$disconnect();

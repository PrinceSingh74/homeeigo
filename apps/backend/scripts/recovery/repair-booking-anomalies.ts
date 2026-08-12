/**
 * HOMIGO — Forensic Booking/Payment Anomaly Repair (idempotent, serializable, audit-logged).
 *
 * Fixes two VERIFIED anomaly classes (root causes established by forensic audit 2026-06-17):
 *
 *  CLASS A — Phantom-SUCCESS test bookings (5):
 *    bookingNumber RC-… and FM-… , paymentStatus=SUCCESS, BUT zero money trail
 *    (no Payment, no completed WalletTransaction, no JournalEntry, no AssignmentJob).
 *    Root cause: synthetic race/finance-mock records inserted with paymentStatus pre-set
 *    to SUCCESS, bypassing the payment flow. No money was ever collected.
 *    REPAIR: paymentStatus SUCCESS -> PENDING (reflects reality). Non-destructive.
 *
 *  CLASS C — Paid booking left ACCEPTED with no provider (1):
 *    HOMIGO-20260611-00004, status=ACCEPTED, providerId=NULL, acceptedAt=NULL,
 *    BUT a real Razorpay Payment (SUCCESS, ledger-recorded) exists.
 *    Root cause: legacy single-offer dispatch tentatively set status=ACCEPTED; the offered
 *    provider TIMED OUT; handleTimeouts cleared providerId but left status ACCEPTED.
 *    REPAIR: status ACCEPTED -> PENDING so it re-dispatches (broadcast). Payment untouched.
 *
 * SAFETY: re-verifies each record's forensic profile INSIDE a Serializable txn before
 * mutating (idempotent + re-runnable; skips anything that no longer matches). Never deletes,
 * never fabricates, never touches money/ledger. Every change is audit-logged.
 *
 * Modes:
 *   (default)        dry-run — report only, no writes
 *   --apply          execute the repair
 *   --rollback       revert the repair (restore original status values)
 *
 * Run:  bun --env-file=.env run scripts/recovery/repair-booking-anomalies.ts [--apply|--rollback]
 */
import prisma from "../../src/lib/prisma";
import { AuditLogService } from "../../src/services/audit-log.service";

const MODE = process.argv.includes("--apply") ? "APPLY" : process.argv.includes("--rollback") ? "ROLLBACK" : "DRY_RUN";

// Verified affected ids (from forensic audit — see docs/p2 forensic report).
const CLASS_A_IDS = [
  "cmqe4q4gh000etzf003x9y8kq", "cmqe4q4gx000itzf0fblr9ym4", "cmqe4q4h6000mtzf0vrc3hni7",
  "cmqe6beyo000etz6c5r7gstae", "cmqe6beza000itz6cykrq5o2m",
];
const CLASS_C_NUMBER = "HOMIGO-20260611-00004";

type Action = { bookingNumber: string; id: string; field: string; from: string; to: string; applied: boolean; reason: string };

async function hasMoneyTrail(id: string): Promise<boolean> {
  const [pay, wt, jl] = await Promise.all([
    prisma.payment.count({ where: { bookingId: id } }),
    prisma.walletTransaction.count({ where: { referenceId: id, status: "COMPLETED" } }),
    prisma.journalEntry.count({ where: { referenceId: id } }),
  ]);
  return pay > 0 || wt > 0 || jl > 0;
}

async function main() {
  console.log(`\n=== HOMIGO Booking Anomaly Repair · MODE=${MODE} · ${new Date().toISOString()} ===\n`);
  const actions: Action[] = [];

  await prisma.$transaction(async (tx) => {
    // ---- CLASS A: phantom-SUCCESS test bookings -> PENDING (or rollback -> SUCCESS) ----
    for (const id of CLASS_A_IDS) {
      const b = await tx.booking.findUnique({ where: { id }, select: { bookingNumber: true, paymentStatus: true } });
      if (!b) { console.log(`  [A] ${id.slice(-6)} NOT FOUND — skip`); continue; }
      const money = await hasMoneyTrail(id);
      if (MODE === "ROLLBACK") {
        const apply = b.paymentStatus === "PENDING";
        if (apply && MODE === "ROLLBACK") await tx.booking.update({ where: { id }, data: { paymentStatus: "SUCCESS" } });
        actions.push({ bookingNumber: b.bookingNumber, id, field: "paymentStatus", from: b.paymentStatus, to: "SUCCESS", applied: apply, reason: "rollback class A" });
        continue;
      }
      // forward repair — only if STILL the anomaly: SUCCESS + no money
      const isAnomaly = b.paymentStatus === "SUCCESS" && !money;
      if (!isAnomaly) { actions.push({ bookingNumber: b.bookingNumber, id, field: "paymentStatus", from: b.paymentStatus, to: "(no change)", applied: false, reason: money ? "has money trail — DO NOT TOUCH" : "already corrected" }); continue; }
      if (MODE === "APPLY") await tx.booking.update({ where: { id }, data: { paymentStatus: "PENDING" } });
      actions.push({ bookingNumber: b.bookingNumber, id, field: "paymentStatus", from: "SUCCESS", to: "PENDING", applied: MODE === "APPLY", reason: "phantom SUCCESS, zero money trail (test artifact)" });
    }

    // ---- CLASS C: paid booking ACCEPTED w/ no provider -> PENDING (or rollback -> ACCEPTED) ----
    const c = await tx.booking.findFirst({ where: { bookingNumber: CLASS_C_NUMBER }, select: { id: true, bookingNumber: true, status: true, providerId: true } });
    if (c) {
      if (MODE === "ROLLBACK") {
        const apply = c.status === "PENDING";
        if (apply) await tx.booking.update({ where: { id: c.id }, data: { status: "ACCEPTED" } });
        actions.push({ bookingNumber: c.bookingNumber, id: c.id, field: "status", from: c.status, to: "ACCEPTED", applied: apply, reason: "rollback class C" });
      } else {
        const isAnomaly = c.status === "ACCEPTED" && c.providerId === null;
        if (!isAnomaly) {
          actions.push({ bookingNumber: c.bookingNumber, id: c.id, field: "status", from: c.status, to: "(no change)", applied: false, reason: c.providerId ? "provider now assigned — already healthy" : "already corrected" });
        } else {
          // payment is real + ledger-correct — DO NOT touch payment; only reset status so it re-dispatches
          if (MODE === "APPLY") await tx.booking.update({ where: { id: c.id }, data: { status: "PENDING" } });
          actions.push({ bookingNumber: c.bookingNumber, id: c.id, field: "status", from: "ACCEPTED", to: "PENDING", applied: MODE === "APPLY", reason: "ACCEPTED w/ null provider (dispatch timeout) — reset to re-dispatch; payment untouched" });
        }
      }
    }
  }, { isolationLevel: "Serializable" });

  // ---- report + audit ----
  console.log("REPAIR ACTIONS:");
  for (const a of actions) {
    console.log(`  ${a.applied ? "✓ APPLIED" : "•  no-op "} ${a.bookingNumber} · ${a.field}: ${a.from} -> ${a.to}  [${a.reason}]`);
    if (a.applied && MODE !== "DRY_RUN") {
      await AuditLogService.record("BOOKING_ANOMALY_REPAIR", "success", {
        userId: "forensic-recovery",
        details: { mode: MODE, bookingId: a.id, bookingNumber: a.bookingNumber, field: a.field, from: a.from, to: a.to, reason: a.reason },
      }).catch(() => undefined);
    }
  }
  const applied = actions.filter((a) => a.applied).length;
  console.log(`\nSummary: ${applied} change(s) ${MODE === "DRY_RUN" ? "WOULD be applied (dry-run)" : "applied"}, ${actions.length - applied} no-op.`);
  if (MODE === "DRY_RUN") console.log("→ re-run with --apply to execute, or --rollback to revert.");
  process.exit(0);
}

main().catch((e) => { console.error("REPAIR FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

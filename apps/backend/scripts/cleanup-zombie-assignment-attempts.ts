import "../src/load-env";
import prisma from "../src/lib/prisma";

/**
 * One-time correction for the onBookingCancelled findFirst-instead-of-updateMany bug (fixed in
 * assignment-engine.service.ts, 2026-08-24). Every SENT AssignmentAttempt whose underlying booking
 * has already reached a terminal state (cancelled/rejected/completed) is stale by definition — the
 * booking is resolved, so no provider can meaningfully accept it anymore. Marking these TIMEOUT is
 * exactly the terminal state the fixed code path would already have applied; nothing is deleted,
 * only a status field corrected. Zero effect on any still-live PENDING/ACCEPTED booking.
 */
async function main() {
  const now = new Date();

  const before = await prisma.assignmentAttempt.count({
    where: {
      status: "SENT",
      job: { booking: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "COMPLETED"] } } },
    },
  });
  console.log("Zombie SENT attempts before cleanup:", before);

  const result = await prisma.assignmentAttempt.updateMany({
    where: {
      status: "SENT",
      job: { booking: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "COMPLETED"] } } },
    },
    data: { status: "TIMEOUT", respondedAt: now },
  });
  console.log("Rows updated:", result.count);

  const after = await prisma.assignmentAttempt.count({
    where: {
      status: "SENT",
      job: { booking: { status: { in: ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "COMPLETED"] } } },
    },
  });
  console.log("Zombie SENT attempts after cleanup:", after);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

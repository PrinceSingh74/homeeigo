import "../src/load-env";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";

async function snapshot(label: string) {
  const [pendingBookings, exhaustedJobs, dispatchedJobs, zeroAttemptPending] = await Promise.all([
    prisma.booking.count({ where: { status: "PENDING", providerId: null } }),
    prisma.assignmentJob.count({ where: { status: "EXHAUSTED" } }),
    prisma.assignmentJob.count({ where: { status: "DISPATCHED" } }),
    prisma.assignmentJob.count({ where: { status: "PENDING", dispatchAttempts: 0 } }),
  ]);
  console.log(`\n[${label}] pending bookings=${pendingBookings} exhausted jobs=${exhaustedJobs} dispatched jobs=${dispatchedJobs} zero-attempt-pending jobs=${zeroAttemptPending}`);
  return { pendingBookings, exhaustedJobs, dispatchedJobs, zeroAttemptPending };
}

async function main() {
  console.log("=== VERIFYING ASSIGNMENT ENGINE FIX AGAINST REAL STUCK QUEUE ===");
  console.log("Time:", new Date().toISOString());

  const before = await snapshot("BEFORE");

  // Show the actual front of the queue before we touch anything.
  const oldest = await prisma.assignmentJob.findMany({
    where: { status: { in: ["PENDING", "REASSIGNED", "TIMEOUT"] } },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true, bookingId: true, status: true, dispatchAttempts: true, maxAttempts: true, createdAt: true },
  });
  console.log("\nOldest 5 jobs in queue BEFORE:");
  for (const j of oldest) console.log(`  ${j.id} booking=${j.bookingId} status=${j.status} attempts=${j.dispatchAttempts}/${j.maxAttempts} created=${j.createdAt.toISOString()}`);

  // Run the real processQueue() function directly — the exact code the cron calls, with the fix applied.
  console.log("\n--- Running processQueue() ---");
  const result1 = await assignmentEngine.processQueue();
  console.log("Tick 1 result:", JSON.stringify(result1));

  const mid = await snapshot("AFTER TICK 1");

  const oldestAfter = await prisma.assignmentJob.findMany({
    where: { id: { in: oldest.map((o) => o.id) } },
    select: { id: true, bookingId: true, status: true, dispatchAttempts: true, maxAttempts: true },
  });
  console.log("\nSame 5 jobs AFTER tick 1:");
  for (const j of oldestAfter) console.log(`  ${j.id} booking=${j.bookingId} status=${j.status} attempts=${j.dispatchAttempts}/${j.maxAttempts}`);

  console.log("\n=== VERIFICATION COMPLETE ===");
  console.log("dispatchAttempts now incrementing on NO_PROVIDER:", oldestAfter.some((j, i) => j.dispatchAttempts > oldest[i].dispatchAttempts) ? "CONFIRMED" : "NOT OBSERVED THIS TICK (check reasons)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

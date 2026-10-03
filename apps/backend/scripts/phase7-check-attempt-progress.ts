import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const front = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      providerId: null,
      assignmentJob: { isNot: { status: "EXHAUSTED" } },
    },
    orderBy: [{ priorityScore: "desc" }, { queuePriority: "asc" }, { queuedAt: "asc" }],
    take: 12,
    select: {
      id: true, bookingNumber: true, priorityScore: true, queuePriority: true, queuedAt: true,
      assignmentJob: { select: { status: true, dispatchAttempts: true, maxAttempts: true } },
    },
  });
  console.log("Current front of live (non-exhausted) queue:");
  for (const b of front) {
    console.log(`  ${b.bookingNumber} score=${b.priorityScore} prio=${b.queuePriority} queuedAt=${b.queuedAt?.toISOString()} job=${b.assignmentJob?.status} attempts=${b.assignmentJob?.dispatchAttempts}/${b.assignmentJob?.maxAttempts}`);
  }

  const exhaustedNow = await prisma.assignmentJob.count({ where: { status: "EXHAUSTED" } });
  console.log("\nTotal EXHAUSTED jobs now:", exhaustedNow, "(was 16 before any fix — increase confirms the mechanism is real)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

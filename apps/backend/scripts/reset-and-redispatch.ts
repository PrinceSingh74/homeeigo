import "../src/load-env";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";

const BOOKING_ID = "cmt72e41w008mtzc0vi9w4je1";

async function main() {
  const job = await prisma.assignmentJob.findUnique({ where: { bookingId: BOOKING_ID } });
  if (!job) throw new Error("no job");

  console.log("Resetting exhausted job for a genuine retry (admin correction, minimal, scoped)...");
  await prisma.assignmentJob.update({
    where: { id: job.id },
    data: { status: "PENDING", dispatchAttempts: 0 },
  });
  await prisma.assignmentAudit.create({
    data: { jobId: job.id, action: "ADMIN_RESET", details: JSON.stringify({ reason: "capacity bug fixed, verifying real dispatch reaches nearby real provider" }) },
  });

  const sent = await assignmentEngine.dispatchBookingNow(BOOKING_ID);
  console.log("dispatchBookingNow result:", sent);

  const after = await prisma.assignmentJob.findUnique({
    where: { bookingId: BOOKING_ID },
    include: { attempts: { orderBy: { dispatchedAt: "desc" }, take: 5 } },
  });
  console.log("\nAssignmentJob after re-dispatch:");
  console.log(JSON.stringify(after, null, 2));

  if (after) {
    const providerIds = after.attempts.filter((a) => a.status === "SENT").map((a) => a.providerId);
    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, user: { select: { email: true, firstName: true } } },
    });
    console.log("\nCurrently offered to:", JSON.stringify(providers, null, 2));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

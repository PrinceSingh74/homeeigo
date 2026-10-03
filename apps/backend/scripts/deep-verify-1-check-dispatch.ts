import "../src/load-env";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";

const BOOKING_ID = "cmt720w6a0002tz6c5bufo43h";

async function main() {
  // Give the inline dispatch a moment, then force a queue tick to be certain (safe, idempotent, real code).
  await new Promise((r) => setTimeout(r, 2000));
  await assignmentEngine.processQueue().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 500));

  const job = await prisma.assignmentJob.findUnique({
    where: { bookingId: BOOKING_ID },
    include: { attempts: true },
  });
  console.log("AssignmentJob:", JSON.stringify(job, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

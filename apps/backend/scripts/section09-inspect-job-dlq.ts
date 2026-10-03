/**
 * Inspect historical DLQ workflow instances. Read-only.
 */
import prisma from "../src/lib/prisma";

async function main() {
  const instanceIds = ["p6dw_21ae468f", "payment_recovery", "checkout_recovery"];
  const dlq = await prisma.eventDeadLetter.findMany({
    where: { consumerName: "scheduled.job.runner" },
  });
  const payloads = dlq.map((d) => (d.payload as { instanceId?: string }).instanceId).filter(Boolean) as string[];
  console.log("dlq instanceIds", payloads);

  const instances = payloads.length
    ? await prisma.workflowInstance.findMany({
        where: { id: { in: payloads } },
        select: {
          id: true,
          workflowId: true,
          workflowVersion: true,
          status: true,
          executionMode: true,
          createdAt: true,
          completedAt: true,
          failureReason: true,
        },
      })
    : [];
  console.log("instances", instances);

  const defs = await prisma.workflowDefinition.findMany({
    where: { workflowId: { in: ["payment_recovery", "checkout_recovery", "p6dw_21ae468f"] } },
    select: { workflowId: true, version: true, status: true, executionMode: true, certificationStatus: true },
  });
  console.log("definitions", defs);

  const jobs = await prisma.scheduledJob.findMany({
    where: { id: { in: dlq.map((d) => d.eventId) } },
    select: { id: true, jobType: true, status: true, attempts: true, lastError: true, createdAt: true, completedAt: true },
  });
  console.log("scheduledJobs", jobs);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const instances = await prisma.workflowInstance.findMany({
    where: { workflowId: { in: ["review_request", "follow_up", "payment_recovery", "checkout_recovery"] } },
    select: {
      id: true, workflowId: true, workflowVersion: true, subjectType: true, subjectId: true,
      status: true, stepIndex: true, triggerEventId: true, createdAt: true, updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("=== Recent workflow instances (review_request/follow_up/payment_recovery/checkout_recovery) ===");
  console.log(JSON.stringify(instances, null, 2));

  if (instances.length > 0) {
    const sample = instances[0];
    const steps = await prisma.workflowStepRun.findMany({
      where: { instanceId: sample.id },
      orderBy: { createdAt: "asc" },
    });
    console.log(`\n=== Step runs for instance ${sample.id} (${sample.workflowId}) ===`);
    console.log(JSON.stringify(steps, null, 2));
  }

  const evidence = await prisma.automationShadowExecution.findMany({
    where: { workflowId: { in: ["review_request", "follow_up"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("\n=== Recent AutomationShadowExecution rows ===");
  console.log(JSON.stringify(evidence, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

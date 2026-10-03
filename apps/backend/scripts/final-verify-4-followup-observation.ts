import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== STEP 4: FOLLOW_UP REAL SHADOW OBSERVATION CHECK ===");
  console.log("Time:", new Date().toISOString());

  const instances = await prisma.workflowInstance.findMany({
    where: { workflowId: "follow_up" },
    select: { id: true, status: true, stepIndex: true, subjectId: true, triggerEventId: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\nfollow_up WorkflowInstance count: ${instances.length}`);
  for (const i of instances) {
    console.log(`  ${i.id} booking=${i.subjectId} status=${i.status} step=${i.stepIndex} trigger=${i.triggerEventId} created=${i.createdAt.toISOString()}`);
  }

  if (instances.length === 0) {
    console.log("\nSTATUS: WAITING_FOR_REAL_BOOKING_EVENT");
    console.log("No real booking.completed event has fired since the trigger-registry fix. This is a genuine,");
    console.log("time-bound blocker, not something that can be forced. The trigger IS now correctly wired");
    console.log("(verified in STEP 1) — the moment a real booking completes, an instance will appear here.");
  } else {
    for (const i of instances) {
      const evidence = await prisma.automationShadowExecution.findMany({
        where: { workflowInstanceId: i.id },
      });
      console.log(`\nEvidence for instance ${i.id}:`, JSON.stringify(evidence, null, 2));
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

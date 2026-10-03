import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const audit = await prisma.activityLog.findFirst({
    where: { action: "AUTOMATION_CERTIFICATION_APPROVED", description: { contains: "vision_intelligence" } },
    orderBy: { createdAt: "desc" },
  });
  if (!audit) {
    console.log("NO AUDIT ROW FOUND — integrity concern");
    process.exit(1);
  }
  console.log("Audit row found:");
  console.log("  createdAt:", audit.createdAt.toISOString());
  console.log("  userId:", audit.userId);
  console.log("  description:", audit.description);

  const cert = await prisma.automationCertification.findUnique({
    where: { automationId_workflowVersion: { automationId: "vision_intelligence", workflowVersion: 1 } },
    select: { certifiedAt: true },
  });
  console.log("\nCertification createdAt:", cert!.certifiedAt.toISOString());
  console.log("Audit came before or same instant as certification:", audit.createdAt.getTime() <= cert!.certifiedAt.getTime());

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const certs = await prisma.automationCertification.findMany({
    where: { OR: [{ automationId: { contains: "recommend" } }, { automationId: { contains: "rules" } }] },
    select: { automationId: true, workflowVersion: true, approvedExecutionMode: true, voidedAt: true, certifiedAt: true },
  });
  console.log("Recommendation-related certifications:", JSON.stringify(certs, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

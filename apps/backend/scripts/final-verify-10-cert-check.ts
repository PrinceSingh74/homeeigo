import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const visionCert = await prisma.automationCertification.findMany({
    where: { automationId: { contains: "vision" } },
  });
  console.log("Vision-related certifications:", JSON.stringify(visionCert, null, 2));

  const followUpCert = await prisma.automationCertification.findFirst({
    where: { automationId: "follow_up" },
  });
  console.log("\nfollow_up certification:", followUpCert ? JSON.stringify(followUpCert) : "NONE (correct — no real observation yet)");

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const audit = await prisma.activityLog.findMany({
    where: {
      action: "AUTOMATION_CERTIFICATION_APPROVED",
      OR: [{ description: { contains: "rebooking" } }, { description: { contains: "satisfaction_intelligence" } }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("Audit entries for rebooking/satisfaction_intelligence certification:");
  for (const a of audit) console.log(` ${a.createdAt.toISOString()} [user:${a.userId}]\n   ${a.description}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

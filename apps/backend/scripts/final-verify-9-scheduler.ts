import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const recentAudits = await prisma.assignmentAudit.findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { action: true, createdAt: true },
  });
  console.log("Most recent AssignmentAudit rows (proves the 30s cron is genuinely ticking on the live server):");
  for (const a of recentAudits) {
    const ageSec = (Date.now() - a.createdAt.getTime()) / 1000;
    console.log(`  ${a.createdAt.toISOString()} [${a.action}] (${ageSec.toFixed(1)}s ago)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

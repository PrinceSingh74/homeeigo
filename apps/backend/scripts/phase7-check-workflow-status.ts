import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const rows = await prisma.workflowDefinition.findMany({
    select: { workflowId: true, version: true, status: true, activatedAt: true },
    orderBy: [{ workflowId: "asc" }, { version: "asc" }],
  });
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Find an ActivityLog row whose description contains the marker.
 * Usage: bun --env-file=.env run scripts/e2e-find-activity-log.ts <marker>
 * Prints JSON: { found: boolean, id?: string, action?: string }
 */
import prisma from "../src/lib/prisma";

const marker = process.argv[2];
if (!marker) {
  console.error("usage: e2e-find-activity-log.ts <marker>");
  process.exit(2);
}

async function main() {
  const hit = await prisma.activityLog.findFirst({
    where: { description: { contains: marker } },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, description: true, createdAt: true },
  });
  console.log(
    JSON.stringify(
      hit
        ? { found: true, id: hit.id, action: hit.action, createdAt: hit.createdAt.toISOString() }
        : { found: false },
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

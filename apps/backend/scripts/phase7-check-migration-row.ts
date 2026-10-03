import "../src/load-env";
import prisma from "../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
     FROM _prisma_migrations WHERE migration_name = '20260824120000_vision_pipeline'`,
  );
  console.log(JSON.stringify(rows, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const tableExists = await prisma.$queryRawUnsafe<any[]>(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema='public' AND table_name='vision_images') as exists`,
  );
  console.log("\nvision_images table exists:", tableExists);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});

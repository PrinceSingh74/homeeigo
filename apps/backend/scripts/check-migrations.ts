import prisma from "../src/lib/prisma";

const rows = await prisma.$queryRaw<
  Array<{
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
    started_at: Date;
    logs: string | null;
  }>
>`
  SELECT migration_name, finished_at, rolled_back_at, started_at, logs
  FROM _prisma_migrations
  ORDER BY started_at
`;

for (const r of rows) {
  console.log(
    `${r.migration_name} | finished=${r.finished_at ?? "NULL"} | rolled_back=${r.rolled_back_at ?? "NULL"} | logs=${r.logs?.slice(0, 120) ?? ""}`,
  );
}

const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
  SELECT typname FROM pg_type WHERE typname IN ('QueuePriority', 'CashbackStatus', 'CampaignType')
`;
console.log("\nExisting enums:", enums.map((e) => e.typname).join(", ") || "none");

const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('membership_cashbacks', 'campaigns', 'coupon_usages')
`;
console.log("Existing tables:", tables.map((t) => t.tablename).join(", ") || "none");

const bookingCols = await prisma.$queryRaw<Array<{ column_name: string }>>`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'bookings' AND column_name IN ('queue_priority','campaign_id','premium_matched')
`;
console.log("Booking cols:", bookingCols.map((c) => c.column_name).join(", ") || "none");

await prisma.$disconnect();

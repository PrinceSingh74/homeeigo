#!/bin/sh
set -eu
cd /app
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const tables = ['event_outbox','event_dead_letters','event_consumer_receipts','scheduled_jobs'];
(async () => {
  const rows = await p.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename",
    tables
  );
  console.log('PHASE0_EVENT_TABLES', JSON.stringify(rows));
  const mig = await p.$queryRawUnsafe(
    "SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations WHERE migration_name = '20260731120000_event_foundation'"
  );
  console.log('EVENT_FOUNDATION_MIGRATION', JSON.stringify(mig));
  const count = await p.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS applied FROM _prisma_migrations WHERE finished_at IS NOT NULL"
  );
  console.log('APPLIED_MIGRATION_COUNT', JSON.stringify(count));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
NODE

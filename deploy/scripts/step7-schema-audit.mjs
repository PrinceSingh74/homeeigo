#!/usr/bin/env node
/** Read-only Phase-0 physical schema audit — Step 7. Outputs JSON, no row data. */
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const p = new PrismaClient();
const PHASE0_TABLES = ['event_outbox','event_consumer_receipts','event_dead_letters','scheduled_jobs'];
const BOOKING_FIELDS = ['en_route_at','arrived_at','travel_duration_min'];

async function q(sql, ...params) { return p.$queryRawUnsafe(sql, ...params); }

(async () => {
  const report = { auditedAt: new Date().toISOString(), tables: {}, bookingFields: {}, migrations: [], migrationSummary: {}, enums: {}, indexes: [], constraints: { primary: [], unique: [], foreign: [] }, fingerprint: null };
  const migRows = await q(`SELECT migration_name, finished_at, rolled_back_at, started_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name`);
  report.migrations = migRows.map(r => ({ name: r.migration_name, finishedAt: r.finished_at, rolledBackAt: r.rolled_back_at, startedAt: r.started_at, steps: Number(r.applied_steps_count ?? 0) }));
  report.migrationSummary = {
    total: report.migrations.length,
    applied: report.migrations.filter(m => m.finishedAt && !m.rolledBackAt).length,
    failed: report.migrations.filter(m => !m.finishedAt).length,
    rolledBack: report.migrations.filter(m => m.rolledBackAt).length,
    eventFoundation: report.migrations.some(m => m.migration_name === '20260731120000_event_foundation' && m.finishedAt),
  };
  for (const table of PHASE0_TABLES) {
    const exists = await q(`SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, table);
    const columns = await q(`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, table);
    report.tables[table] = { exists: exists[0].c === 1, columns: columns.map(c => ({ name: c.column_name, dataType: c.data_type, udtName: c.udt_name, nullable: c.is_nullable === 'YES', default: c.column_default })) };
  }
  for (const field of BOOKING_FIELDS) {
    const rows = await q(`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name=$1`, field);
    report.bookingFields[field] = rows[0] ? { exists: true, dataType: rows[0].data_type, udtName: rows[0].udt_name, nullable: rows[0].is_nullable === 'YES', default: rows[0].column_default } : { exists: false };
  }
  const enumRows = await q(`SELECT e.enumlabel AS enum_value, e.enumsortorder FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='EventOutboxStatus' ORDER BY e.enumsortorder`);
  report.enums.EventOutboxStatus = enumRows.map(r => r.enum_value);
  report.indexes = await q(`SELECT pi.indexname, pi.tablename, pi.indexdef, idx.indisvalid AS is_valid, idx.indisready AS is_ready, idx.indisunique AS is_unique FROM pg_indexes pi JOIN pg_class c ON c.relname=pi.indexname JOIN pg_index idx ON idx.indexrelid=c.oid WHERE pi.schemaname='public' AND pi.tablename = ANY($1::text[]) ORDER BY pi.tablename, pi.indexname`, PHASE0_TABLES);
  report.constraints.primary = await q(`SELECT tc.table_name, tc.constraint_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' AND tc.table_name = ANY($1::text[]) ORDER BY tc.table_name, kcu.ordinal_position`, PHASE0_TABLES);
  report.constraints.unique = await q(`SELECT tc.table_name, tc.constraint_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema WHERE tc.table_schema='public' AND tc.constraint_type='UNIQUE' AND tc.table_name = ANY($1::text[]) ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`, PHASE0_TABLES);
  report.constraints.foreign = await q(`SELECT tc.constraint_name, tc.table_name AS source_table, kcu.column_name AS source_column, ccu.table_name AS target_table, ccu.column_name AS target_column, rc.update_rule, rc.delete_rule FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.table_schema WHERE tc.table_schema='public' AND tc.constraint_type='FOREIGN KEY' AND tc.table_name = ANY($1::text[]) ORDER BY tc.table_name, tc.constraint_name`, PHASE0_TABLES);
  const fpRows = await q(`SELECT md5(string_agg(line, E'\\n' ORDER BY line)) AS fingerprint FROM ( SELECT table_name||'|'||column_name||'|'||data_type||'|'||is_nullable||'|'||COALESCE(column_default,'') AS line FROM information_schema.columns WHERE table_schema='public' AND table_name = ANY($1::text[]) UNION ALL SELECT 'bookings|'||column_name||'|'||data_type||'|'||is_nullable||'|'||COALESCE(column_default,'') FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name = ANY($2::text[]) UNION ALL SELECT 'idx|'||indexname||'|'||indexdef FROM pg_indexes WHERE schemaname='public' AND tablename = ANY($1::text[]) ) s`, PHASE0_TABLES, BOOKING_FIELDS);
  report.fingerprint = fpRows[0]?.fingerprint ?? null;
  console.log(JSON.stringify(report));
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });

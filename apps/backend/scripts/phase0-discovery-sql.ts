/**
 * Phase 0 discovery — live PostgreSQL introspection.
 * Run: bun run scripts/phase0-discovery-sql.ts
 */
import "../src/load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const tables = await prisma.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;

  const floatCols = await prisma.$queryRaw<
    { table_name: string; column_name: string; data_type: string }[]
  >`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('real', 'double precision')
    ORDER BY table_name, column_name
  `;

  const piiCols = await prisma.$queryRaw<
    { table_name: string; column_name: string; data_type: string }[]
  >`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        column_name ILIKE '%email%'
        OR column_name ILIKE '%phone%'
        OR column_name ILIKE '%address%'
        OR column_name ILIKE '%aadhaar%'
        OR column_name ILIKE '%aadhar%'
        OR column_name ILIKE '%pan%'
        OR column_name ILIKE '%kyc%'
        OR column_name ILIKE '%bank%'
        OR column_name ILIKE '%card%'
        OR column_name ILIKE '%ip_address%'
        OR column_name ILIKE '%device_id%'
      )
    ORDER BY table_name, column_name
  `;

  const paiseCols = await prisma.$queryRaw<
    { table_name: string; column_name: string; data_type: string }[]
  >`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name ILIKE '%paise%'
    ORDER BY table_name, column_name
  `;

  const tableSizes = await prisma.$queryRaw<
    { tablename: string; size: string; row_estimate: bigint }[]
  >`
    SELECT
      relname AS tablename,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
      c.reltuples::bigint AS row_estimate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT 25
  `;

  const fkCount = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'
  `;

  const indexCount = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM pg_indexes WHERE schemaname = 'public'
  `;

  const exclusionConstraints = await prisma.$queryRaw<
    { conname: string; conrelid: string }[]
  >`
    SELECT conname, conrelid::regclass::text AS conrelid
    FROM pg_constraint
    WHERE contype = 'x' AND connamespace = 'public'::regnamespace
  `;

  const plaintextEmail = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM users
    WHERE email IS NOT NULL AND email != '' AND (email_encrypted IS NULL OR email_encrypted = '')
  `;

  const encryptedEmail = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM users WHERE email_encrypted IS NOT NULL AND email_encrypted != ''
  `;

  const plaintextPhone = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM users
    WHERE phone_number IS NOT NULL AND phone_number != '' AND (phone_encrypted IS NULL OR phone_encrypted = '')
  `;

  const moneyDrift = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*)::bigint AS cnt FROM users
    WHERE wallet_balance IS NOT NULL
      AND wallet_balance_paise IS NOT NULL
      AND ABS(wallet_balance - (wallet_balance_paise::numeric / 100)) > 0.01
  `;

  const expectedFromPrisma = new Set(
    (await import("node:fs")).readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    )
      .match(/@@map\("([^"]+)"\)/g)
      ?.map((m) => m.replace(/@@map\("|"\)/g, "")) ?? [],
  );

  const liveSet = new Set(tables.map((t) => t.tablename));
  const dbOrphans = [...liveSet].filter(
    (t) => t !== "_prisma_migrations" && !expectedFromPrisma.has(t),
  );
  const prismaOrphans = [...expectedFromPrisma].filter((t) => !liveSet.has(t));

  console.log(JSON.stringify({
    executedAt: new Date().toISOString(),
    summary: {
      prismaModels: expectedFromPrisma.size,
      liveTables: tables.length,
      foreignKeys: Number(fkCount[0]?.cnt ?? 0),
      indexes: Number(indexCount[0]?.cnt ?? 0),
      floatColumns: floatCols.length,
      paiseColumns: paiseCols.length,
      piiColumns: piiCols.length,
      exclusionConstraints: exclusionConstraints.length,
    },
    piiState: {
      usersPlaintextEmail: Number(plaintextEmail[0]?.cnt ?? 0),
      usersEncryptedEmail: Number(encryptedEmail[0]?.cnt ?? 0),
      usersPlaintextPhone: Number(plaintextPhone[0]?.cnt ?? 0),
    },
    moneyDrift: {
      usersWalletBalanceMismatches: Number(moneyDrift[0]?.cnt ?? 0),
    },
    exclusionConstraints,
    topTablesBySize: tableSizes,
    floatColumns: floatCols,
    paiseColumns: paiseCols,
    piiColumns: piiCols,
    schemaTableDiff: {
      dbTablesWithoutPrismaModel: dbOrphans,
      prismaModelsWithoutDbTable: prismaOrphans,
    },
    allTables: tables.map((t) => t.tablename),
  }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

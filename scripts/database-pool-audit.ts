/**
 * Database pool audit — pg_stat_activity snapshot + API warm p95 benchmark.
 * Run with a single backend instance: `cd apps/backend && bun run start`
 */
import { PrismaClient } from "@prisma/client";

const TS = new Date().toISOString();
const API = process.env.API_URL ?? "http://localhost:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

type PgActivityRow = {
  state: string | null;
  count: bigint;
};

type PgSettingRow = {
  name: string;
  setting: string;
};

async function timeOnce(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  await res.arrayBuffer();
  return { ms: Math.round(performance.now() - t0), status: res.status };
}

async function benchmarkEndpoint(path: string) {
  const url = `${API}${path}`;
  const warmSamples: { ms: number; status: number }[] = [];
  for (let i = 0; i < 20; i++) {
    warmSamples.push(await timeOnce(url));
  }
  warmSamples.sort((a, b) => a.ms - b.ms);
  const statuses = [...new Set(warmSamples.map((s) => s.status))];
  return {
    path,
    timestamp: TS,
    warmP50Ms: warmSamples[Math.floor(warmSamples.length * 0.5)]!.ms,
    warmP95Ms: warmSamples[Math.floor(warmSamples.length * 0.95)]!.ms,
    statuses,
    pass: warmSamples[Math.floor(warmSamples.length * 0.95)]!.status === 200 &&
      warmSamples[Math.floor(warmSamples.length * 0.95)]!.ms < 100,
  };
}

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let pgActivity: PgActivityRow[] = [];
let pgMaxConnections: string | null = null;
let pgTotalConnections: number | null = null;

try {
  pgActivity = await prisma.$queryRaw<PgActivityRow[]>`
    SELECT state, count(*)::bigint AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY state
    ORDER BY count DESC
  `;
  const settings = await prisma.$queryRaw<PgSettingRow[]>`
    SELECT name, setting FROM pg_settings WHERE name = 'max_connections'
  `;
  pgMaxConnections = settings[0]?.setting ?? null;
  const total = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT count(*)::bigint AS count FROM pg_stat_activity
  `;
  pgTotalConnections = Number(total[0]?.count ?? 0);
} catch (err) {
  console.error("pg_stat_activity query failed:", err);
}

const apiResults = await Promise.all([
  benchmarkEndpoint("/api/services"),
  benchmarkEndpoint("/api/stats/overview"),
]);

const poolLimitMatch = DATABASE_URL.match(/connection_limit=(\d+)/);
const report = {
  timestamp: TS,
  database: {
    maxConnections: pgMaxConnections,
    totalConnections: pgTotalConnections,
    activityByState: pgActivity.map((r) => ({
      state: r.state,
      count: Number(r.count),
    })),
    prismaConnectionLimit: poolLimitMatch ? Number(poolLimitMatch[1]) : null,
  },
  api: apiResults,
};

const outJson = "measurements/database-pool-audit.json";
await Bun.write(outJson, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await prisma.$disconnect();

/**
 * Database pool audit — pg_stat_activity snapshot + API warm p95 benchmark.
 * Run: cd apps/backend && bun run scripts/database-pool-audit.ts
 */
import prisma from "../src/lib/prisma";
import { prismaPoolConfigFromUrl } from "../src/lib/database-url";

const TS = new Date().toISOString();
const API = process.env.API_URL ?? "http://localhost:3000";

type PgActivityRow = { state: string | null; count: bigint };
type PgSettingRow = { name: string; setting: string };

async function timeOnce(url: string) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  await res.arrayBuffer();
  return { ms: Math.round(performance.now() - t0), status: res.status };
}

async function benchmarkEndpoint(path: string) {
  const url = `${API}${path}`;
  const warmSamples: { ms: number; status: number }[] = [];
  for (let i = 0; i < 10; i++) {
    warmSamples.push(await timeOnce(url));
    if (i < 9) await Bun.sleep(200);
  }
  warmSamples.sort((a, b) => a.ms - b.ms);
  const p95 = warmSamples[Math.floor(warmSamples.length * 0.95)]!;
  return {
    path,
    timestamp: TS,
    warmP50Ms: warmSamples[Math.floor(warmSamples.length * 0.5)]!.ms,
    warmP95Ms: p95.ms,
    statuses: [...new Set(warmSamples.map((s) => s.status))],
    pass: p95.status === 200 && p95.ms < 100,
  };
}

const poolConfig = prismaPoolConfigFromUrl();

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

const report = {
  timestamp: TS,
  database: {
    maxConnections: pgMaxConnections,
    totalConnections: pgTotalConnections,
    activityByState: pgActivity.map((r) => ({
      state: r.state,
      count: Number(r.count),
    })),
    prismaConnectionLimit: poolConfig.connectionLimit,
    prismaPoolTimeoutSec: poolConfig.poolTimeoutSec,
  },
  api: apiResults,
};

const outJson = "../../measurements/database-pool-audit.json";
await Bun.write(outJson, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await prisma.$disconnect();

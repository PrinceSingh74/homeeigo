import "../src/load-env";
import prisma from "../src/lib/prisma";

const since30d = new Date(Date.now() - 30 * 24 * 3600_000);
const byPath = await prisma.$queryRaw<
  Array<{ path: string; code: string; err: string; cnt: number }>
>`
  SELECT
    COALESCE(metadata::json->>'path', 'unknown') AS path,
    COALESCE(metadata::json->>'code', 'unknown') AS code,
    COALESCE(metadata::json->>'error', 'unknown') AS err,
    COUNT(*)::int AS cnt
  FROM app_log_entries
  WHERE created_at >= ${since30d} AND message = 'unhandled error' AND metadata IS NOT NULL
  GROUP BY 1,2,3 ORDER BY cnt DESC LIMIT 25`;
console.log(JSON.stringify(byPath, null, 2));
await prisma.$disconnect();

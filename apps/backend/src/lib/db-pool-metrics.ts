import prisma from "./prisma";
import { prismaPoolConfigFromUrl } from "./database-url";

export type DbPoolSnapshot = {
  capturedAt: string;
  prismaConnectionLimit: number;
  prismaPoolTimeoutSec: number;
  pgConnectionsByState: Array<{ state: string | null; count: number }>;
  giftCardLockWaits: number;
  giftCardRowLocks: number;
};

/** Point-in-time Postgres + Prisma pool observability for concurrency audits. */
export async function captureDbPoolSnapshot(): Promise<DbPoolSnapshot> {
  const pool = prismaPoolConfigFromUrl();
  const byState = await prisma.$queryRaw<Array<{ state: string | null; cnt: bigint }>>`
    SELECT state, COUNT(*)::bigint AS cnt
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY state
    ORDER BY cnt DESC
  `;
  const lockStats = await prisma.$queryRaw<Array<{ row_locks: bigint; waiting: bigint }>>`
    SELECT
      COUNT(*) FILTER (WHERE l.granted)::bigint AS row_locks,
      COUNT(*) FILTER (WHERE NOT l.granted)::bigint AS waiting
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = 'gift_cards'
  `;
  const locks = lockStats[0] ?? { row_locks: 0n, waiting: 0n };
  return {
    capturedAt: new Date().toISOString(),
    prismaConnectionLimit: pool.connectionLimit,
    prismaPoolTimeoutSec: pool.poolTimeoutSec,
    pgConnectionsByState: byState.map((r) => ({
      state: r.state,
      count: Number(r.cnt),
    })),
    giftCardRowLocks: Number(locks.row_locks),
    giftCardLockWaits: Number(locks.waiting),
  };
}

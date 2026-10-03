/**
 * Database hygiene check — bloat, retention coverage and autovacuum settings. Read-only.
 *
 * Written after a measurement nobody had a reason to take: `provider_match_scores` held ONE row in
 * 31,629 heap pages (247 MB) plus 82 MB of indexes — the largest object in a 1,060 MB database. Its
 * 7-day retention was working perfectly. Nothing was watching the space that retention left behind.
 *
 * Two distinct problems get confused when a table "looks big", and this script separates them:
 *
 *   BLOAT      — many pages, few live rows. Retention ran; the file never shrank. Needs
 *                VACUUM FULL / REINDEX, not deletion.
 *   GROWTH     — many pages, many live rows. The data is real and there is no retention policy.
 *                Needs a retention decision, and deleting it is a business call, not a cleanup.
 *
 * Treating growth as bloat wastes a maintenance window; treating bloat as growth deletes live data
 * to fix a problem deletion cannot fix.
 *
 *   bun --env-file=.env run scripts/check-db-hygiene.ts
 *   bun run scripts/check-db-hygiene.ts --url postgresql://...
 *
 * Exit codes: 0 = healthy, 1 = at least one table needs attention.
 */
import { PrismaClient } from "@prisma/client";

const argOf = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = argOf("url");
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();

/** A table is "bloated" when its heap is big and almost none of it is live rows. */
const BLOAT_MIN_PAGES = 1_000; // ~8 MB — below this the absolute waste is not worth a lock
const BLOAT_MAX_ROWS_PER_PAGE = 1; // fewer live rows than pages is decisive, not marginal
/** Above this, an untended table is a capacity question even if it is not bloated. */
const GROWTH_WARN_MB = 100;

/**
 * Tables the platform actively prunes. Anything large and NOT here is growing unattended.
 * Derived from `data-retention.service.ts` — update both together.
 */
const RETENTION_COVERED = new Set([
  "provider_match_scores",  // MATCH_SCORE_RETENTION_DAYS (default 7)
  "otps",                   // deleteExpiredOTPs / deleteOldUsedOTPs
  "refresh_tokens",         // deleteExpiredTokens
  "enterprise_audit_logs",  // archive + delete by retention category
  "activity_logs",
  "notifications",
  "workflow_step_runs",
  "ai_gateway_audit",
  "ai_gateway_requests",
  "ai_tool_policy_logs",
  "app_log_entries",        // APP_LOG_RETENTION_DAYS
]);

type Row = {
  relname: string;
  pages: number;
  est_rows: number;
  heap_bytes: string;
  index_bytes: string;
  total_bytes: string;
  reloptions: string[] | null;
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>(`SELECT current_database() AS db`);
  const [{ total }] = await prisma.$queryRawUnsafe<{ total: string }[]>(
    `SELECT pg_database_size(current_database())::text AS total`,
  );
  console.log(`\n[db-hygiene] ${db} — ${mb(Number(total))} total\n${"=".repeat(74)}`);

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT c.relname,
            c.relpages AS pages,
            c.reltuples::bigint AS est_rows,
            pg_relation_size(c.oid)::text       AS heap_bytes,
            pg_indexes_size(c.oid)::text        AS index_bytes,
            pg_total_relation_size(c.oid)::text AS total_bytes,
            c.reloptions
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 40`,
  );

  const bloated: string[] = [];
  const growing: string[] = [];
  const untunedChurn: string[] = [];

  for (const r of rows) {
    const heap = Number(r.heap_bytes);
    const idx = Number(r.index_bytes);
    const totalB = Number(r.total_bytes);
    const rowsN = Number(r.est_rows);
    const pages = Number(r.pages);

    const heapBloat = pages >= BLOAT_MIN_PAGES && rowsN <= pages * BLOAT_MAX_ROWS_PER_PAGE;
    // Indexes far larger than a tiny heap is the same disease expressed in the index.
    const indexBloat = idx > 8 * 1024 * 1024 && heap < idx / 10;
    const isBloat = heapBloat || indexBloat;
    const covered = RETENTION_COVERED.has(r.relname);
    const big = totalB > GROWTH_WARN_MB * 1024 * 1024;

    if (isBloat) {
      bloated.push(r.relname);
      console.log(
        `\n[BLOAT ] ${r.relname}\n` +
          `         ${rowsN.toLocaleString()} live rows in ${pages.toLocaleString()} pages · heap ${mb(heap)} · indexes ${mb(idx)} · total ${mb(totalB)}\n` +
          `         retention: ${covered ? "yes — pruning works, the space was never returned" : "NONE"}\n` +
          `         action: VACUUM (FULL, ANALYZE) / REINDEX in a maintenance window. Deleting rows will NOT help.`,
      );
      if (!r.reloptions?.some((o) => o.startsWith("autovacuum_"))) untunedChurn.push(r.relname);
      continue;
    }

    if (big && !covered) {
      growing.push(r.relname);
      console.log(
        `\n[GROWTH] ${r.relname}\n` +
          `         ${rowsN.toLocaleString()} live rows · total ${mb(totalB)} · NO retention policy\n` +
          `         action: this is real data, not bloat. Needs a retention decision from the data owner.`,
      );
    }
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`bloated tables:            ${bloated.length ? bloated.join(", ") : "none"}`);
  console.log(`large & unretained tables: ${growing.length ? growing.join(", ") : "none"}`);
  if (untunedChurn.length) {
    console.log(
      `bloated WITHOUT per-table autovacuum settings: ${untunedChurn.join(", ")}\n` +
        `  These will re-bloat after any VACUUM FULL. See migration 20260921100000_autovacuum_high_churn_tables.`,
    );
  }

  if (bloated.length || growing.length) {
    console.error(`\n[db-hygiene] ATTENTION REQUIRED — see docs/enterprise-2035-database-hygiene.md`);
    process.exit(1);
  }
  console.log(`\n[db-hygiene] PASS`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

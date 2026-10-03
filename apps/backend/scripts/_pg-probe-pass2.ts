/**
 * One-shot Postgres recovery probe (Pass 2). Safe: SELECT only.
 *   bun run scripts/_pg-probe-pass2.ts
 */
import { Client } from "pg";

// SELECT-only, but no embedded fallback url: a probe that guesses its target reports on a
// database the operator did not choose, which is how the 2026-09-16 incident read as "fine".
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("REFUSING: set DATABASE_URL to the cluster to probe (no default target).");
  process.exit(2);
}

async function probe(dbUrl: string, label: string) {
  const c = new Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 5_000,
    query_timeout: 8_000,
  });
  try {
    await c.connect();
    const r = await c.query("SELECT current_database() AS db, pg_is_in_recovery() AS recovering, now() AS ts");
    console.log(`[${label}] OK`, JSON.stringify(r.rows[0]));
    return c;
  } catch (e) {
    console.error(`[${label}] FAIL`, e instanceof Error ? e.message : String(e));
    try {
      await c.end();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function main() {
  const root = await probe(url.replace(/\/[^/?]+(\?.*)?$/, "/postgres"), "postgres");
  if (!root) {
    process.exit(1);
  }
  const dbs = await root.query(
    `SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
     FROM pg_database WHERE datname LIKE 'homigo%' ORDER BY 1`,
  );
  console.log("[dbs]", JSON.stringify(dbs.rows));
  await root.end();

  for (const name of ["homigo_db", "homigo_test", "homigo_cert_migrate", "homigo_recon_clone"]) {
    const dbUrl = url.replace(/\/[^/?]+(\?.*)?$/, `/${name}`);
    const c = await probe(dbUrl, name);
    if (!c) continue;
    try {
      if (name === "homigo_db" || name === "homigo_test") {
        const mig = await c.query(
          `SELECT to_regclass('public._prisma_migrations') AS mig_table,
                  to_regclass('public.service_variants') AS service_variants,
                  to_regclass('public.service_addons') AS service_addons`,
        );
        console.log(`[${name} objects]`, JSON.stringify(mig.rows[0]));
        if (mig.rows[0]?.mig_table) {
          const names = await c.query(
            `SELECT migration_name FROM _prisma_migrations
             WHERE migration_name LIKE '%notification_delivery_claim%'
                OR migration_name LIKE '202609201%'
             ORDER BY 1`,
          );
          console.log(`[${name} migrations]`, JSON.stringify(names.rows));
        }
        const cols = await c.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name='services' AND column_name IN ('capability_profile','catalog_config','lifecycle_state')
           ORDER BY 1`,
        );
        console.log(`[${name} services cols]`, JSON.stringify(cols.rows.map((r) => r.column_name)));
        const svc = await c.query(`SELECT count(*)::int AS n FROM services`);
        console.log(`[${name} services count]`, svc.rows[0]?.n);
      }
    } catch (e) {
      console.error(`[${name} inspect] FAIL`, e instanceof Error ? e.message : String(e));
    }
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

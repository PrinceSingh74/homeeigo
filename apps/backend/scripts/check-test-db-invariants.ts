/**
 * Does the test database actually enforce the invariants the migrations declare?
 *
 *   bun run scripts/check-test-db-invariants.ts            # report, exit 1 if anything is missing
 *   bun run scripts/check-test-db-invariants.ts --apply    # create the missing objects
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The test database is built by `prisma db push` from schema.prisma. Prisma's schema language cannot
 * express a PARTIAL index, a CHECK, an EXCLUDE constraint, a trigger or a function, so every one of
 * those that a migration writes in raw SQL is simply ABSENT from the test database.
 *
 * That is not a cosmetic gap. It was found by a test asserting "the database refuses a second
 * PRODUCTION model version" failing — the database refused nothing, because the partial unique index
 * only exists in a migration. Auditing the rest turned up 19 missing objects, including
 * wallet-balance-non-negative on both users and providers, payment-amount-positive, the
 * double-booking guard and the one-sent-offer-per-job guard. Suites that certify money cannot go
 * negative were running against a database with no such rule.
 *
 * `setup-test-db.ts` already replays a hand-written list of migrations for exactly this reason. A
 * hand-written list is the defect: the next migration to add a CHECK is missing from it by default,
 * and nothing says so. This derives the list from the migrations themselves, so the gap becomes
 * impossible to introduce silently rather than merely fixed once.
 *
 * Statement-aware, not line-based: a partial index is routinely written with its WHERE clause on the
 * following line, which a grep over lines misses — and missing one here is exactly the failure this
 * script exists to prevent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { announceDdlTarget, assertDdlTarget, DdlTargetRefusal } from "../src/lib/ddl-target-guard";

const MIGRATIONS = join(import.meta.dir, "..", "prisma", "migrations");
const APPLY = process.argv.includes("--apply");

export type DeclaredObject = {
  migration: string;
  kind:
    | "partial index"
    | "partial unique index"
    | "check constraint"
    | "exclude constraint"
    | "trigger"
    | "function"
    /**
     * A column added by raw SQL and absent from schema.prisma — so `db push` DROPS it.
     *
     * The booking slot columns are the case: `provider_slot_start` and friends exist only in a
     * migration, `db push` removes them, and then the EXCLUDE constraints that reference them cannot
     * be recreated. Restoring constraints without restoring their columns fixes nothing, so columns
     * are tracked here and created first.
     */
    | "column";
  name: string;
  /** Qualified as `table.column` for columns; bare object name otherwise. */
  table?: string;
  /** The statement that creates it, ready to replay. */
  sql: string;
};

/**
 * Split SQL into statements WITHOUT cutting inside a dollar-quoted body.
 *
 * These migrations guard their CHECKs with `DO $$ BEGIN IF NOT EXISTS (...) THEN ALTER TABLE ...
 * END IF; END $$;`. A naive split on `;` cuts that block at the `END IF;` and produces two fragments,
 * neither of which parses — which is how five wallet, payment and rating constraints looked
 * "unreplayable" when they were merely mis-parsed. The invariants this file protects are exactly the
 * kind a sloppy parser drops silently, so the parser is explicit about it.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close + tag.length;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === ";") {
      out.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += sql[i];
    i += 1;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Objects a migration declares that `prisma db push` cannot reproduce from schema.prisma. */
export function declaredUnpushableObjects(migrationsDir = MIGRATIONS): DeclaredObject[] {
  /**
   * Last declaration wins.
   *
   * A migration that CREATEs an object is not the final word on it — a later one may drop it, and
   * then its absence is correct rather than a gap. `assignment_attempts_one_sent_per_job` is the
   * case that proved this: it enforced one offer per job, which broadcast dispatch deliberately
   * replaced, so two later migrations drop it. Reporting it as missing was a false positive, and a
   * checker that cries wolf is one people learn to skip — which is how the real gaps stay hidden.
   *
   * Directories are timestamp-prefixed, so lexicographic order is chronological order.
   */
  const latest = new Map<string, DeclaredObject | null>();
  for (const dir of readdirSync(migrationsDir).sort()) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
    } catch {
      continue; // migration_lock.toml and friends
    }
    // Comments are stripped first so a commented-out CREATE is never treated as declared.
    const cleaned = sql.replace(/--[^\n]*/g, " ");
    for (const raw of splitStatements(cleaned)) {
      const stmt = raw.replace(/\s+/g, " ").trim();
      if (!stmt) continue;

      const column =
        /^ALTER\s+TABLE\s+(?:ONLY\s+)?"?([\w.]+)"?\s+ADD\s+COLUMN\s+IF NOT EXISTS\s+"?([\w.]+)"?/i.exec(stmt);
      if (column) {
        const key = `${column[1]!}.${column[2]!}`;
        latest.set(key, { migration: dir, kind: "column", name: key, table: column[1]!, sql: stmt });
        continue;
      }

      const index = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?[\s\S]*?\sWHERE\s/i.exec(stmt);
      if (index) {
        latest.set(index[2]!, {
          migration: dir,
          kind: index[1] ? "partial unique index" : "partial index",
          name: index[2]!,
          sql: stmt,
        });
        continue;
      }
      /**
       * Every CHECK / EXCLUDE a statement declares, not just the first:
       *   - a guarded DO block routinely adds several constraints (the service identity migration adds
       *     seven in one block, and only the first used to be registered);
       *   - a CREATE TABLE declares them inline as `CONSTRAINT name CHECK (...)` with no ADD — the
       *     20260920 service tables' price/code/version CHECKs were invisible to this checker, so the
       *     test database silently lacked them while it reported OK.
       * Replaying the whole statement is safe for both: DO blocks are IF NOT EXISTS-guarded, and a
       * CREATE TABLE constraint is replayed as an ALTER TABLE ADD built from its own definition.
       */
      const table = /^CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?"?([\w.]+)"?/i.exec(stmt)?.[1];
      const constraints = [...stmt.matchAll(/(ADD\s+)?CONSTRAINT\s+"?([\w.]+)"?\s+(CHECK|EXCLUDE)\s*/gi)];
      if (constraints.length > 0) {
        for (const c of constraints) {
          const name = c[2]!;
          const kind = c[3]!.toUpperCase() === "CHECK" ? "check constraint" : "exclude constraint";
          let replay = stmt;
          if (!c[1] && table) {
            // Inline CREATE TABLE constraint: extract its balanced (...) body.
            const start = c.index! + c[0].length;
            let depth = 0;
            let end = start;
            for (; end < stmt.length; end++) {
              if (stmt[end] === "(") depth++;
              else if (stmt[end] === ")") {
                depth--;
                if (depth === 0) {
                  end++;
                  break;
                }
              }
            }
            replay = `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${c[3]!.toUpperCase()} ${stmt.slice(start, end)}`;
          }
          latest.set(name, { migration: dir, kind, name, sql: replay });
        }
        if (!table) continue;
      }
      const trigger = /^CREATE\s+(?:OR REPLACE\s+)?TRIGGER\s+"?([\w.]+)"?/i.exec(stmt);
      if (trigger) {
        latest.set(trigger[1]!, { migration: dir, kind: "trigger", name: trigger[1]!, sql: stmt });
        continue;
      }
      const fn = /^CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+"?([\w.]+)"?/i.exec(stmt);
      if (fn) {
        latest.set(fn[1]!, { migration: dir, kind: "function", name: fn[1]!, sql: stmt });
        continue;
      }

      /**
       * A later DROP retires the object. Recorded as a tombstone rather than deleted from the map,
       * so a still-later CREATE can revive it and order is what decides.
       */
      const drop =
        /^DROP\s+(?:INDEX|TRIGGER|FUNCTION)\s+(?:IF EXISTS\s+)?"?([\w.]+)"?/i.exec(stmt) ??
        /DROP\s+CONSTRAINT\s+(?:IF EXISTS\s+)?"?([\w.]+)"?/i.exec(stmt);
      if (drop) latest.set(drop[1]!, null);
    }
  }
  return [...latest.values()].filter((o): o is DeclaredObject => o !== null);
}

function testUrlFromEnvFile(): string {
  // Same selection as setup-test-db: an injected URL wins when it names a test database.
  const injected = process.env.HOMIGO_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
  if (/test/i.test(injected.split("/").pop()?.split("?")[0] ?? "")) return injected;
  try {
    const envTest = readFileSync(join(import.meta.dir, "..", ".env.test"), "utf8");
    const line = envTest.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

async function main() {
  let target;
  try {
    target = assertDdlTarget("test", testUrlFromEnvFile());
  } catch (err) {
    if (err instanceof DdlTargetRefusal) {
      console.error(err.message);
      process.exit(3);
    }
    throw err;
  }
  announceDdlTarget(APPLY ? "create missing test-db invariants" : "check test-db invariants", target);

  const prisma = new PrismaClient({ datasources: { db: { url: testUrlFromEnvFile() } } });
  try {
    const declared = declaredUnpushableObjects();

    const indexes = new Set(
      (await prisma.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)
        .map((r) => r.indexname),
    );
    const constraints = new Set(
      (await prisma.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint`).map((r) => r.conname),
    );
    const triggers = new Set(
      (await prisma.$queryRaw<Array<{ tgname: string }>>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)
        .map((r) => r.tgname),
    );
    const functions = new Set(
      (await prisma.$queryRaw<Array<{ proname: string }>>`
        SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`)
        .map((r) => r.proname),
    );

    const columns = new Set(
      (await prisma.$queryRaw<Array<{ k: string }>>`
        SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema = 'public'`)
        .map((r) => r.k),
    );

    const exists = (o: DeclaredObject) => {
      if (o.kind === "column") return columns.has(o.name);
      if (o.kind.includes("index")) return indexes.has(o.name);
      if (o.kind.includes("constraint")) return constraints.has(o.name) || indexes.has(o.name);
      if (o.kind === "trigger") return triggers.has(o.name);
      return functions.has(o.name);
    };

    const missing = declared.filter((o) => !exists(o));
    console.log(`[test-db-invariants] ${declared.length} object(s) declared in migrations but not expressible in schema.prisma`);

    if (missing.length === 0) {
      console.log("[test-db-invariants] OK — every one of them exists in the test database");
      return;
    }

    if (!APPLY) {
      console.error(`[test-db-invariants] MISSING ${missing.length} invariant(s) from the test database:`);
      for (const o of missing) console.error(`  [${o.kind}] ${o.name}   (${o.migration})`);
      console.error("");
      console.error("A test that asserts the DATABASE refuses something cannot pass honestly while these are absent.");
      console.error("Run with --apply, or add the migration to INVARIANT_MIGRATIONS in setup-test-db.ts.");
      process.exit(1);
    }

    let created = 0;
    const failed: Array<{ name: string; reason: string }> = [];
    /**
     * Columns first. An EXCLUDE constraint over `provider_slot_start` cannot be created while the
     * column `db push` dropped is still absent, and attempting it in declaration order reports a
     * confusing "column does not exist" instead of simply working.
     */
    const ordered = [...missing].sort((a, b) => Number(b.kind === "column") - Number(a.kind === "column"));
    for (const o of ordered) {
      try {
        await prisma.$executeRawUnsafe(o.sql);
        created += 1;
        console.log(`  created [${o.kind}] ${o.name}`);
      } catch (err) {
        /**
         * Reported, never swallowed. A CHECK can legitimately fail to apply because fixture rows
         * already violate it — which is itself worth knowing, since production would have refused
         * those rows.
         */
        const reason = err instanceof Error ? err.message.split("\n").find((l) => l.includes("ERROR")) ?? err.message.slice(0, 160) : String(err);
        failed.push({ name: o.name, reason: reason.trim() });
        console.error(`  FAILED  [${o.kind}] ${o.name}: ${reason.trim()}`);
      }
    }
    console.log(`[test-db-invariants] created ${created}, failed ${failed.length}`);
    if (failed.length > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) await main();

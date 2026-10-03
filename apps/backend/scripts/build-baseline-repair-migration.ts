/**
 * Pass 13 Phase 14 - build the baseline repair migration.
 *
 * The migration chain in prisma/migrations was authored alongside `prisma db push`,
 * so a set of tables/enums that exist in schema.prisma were never created by any
 * migration. `prisma migrate deploy` against a fresh database therefore fails.
 *
 * This generator derives the repair DDL mechanically from Prisma's own canonical
 * output (`prisma migrate diff --from-empty --to-schema-datamodel`) so nothing is
 * hand-guessed, then wraps every statement in an idempotency guard so the repair is
 * a no-op on databases that were provisioned by db push.
 *
 * Columns that a LATER migration adds with an unguarded `ALTER TABLE ... ADD COLUMN`
 * are deliberately omitted here (see OMIT_COLUMNS) so that later migration still
 * applies cleanly on a fresh database.
 *
 * Usage: bun run scripts/build-baseline-repair-migration.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FULL_DDL = ".migval-full-schema.sql";
const MIGRATIONS = "prisma/migrations";
const OUT_DIR = join(MIGRATIONS, "20260609130000_baseline_repair_db_push_drift");

/** Columns added later by an unguarded ALTER TABLE ... ADD COLUMN. */
const OMIT_COLUMNS: Record<string, string[]> = {
  gift_cards: ["last_attempt_at", "failed_attempts"],
};

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// ---- what the existing chain already creates -------------------------------
const migratedTables = new Set<string>();
const migratedEnums = new Set<string>();
const SELF = "20260609130000_baseline_repair_db_push_drift";
for (const dir of readdirSync(MIGRATIONS)
  .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
  .filter((d) => d !== SELF)
  .sort()) {
  const file = join(MIGRATIONS, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = stripComments(readFileSync(file, "utf8"));
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)) migratedTables.add(m[1]!);
  for (const m of sql.matchAll(/CREATE\s+TYPE\s+"?([A-Za-z0-9_]+)"?/gi)) migratedEnums.add(m[1]!);
}

// ---- canonical DDL, split into statements -----------------------------------
const raw = readFileSync(FULL_DDL, "utf8");
const statements = raw
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const enumStatements: Array<{ name: string; sql: string }> = [];
const tableStatements: Array<{ name: string; sql: string }> = [];
const indexStatements: Array<{ table: string; sql: string }> = [];
const fkStatements: Array<{ table: string; target: string; sql: string }> = [];

for (const stmt of statements) {
  const body = stripComments(stmt).trim();
  if (!body) continue;
  let m = body.match(/^CREATE\s+TYPE\s+"([A-Za-z0-9_]+)"/i);
  if (m) {
    enumStatements.push({ name: m[1]!, sql: body });
    continue;
  }
  m = body.match(/^CREATE\s+TABLE\s+"([A-Za-z0-9_]+)"/i);
  if (m) {
    tableStatements.push({ name: m[1]!, sql: body });
    continue;
  }
  m = body.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+"[A-Za-z0-9_]+"\s+ON\s+"([A-Za-z0-9_]+)"/i);
  if (m) {
    indexStatements.push({ table: m[1]!, sql: body });
    continue;
  }
  m = body.match(/^ALTER\s+TABLE\s+"([A-Za-z0-9_]+)"\s+ADD\s+CONSTRAINT\s+"[A-Za-z0-9_]+"\s+FOREIGN\s+KEY[\s\S]*?REFERENCES\s+"([A-Za-z0-9_]+)"/i);
  if (m) {
    fkStatements.push({ table: m[1]!, target: m[2]!, sql: body });
    continue;
  }
}

const missingEnums = enumStatements.filter((e) => !migratedEnums.has(e.name));
const missingTables = tableStatements.filter((t) => !migratedTables.has(t.name));
const missingTableNames = new Set(missingTables.map((t) => t.name));

function stripOmittedColumns(table: string, sql: string): string {
  const omit = OMIT_COLUMNS[table];
  if (!omit) return sql;
  const lines = sql.split("\n");
  const kept = lines.filter((line) => !omit.some((col) => new RegExp(`^\\s*"${col}"\\s`).test(line)));
  return kept.join("\n");
}

/** Enum creation is guarded by catching duplicate_object so db-push DBs are unaffected. */
function guardEnum(sql: string): string {
  return [
    "DO $$ BEGIN",
    `  ${sql.replace(/\n/g, "\n  ")};`,
    "EXCEPTION WHEN duplicate_object THEN NULL;",
    "END $$;",
  ].join("\n");
}

const out: string[] = [];
out.push("-- Pass 13 Phase 14: baseline repair for prisma db push drift.");
out.push("--");
out.push("-- These tables and enums exist in prisma/schema.prisma but were never created by any");
out.push("-- migration, so `prisma migrate deploy` against a fresh database failed at");
out.push("-- 20260609160000_p3_gift_card_campaign_security (relation \"gift_cards\" does not exist).");
out.push("--");
out.push("-- Every statement is idempotent, so this migration is a no-op on databases that were");
out.push("-- provisioned with db push and already carry these objects.");
out.push("--");
out.push("-- gift_cards intentionally omits last_attempt_at / failed_attempts: they are added by");
out.push("-- 20260609160000_p3_gift_card_campaign_security with an unguarded ADD COLUMN.");
out.push("");

if (missingEnums.length > 0) {
  out.push("-- ---------------------------------------------------------------- enums");
  for (const e of missingEnums) out.push(`${guardEnum(e.sql)}\n`);
}

if (missingTables.length > 0) {
  out.push("-- --------------------------------------------------------------- tables");
  for (const t of missingTables) {
    const sql = stripOmittedColumns(t.name, t.sql).replace(/^CREATE\s+TABLE\s+"/i, 'CREATE TABLE IF NOT EXISTS "');
    out.push(`${sql};\n`);
  }

  out.push("-- -------------------------------------------------------------- indexes");
  for (const i of indexStatements.filter((i) => missingTableNames.has(i.table))) {
    const sql = i.sql
      .replace(/^CREATE\s+UNIQUE\s+INDEX\s+"/i, 'CREATE UNIQUE INDEX IF NOT EXISTS "')
      .replace(/^CREATE\s+INDEX\s+"/i, 'CREATE INDEX IF NOT EXISTS "');
    out.push(`${sql};`);
  }
  out.push("");

  out.push("-- ---------------------------------------------------------- foreign keys");
  const relevantFks = fkStatements.filter((f) => missingTableNames.has(f.table));
  for (const f of relevantFks) {
    const name = f.sql.match(/ADD\s+CONSTRAINT\s+"([A-Za-z0-9_]+)"/i)![1]!;
    out.push("DO $$ BEGIN");
    out.push(`  ${f.sql.replace(/\n/g, " ").replace(/\s+/g, " ")};`);
    out.push("EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;");
    out.push(`END $$; -- ${name}`);
    out.push("");
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "migration.sql"), `${out.join("\n").trimEnd()}\n`, "utf8");

console.log(`missing enums: ${missingEnums.length}`);
for (const e of missingEnums) console.log(`  enum  ${e.name}`);
console.log(`missing tables: ${missingTables.length}`);
for (const t of missingTables) console.log(`  table ${t.name}`);
console.log(`indexes emitted: ${indexStatements.filter((i) => missingTableNames.has(i.table)).length}`);
console.log(`foreign keys emitted: ${fkStatements.filter((f) => missingTableNames.has(f.table)).length}`);
console.log(`written: ${join(OUT_DIR, "migration.sql")}`);


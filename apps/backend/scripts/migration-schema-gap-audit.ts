/**
 * Pass 13 Phase 14 - migration vs schema gap audit.
 *
 * Lists every table (@@map) and enum declared in schema.prisma that no migration
 * in prisma/migrations ever creates. Such objects only exist in environments
 * provisioned with `prisma db push`, so `prisma migrate deploy` on a fresh
 * database cannot reproduce the schema.
 *
 * Read-only. Usage: bun run scripts/migration-schema-gap-audit.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "prisma/migrations";
const SCHEMA = "prisma/schema.prisma";

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const migratedTables = new Set<string>();
const migratedEnums = new Set<string>();

const dirs = readdirSync(MIGRATIONS)
  .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
  .sort();

for (const dir of dirs) {
  const file = join(MIGRATIONS, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = stripComments(readFileSync(file, "utf8"));
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)) {
    migratedTables.add(m[1]!);
  }
  for (const m of sql.matchAll(/CREATE\s+TYPE\s+"?([A-Za-z0-9_]+)"?/gi)) {
    migratedEnums.add(m[1]!);
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?\s+RENAME\s+TO\s+"?([A-Za-z0-9_]+)"?/gi)) {
    migratedTables.add(m[2]!);
  }
}

const schema = readFileSync(SCHEMA, "utf8");
const schemaTables = new Set<string>();
for (const m of schema.matchAll(/@@map\("([A-Za-z0-9_]+)"\)/g)) schemaTables.add(m[1]!);
const schemaEnums = new Set<string>();
for (const m of schema.matchAll(/^enum\s+([A-Za-z0-9_]+)\s*\{/gm)) schemaEnums.add(m[1]!);

const missingTables = [...schemaTables].filter((t) => !migratedTables.has(t)).sort();
const missingEnums = [...schemaEnums].filter((e) => !migratedEnums.has(e)).sort();

console.log(`migrations scanned: ${dirs.length}`);
console.log(`schema tables: ${schemaTables.size}  migrated tables: ${migratedTables.size}`);
console.log(`schema enums: ${schemaEnums.size}  migrated enums: ${migratedEnums.size}`);
console.log(`MISSING TABLES (${missingTables.length}):`);
for (const t of missingTables) console.log(`  ${t}`);
console.log(`MISSING ENUMS (${missingEnums.length}):`);
for (const e of missingEnums) console.log(`  ${e}`);

if (missingTables.length > 0 || missingEnums.length > 0) process.exitCode = 1;

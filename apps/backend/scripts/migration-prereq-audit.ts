/**
 * Pass 13 Phase 14 - migration chain prerequisite audit.
 *
 * Detects migrations that ALTER / reference a table (or enum) that no earlier
 * migration in lexicographic order ever creates. Such a chain cannot be applied
 * to a fresh database with `prisma migrate deploy`.
 *
 * Read-only. Usage: bun run scripts/migration-prereq-audit.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "prisma/migrations";

type Problem = { migration: string; kind: string; target: string };

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const dirs = readdirSync(ROOT)
  .filter((d) => statSync(join(ROOT, d)).isDirectory())
  .sort();

const tables = new Set<string>();
const enums = new Set<string>();
const problems: Problem[] = [];

for (const dir of dirs) {
  const file = join(ROOT, dir, "migration.sql");
  if (!existsSync(file)) continue;
  const sql = stripComments(readFileSync(file, "utf8"));

  // Creations declared by this migration are available to itself.
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)) {
    tables.add(m[1]!);
  }
  for (const m of sql.matchAll(/CREATE\s+TYPE\s+"?([A-Za-z0-9_]+)"?/gi)) {
    enums.add(m[1]!);
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?([A-Za-z0-9_]+)"?/gi)) {
    if (!tables.has(m[1]!)) problems.push({ migration: dir, kind: "ALTER_MISSING_TABLE", target: m[1]! });
  }
  for (const m of sql.matchAll(/REFERENCES\s+"?([A-Za-z0-9_]+)"?/gi)) {
    if (!tables.has(m[1]!)) problems.push({ migration: dir, kind: "FK_MISSING_TABLE", target: m[1]! });
  }
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?[A-Za-z0-9_]+"?\s+ON\s+"?([A-Za-z0-9_]+)"?/gi)) {
    if (!tables.has(m[1]!)) problems.push({ migration: dir, kind: "INDEX_MISSING_TABLE", target: m[1]! });
  }
  for (const m of sql.matchAll(/ALTER\s+TYPE\s+"?([A-Za-z0-9_]+)"?/gi)) {
    if (!enums.has(m[1]!)) problems.push({ migration: dir, kind: "ALTER_MISSING_ENUM", target: m[1]! });
  }
}

const seen = new Set<string>();
const unique = problems.filter((p) => {
  const key = `${p.migration}|${p.kind}|${p.target}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`migrations: ${dirs.length}`);
console.log(`tables created by chain: ${tables.size}`);
console.log(`problems: ${unique.length}`);
for (const p of unique) {
  console.log(`${p.migration}\t${p.kind}\t${p.target}`);
}
if (unique.length > 0) process.exitCode = 1;

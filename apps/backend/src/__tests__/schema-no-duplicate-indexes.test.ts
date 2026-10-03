/**
 * Duplicate indexes (2026-09-29): 14 models declared a field `@unique` AND `@@index([field])`, so
 * every one of those tables carried a plain btree index next to a UNIQUE btree on the same column —
 * double write cost, no read benefit. Migration `20260929200000_drop_redundant_duplicate_indexes`
 * drops them; these tests keep them from coming back, in the schema file and in the database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../lib/prisma";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

/** Single-field `@@index([f])` lines whose field is already `@unique` in the same model. */
export function redundantSingleFieldIndexes(schema: string): string[] {
  const found: string[] = [];
  const models = schema.split(/^model\s+/m).slice(1);
  for (const block of models) {
    const name = block.match(/^(\w+)/)?.[1] ?? "?";
    const body = block.slice(0, block.search(/^\}/m));
    const unique = new Set(
      body
        .split("\n")
        .filter((l) => /^\s+\w+\s+\S+.*@unique\b/.test(l))
        .map((l) => l.trim().split(/\s+/)[0]),
    );
    for (const m of body.matchAll(/^\s*@@index\(\[(\w+)\]\)\s*$/gm)) {
      if (unique.has(m[1])) found.push(`${name}.${m[1]}`);
    }
  }
  return found;
}

describe("no duplicate indexes", () => {
  test("the checker fires on the pattern it guards against", () => {
    const sample = "model Sample {\n  id String @id\n  code String @unique\n  other String\n  @@index([code])\n  @@index([other])\n}\n";
    expect(redundantSingleFieldIndexes(sample)).toEqual(["Sample.code"]);
  });

  test("schema.prisma declares no @@index on a field that is already @unique", () => {
    const path = process.env.SCHEMA_UNDER_TEST ?? join(import.meta.dir, "..", "..", "prisma", "schema.prisma");
    expect(redundantSingleFieldIndexes(readFileSync(path, "utf8"))).toEqual([]);
  });

  test("the test database has no two indexes with the same definition on one table", async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    refuseIfNotIsolatedTestDb(db);
    const dups = await prisma.$queryRaw<{ tbl: string; idx: string[] }[]>`
      SELECT c.relname AS tbl, array_agg(ic.relname ORDER BY ic.relname) AS idx
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      GROUP BY c.relname, regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \\S+ ON ', '')
      HAVING count(*) > 1`;
    expect(dups).toEqual([]);
  });
});

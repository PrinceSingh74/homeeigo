/**
 * Reconcile `_prisma_migrations.checksum` with the migration files — METADATA ONLY, never schema.
 *
 * Prisma stores sha256(migration.sql bytes) when it applies a migration and never re-checks it
 * (`migrate deploy` / `migrate status` are silent on a later edit). On 2026-09-22 the Phase 05 preflight
 * found 48 applied rows whose file no longer hashed to the recorded checksum: 40 were line-ending only
 * (fixed by normalising the files to LF + .gitattributes) and 8 had been edited after apply so that a
 * FRESH database would reproduce what live already had (referral / H-Coin / wallet-transfer objects
 * created outside migrations, idempotency `IF EXISTS`, a default that live already carried).
 *
 * This script updates the checksum of exactly those rows to the current file's hash — and refuses to
 * unless a migrations-only rebuild is catalog-IDENTICAL to the target (scripts/diff-schema-catalogs.ts),
 * which is the proof that the current file content IS the applied schema. Old values go to evidence.
 *
 *   bun run scripts/release/reconcile-migration-checksums.ts --url "$URL" --confirm-db <name>            # dry run
 *   HOMIGO_DDL_CONFIRM=<name> bun run scripts/release/reconcile-migration-checksums.ts --url "$URL" \
 *       --confirm-db <name> --expected "<fresh migrations-only url>" --apply --evidence out.json
 *
 * Never: db push, migrate reset, migrate resolve, DDL, business-table writes.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertDdlTarget, announceDdlTarget } from "../../src/lib/ddl-target-guard";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../prisma/migrations");
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const refuse = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(2); };

const url = arg("--url") ?? refuse("--url is required (DATABASE_URL is ignored on purpose)");
const dbName = new URL(url).pathname.replace(/^\//, "").split("?")[0] ?? "";
const confirm = arg("--confirm-db") ?? refuse("--confirm-db <database name> is required");
if (confirm !== dbName) refuse(`--confirm-db "${confirm}" ≠ target database "${dbName}"`);
const apply = process.argv.includes("--apply");
const expected = arg("--expected");
if (apply) {
  if (!expected) refuse("--apply requires --expected <migrations-only rebuild url> (catalog proof)");
  announceDdlTarget("reconcile-migration-checksums", assertDdlTarget("live", url)); // needs HOMIGO_DDL_CONFIRM=<db>
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Row = { id: string; migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };
const rows = await prisma.$queryRawUnsafe<Row[]>(
  "SELECT id, migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
);
const plan: Array<{ id: string; migration: string; from: string; to: string }> = [];
let lineEndingOnly = 0;
for (const r of rows) {
  let bytes: Buffer;
  try { bytes = readFileSync(join(MIGRATIONS_DIR, r.migration_name, "migration.sql")); } catch { continue; }
  const current = sha(bytes);
  if (current === r.checksum) continue;
  const lf = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
  if (sha(lf) === r.checksum) { lineEndingOnly++; continue; } // fix the FILE (LF), not the history
  plan.push({ id: r.id, migration: r.migration_name, from: r.checksum, to: current });
}
console.log(`[reconcile] target=${dbName} · applied rows=${rows.length} · content-drifted=${plan.length} · line-ending-only=${lineEndingOnly}${lineEndingOnly ? " (normalise those files to LF instead)" : ""}`);
for (const p of plan) console.log(`  ${p.migration}  ${p.from.slice(0, 12)}… → ${p.to.slice(0, 12)}…`);

if (!apply || plan.length === 0) {
  console.log(`[reconcile] ${plan.length ? "dry run — nothing written" : "nothing to reconcile"}`);
  await prisma.$disconnect();
  process.exit(0);
}

// Proof gate: the files as they are now must build the schema the target has.
const diff = spawnSync("bun", ["run", resolve(import.meta.dir, "../diff-schema-catalogs.ts"), "--expected", expected!, "--actual", url], { encoding: "utf8" });
const identical = diff.status === 0 && /\[schema-diff\] IDENTICAL/.test(diff.stdout);
if (!identical) {
  console.error(diff.stdout.slice(-2000));
  refuse("fresh migrations-only build is NOT catalog-identical to the target — the current files are not proven to be the applied schema");
}
console.log("[reconcile] catalog proof: fresh build IDENTICAL to target");

const applied: typeof plan = [];
await prisma.$transaction(async (tx) => {
  for (const p of plan) {
    const n = await tx.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum = $1 WHERE id = $2 AND checksum = $3", p.to, p.id, p.from);
    if (n !== 1) throw new Error(`row for ${p.migration} changed underneath (updated ${n})`);
    applied.push(p);
  }
});
const evidence = { target: `${new URL(url).hostname}:${new URL(url).port || "5432"}/${dbName}`, at: new Date().toISOString(), catalogProof: "IDENTICAL", rows: applied };
const out = arg("--evidence");
if (out) writeFileSync(out, JSON.stringify(evidence, null, 2));
console.log(`[reconcile] ${applied.length} checksum(s) reconciled${out ? ` · evidence → ${out}` : ""}`);
await prisma.$disconnect();

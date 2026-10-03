/**
 * Run a SQL file against the ISOLATED test database — and only that.
 *
 *   bun run db:execute:test prisma/migrations/<dir>/migration.sql
 *
 * Why this exists: `bunx prisma db execute` resolves DATABASE_URL through prisma.config.ts, which
 * loads `.env` (the live local database). Sourcing `.env.test` in a shell is not a safe override —
 * its url contains `&`, which bash treats as a background operator, so the variable is silently
 * never exported. On 2026-09-16 that combination ran a dedupe migration against `homigo_db`.
 * This wrapper reads the test url from `.env.test` itself and verifies it through the shared
 * DDL guard before passing it to Prisma with an explicit `--url`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { announceDdlTarget, assertDdlTarget, DdlTargetRefusal } from "../src/lib/ddl-target-guard";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("usage: bun run db:execute:test <path/to/file.sql>");
  process.exit(2);
}

function testUrlFromEnvFile(): string {
  try {
    const envTest = readFileSync(join(import.meta.dir, "..", ".env.test"), "utf8");
    const line = envTest.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

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

announceDdlTarget(`db execute ${file}`, target);
const url = testUrlFromEnvFile();
// Windows resolves bunx through cmd.exe, where an unquoted "&" in the url splits the command.
const q = (v: string) => (process.platform === "win32" ? `"${v}"` : v);
const r = spawnSync("bunx", ["prisma", "db", "execute", "--url", q(url), "--file", q(file)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);

/**
 * The live-database guard in lib/prisma-base.ts (assertTestDatabaseIsolation): under NODE_ENV=test a
 * Prisma client for a non-test database must never be constructed, however the suite was invoked.
 * It fires at module load, so each case runs in a child process. Port 1 is unroutable — even a broken
 * guard could not reach a real server; the client is lazy and never connects here anyway.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshLoopClock } from "./helpers/fresh-loop-clock";

const PRISMA_BASE = join(import.meta.dir, "..", "lib", "prisma-base.ts").replace(/\\/g, "/");

async function construct(nodeEnv: string, database: string) {
  // Outside apps/backend so bunfig's test preload cannot load .env.test and swap the database
  // name. The child is `bun <file>`, the same shape as the pool-of-one probe, which still
  // returned output in the full suite after `bun -e` and a stripped env had started exiting 9
  // with empty pipes (2026-10-02, three full runs). Stdout and stderr go to files so a broken
  // pipe capture cannot hide the guard's message. The clock is refreshed first: a timed
  // spawnSync whose previous spawn is older than `timeout` is killed at once on this runtime.
  const dir = mkdtempSync(join(tmpdir(), "homigo-guard-"));
  const file = join(dir, "construct.ts");
  const outFile = join(dir, "out.txt");
  const errFile = join(dir, "err.txt");
  writeFileSync(
    file,
    `const m = await import(${JSON.stringify(PRISMA_BASE)});\nconsole.log(m.prismaBase ? "CONSTRUCTED" : "NONE");\n`,
  );
  const outFd = openSync(outFile, "w");
  const errFd = openSync(errFile, "w");
  await freshLoopClock();
  const r = spawnSync(process.execPath, [file], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      DATABASE_URL: `postgresql://probe:probe@127.0.0.1:1/${database}`,
    },
    stdio: ["ignore", outFd, errFd],
    timeout: 20_000,
  });
  closeSync(outFd);
  closeSync(errFd);
  const out = readFileSync(outFile, "utf8");
  const err = `${readFileSync(errFile, "utf8")}${r.error ? `\n${r.error.message}` : ""}`;
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, signal: r.signal, out, err };
}

function childDetail(r: { code: number | null; signal: unknown; out: string; err: string }): string {
  return `exit=${r.code} signal=${r.signal ?? "none"} stdout=${JSON.stringify(r.out)} stderr=${JSON.stringify(r.err)}`;
}

describe("live-database guard (prisma-base)", () => {
  test("NODE_ENV=test + the live database name → refuses to construct a client", async () => {
    const r = await construct("test", "homigo_db");
    expect(r.code, childDetail(r)).not.toBe(0);
    expect(r.err, childDetail(r)).toContain("REFUSING TO CONSTRUCT A PRISMA CLIENT");
    expect(r.err).toContain('"homigo_db"');
    expect(r.out).not.toContain("CONSTRUCTED");
  }, 30_000);

  test("NODE_ENV=test + an isolated test database → constructs", async () => {
    const r = await construct("test", "homigo_test");
    expect(r.err, childDetail(r)).not.toContain("REFUSING");
    expect(r.out, childDetail(r)).toContain("CONSTRUCTED");
    expect(r.code, childDetail(r)).toBe(0);
  }, 30_000);

  test("outside test mode the guard does not apply (production uses its own target controls)", async () => {
    const r = await construct("production", "homigo_db");
    expect(r.err, childDetail(r)).not.toContain("REFUSING");
    expect(r.out, childDetail(r)).toContain("CONSTRUCTED");
  }, 30_000);
});

import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { freshLoopClock } from "../../src/__tests__/helpers/fresh-loop-clock";

/**
 * A checker that cannot fail is not a check. These cases plant the exact shapes the 2026-09-16
 * incident review found — a hardcoded live url, unguarded raw DDL — inside `scripts/`, run the real
 * checker as a subprocess, and assert it refuses. The planted files are removed afterwards.
 *
 * Run as a subprocess rather than by importing, because the checker's contract is its EXIT CODE:
 * that is what CI reads, and an import-time assertion would not prove the process fails.
 */
const SCRIPTS = join(import.meta.dir, "..");
const planted: string[] = [];

function plant(name: string, source: string): void {
  const p = join(SCRIPTS, name);
  writeFileSync(p, source);
  planted.push(p);
}

/**
 * Each case spawns a fresh `bun run` (~0.5 s alone). Under the full suite a cold child start has
 * exceeded 5 s — bun's DEFAULT per-test timeout, which applies because `[test] timeout` in
 * bunfig.toml is not honoured by bun 1.3.x (probed: a 6 s test fails at 5000 ms). At that deadline
 * bun kills the child ("killed 1 dangling process") and spawnSync returns empty output, which read
 * as "checker did not print OK". The budget below bounds the CHILD itself, so a genuinely hung
 * checker still fails — with a clear message — instead of being killed silently by the harness.
 */
const CHECKER_BUDGET_MS = 60_000;
const TEST_TIMEOUT_MS = CHECKER_BUDGET_MS + 10_000;

async function runChecker(): Promise<{ status: number; output: string }> {
  // Root cause of the intermittent full-suite SIGTERM (see helpers/fresh-loop-clock): spawnSync's own
  // clock was last refreshed by a spawn in an earlier test file, so the 60 s budget expired at once.
  await freshLoopClock();
  const started = performance.now();
  const wallStart = Date.now();
  // The runner's own binary, not whatever "bun" resolves to on PATH (an npm .cmd shim on some machines).
  const r = spawnSync(process.execPath, ["run", join(SCRIPTS, "check-ddl-guard-coverage.ts")], {
    encoding: "utf8",
    cwd: join(SCRIPTS, ".."),
    timeout: CHECKER_BUDGET_MS,
  });
  const ms = Math.round(performance.now() - started);
  const wallMs = Date.now() - wallStart;
  console.log(`[ddl-guard-test] checker pid=${r.pid ?? "-"} exit=${r.status} signal=${r.signal ?? "-"} in ${ms}ms (wall ${wallMs}ms)`);
  if (r.error || r.signal) {
    // Seen in full runs only (SIGTERM after 12.2 s on 09-30; ETIMEDOUT in 20 ms and 59 ms on 10-01)
    // against this 60 s budget: the stale spawnSync clock that freshLoopClock() now refreshes. Kept so
    // any recurrence says whether the kill came before the budget (the clock) or at it (a slow child).
    const byBudget = r.error?.message?.includes("ETIMEDOUT") || ms >= CHECKER_BUDGET_MS - 1_000;
    console.log(
      `[ddl-guard-test] FORENSIC byBudget=${byBudget} error=${r.error?.message ?? "-"} ` +
        `stdout=${JSON.stringify((r.stdout ?? "").slice(-400))} stderr=${JSON.stringify((r.stderr ?? "").slice(-400))}`,
    );
    throw new Error(
      `checker ${byBudget ? `exceeded its ${CHECKER_BUDGET_MS}ms budget` : `was terminated after ${ms}ms, inside its ${CHECKER_BUDGET_MS}ms budget`} ` +
        `(${r.signal ?? r.error?.message})`,
    );
  }
  return { status: r.status ?? -1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

afterAll(() => {
  for (const p of planted) rmSync(p, { force: true });
});

describe("check-ddl-guard-coverage", () => {
  it("passes on the repository as it stands", async () => {
    const { status, output } = await runChecker();
    expect(output).toContain("OK");
    expect(status).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("REFUSES a script that hardcodes a live database url (the apply-*-dev.ts shape)", async () => {
    plant(
      "zz-planted-hardcoded-live.ts",
      `import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({
  datasources: { db: { url: "postgresql://postgres:homigo_dev@localhost:5433/homigo_db" } },
});
await prisma.$disconnect();
`,
    );
    const { status, output } = await runChecker();
    expect(status).toBe(1);
    expect(output).toContain("zz-planted-hardcoded-live.ts");
    expect(output).toContain("homigo_db");
    rmSync(join(SCRIPTS, "zz-planted-hardcoded-live.ts"), { force: true });
  }, TEST_TIMEOUT_MS);

  it("REFUSES a script that runs raw DDL without the guard, even on an inherited url", async () => {
    plant(
      "zz-planted-unguarded-ddl.ts",
      `import prisma from "../src/lib/prisma";
await prisma.$executeRawUnsafe(\`ALTER TABLE "withdrawals" DROP COLUMN "idempotency_key"\`);
await prisma.$disconnect();
`,
    );
    const { status, output } = await runChecker();
    expect(status).toBe(1);
    expect(output).toContain("zz-planted-unguarded-ddl.ts");
    expect(output).toContain("raw DDL");
    rmSync(join(SCRIPTS, "zz-planted-unguarded-ddl.ts"), { force: true });
  }, TEST_TIMEOUT_MS);

  it("ACCEPTS the same DDL once the script states its target", async () => {
    plant(
      "zz-planted-guarded-ddl.ts",
      `import prisma from "../src/lib/prisma";
import { assertDdlTarget } from "../src/lib/ddl-target-guard";
assertDdlTarget("test");
await prisma.$executeRawUnsafe(\`ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "x" TEXT\`);
await prisma.$disconnect();
`,
    );
    const { status, output } = await runChecker();
    expect(output).toContain("OK");
    expect(status).toBe(0);
    rmSync(join(SCRIPTS, "zz-planted-guarded-ddl.ts"), { force: true });
  }, TEST_TIMEOUT_MS);

  it("does not flag a placeholder url inside an error message", async () => {
    plant(
      "zz-planted-placeholder.ts",
      `export function parse(url: string) {
  const m = url.match(/^postgres(?:ql)?:\\/\\/([^:]+):([^@]+)@([^:/]+):(\\d+)\\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL must be postgresql://user:pass@host:port/db");
  return m;
}
`,
    );
    const { status, output } = await runChecker();
    expect(output).toContain("OK");
    expect(status).toBe(0);
    rmSync(join(SCRIPTS, "zz-planted-placeholder.ts"), { force: true });
  }, TEST_TIMEOUT_MS);
});

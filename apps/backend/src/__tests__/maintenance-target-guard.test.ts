/**
 * Autonomous maintenance must never run against a live database merely because `.env` points there.
 *
 * Pure decisions use the REAL dotenv files, loaded as a watch-mode dev server loads them. The behavioural
 * case starts the real scheduler with a live-shaped DATABASE_URL (the Prisma client in this process is
 * already bound to homigo_test, so nothing can reach another database) and checks, by spying on the
 * autonomous jobs, that none of them runs.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { maintenanceWriteDecision } from "../lib/maintenance-target-guard";

const dir = resolve(import.meta.dir, "../..");
const load = (name: string): Record<string, string> => {
  const p = resolve(dir, name);
  return existsSync(p) ? parse(readFileSync(p)) : {};
};
const devServerEnv = () => ({ ...load(".env"), ...load(".env.local") });
const PROD_URL = "postgresql://u:p@db.internal:5432/homigo_db";

describe("maintenance target guard — decisions", () => {
  test("a dev server loaded from .env / .env.local does not maintain the live database", () => {
    const d = maintenanceWriteDecision(devServerEnv());
    expect(d).toMatchObject({ enabled: false, reason: "NON_PRODUCTION_RUNTIME", degradeBoot: false });
    expect(d.target).toMatch(/\/homigo_db$/);
  });

  test("the test configuration may maintain the test database", () => {
    expect(maintenanceWriteDecision(load(".env.test"))).toMatchObject({ enabled: true, reason: "TEST_TARGET" });
  });

  test("production needs an authorization naming this exact database; without it the boot is degraded", () => {
    expect(maintenanceWriteDecision({ NODE_ENV: "production", DATABASE_URL: PROD_URL })).toMatchObject({
      enabled: false, reason: "TARGET_NOT_AUTHORIZED", degradeBoot: true,
    });
    expect(maintenanceWriteDecision({ NODE_ENV: "production", DATABASE_URL: PROD_URL, MAINTENANCE_AUTHORIZED_TARGET: "db.internal:5432/homigo_db" })).toMatchObject({
      enabled: true, reason: "AUTHORIZED_TARGET",
    });
  });

  test("an authorization for another target fails closed", () => {
    for (const wrong of ["db.internal:5432/homigo_staging_db", "other:5432/homigo_db", "db.internal:5433/homigo_db", ""]) {
      expect(maintenanceWriteDecision({ NODE_ENV: "production", DATABASE_URL: PROD_URL, MAINTENANCE_AUTHORIZED_TARGET: wrong }).enabled).toBe(false);
    }
  });

  test("a non-production runtime maintains only a target it explicitly opted into", () => {
    const staging = load(".env.staging");
    expect(maintenanceWriteDecision(staging).enabled).toBe(false);
    const dev = devServerEnv();
    // Opting into a DIFFERENT target does not enable the one in DATABASE_URL.
    expect(maintenanceWriteDecision({ ...dev, MAINTENANCE_LOCAL_OPT_IN_TARGET: "localhost:5434/homigo_staging_db" }).enabled).toBe(false);
  });

  test("an unreadable target fails closed (and degrades a production boot)", () => {
    for (const bad of [undefined, "", "nonsense", "mysql://h/homigo_test"]) {
      expect(maintenanceWriteDecision({ DATABASE_URL: bad }).enabled).toBe(false);
      expect(maintenanceWriteDecision({ NODE_ENV: "production", DATABASE_URL: bad }).degradeBoot).toBe(true);
    }
  });
});

describe("maintenance target guard — the real scheduler", () => {
  /**
   * Runs in a child process: starting the real scheduler registers process-wide state (workflow
   * bootstrap, an outbox processor started after an async bootstrap, boot-health marks) that
   * `stopMaintenance` cannot fully undo, and that once leaked into later suites of the same run.
   */
  async function probe(guardUrl: string) {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "helpers/maintenance-probe.ts"), guardUrl], {
      cwd: dir,
      env: { ...process.env, NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read both pipes while the child runs. Waiting on stdout alone deadlocks once stderr
    // fills the OS pipe: the child blocks in a log write and never reaches the PROBE line.
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const line = out.split(/\r?\n/).find((l) => l.startsWith("PROBE "));
    if (!line) {
      throw new Error(`probe produced no result (exit ${code}): stdout=${out.slice(-400)} stderr=${err.slice(-800)}`);
    }
    return JSON.parse(line.slice(6)) as { boundTo: string; calls: Record<string, number> };
  }

  /**
   * The database under test is whatever DATABASE_URL resolves to after load-env (homigo_test, a
   * CI-generated database, a migrations-only clone) — never a hard-coded name, which previously made
   * both cases below fail on any other isolated database. It must end in `_test`: that is the
   * isolation convention the guard enforces, so a run on a database that does not satisfy it is a
   * setup error, not a pass.
   */
  const effectiveTestUrl = process.env.DATABASE_URL!;
  const effectiveTestDb = effectiveTestUrl.split("/").pop()!.split("?")[0]!;

  test("the database under test satisfies the isolation convention", () => {
    expect(effectiveTestDb).toMatch(/_test$/);
  });

  // Isolated, each probe finishes in about 5s. In the 2026-10-02 full suite the positive
  // control needed 48s (database already loaded by the files before this one) and the case
  // above was killed at 60s before it could print PROBE, so the assertion never ran. 120s is
  // the budget for that measured boot, not a pause to absorb a hang: a child that never exits
  // still fails here.
  test("started against a live-shaped target in development, it runs no autonomous job", async () => {
    const r = await probe(devServerEnv().DATABASE_URL!);
    expect(r.boundTo).toBe(effectiveTestDb);
    expect(Object.values(r.calls).every((n) => n === 0)).toBe(true);
  }, 120_000);

  test("positive control: against the test target the same scheduler DOES run them", async () => {
    const r = await probe(effectiveTestUrl);
    expect(r.boundTo).toBe(effectiveTestDb);
    expect(r.calls.financial_integrity + r.calls.payment_reconciliation + r.calls.refund_retry).toBeGreaterThan(0);
  }, 120_000);
});

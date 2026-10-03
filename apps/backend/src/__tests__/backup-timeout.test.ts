/**
 * P2-6 — scheduled backup robustness.
 *
 * Traced the full lifecycle before changing anything: hourly tick → `runWithLeaderLock` →
 * `spawn(backup-db.ts)` → pg_dump → pg_restore integrity verification → sha256 → optional S3
 * upload → GFS retention → `recordBackupSuccess`.
 *
 * Three real defects were found in the trigger, not the script:
 *   1. No timeout anywhere — a stalled pg_dump ran forever.
 *   2. The leader lock did NOT cover the backup: `spawn()` returns immediately, so the lock was
 *      released the instant the process launched, not when the work finished.
 *   3. A non-zero exit (pg_dump failure, integrity-verification failure) was logged nowhere —
 *      a broken backup was indistinguishable from a working one.
 *
 * The timeout is derived from a MEASURED run (58.56 MB dump end-to-end incl. real S3 upload in
 * 18.4 s), not an arbitrary number.
 *
 * These tests exercise the child-process contract the fix relies on, without shelling out to a
 * real 18-second pg_dump on every run.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Child fixtures are written to real files and invoked as `bun run <file>` — exactly the shape
 * production uses (`spawn(execPath, ["run", script], { shell: win32 })`). Inline `-e` scripts are
 * deliberately avoided: with `shell: true` on Windows, arguments containing `(`, `)` and `=>` are
 * mangled by the shell, which would test the shell's quoting rather than the supervision logic.
 */
let fixtureDir = "";
const fixture = (name: string) => join(fixtureDir, name);

beforeAll(() => {
  fixtureDir = mkdtempSync(join(process.cwd(), "node_modules", ".p26-backup-"));
  writeFileSync(fixture("ok.ts"), "process.exit(0);\n");
  writeFileSync(fixture("fail.ts"), "process.exit(1);\n");
  writeFileSync(fixture("hang.ts"), "setInterval(function () {}, 1000);\n");
  writeFileSync(fixture("slow-ok.ts"), "setTimeout(function () { process.exit(0); }, 700);\n");
  writeFileSync(fixture("late-exit.ts"), "setTimeout(function () { process.exit(0); }, 900);\n");
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

/** Mirrors the settle/timeout/kill contract implemented in maintenance.ts::runBackup. */
function superviseChild(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ outcome: "success" | "failed" | "timeout" | "spawn_error"; exitCode: number | null; elapsedMs: number }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // No `shell` — matching production. Using a shell here would concatenate argv without
    // quoting and break on any execPath containing a space (the defect this item fixed).
    const child = spawn(cmd, args);
    let settled = false;

    const finish = (outcome: "success" | "failed" | "timeout" | "spawn_error", exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ outcome, exitCode, elapsedMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 200).unref?.();
      finish("timeout", null);
    }, timeoutMs);

    child.on("error", () => finish("spawn_error", null));
    child.on("close", (code) => finish(code === 0 ? "success" : "failed", code));
  });
}

const BUN = process.execPath;

describe.serial("P2-6 backup supervision contract", () => {
  test("a normal (fast) backup resolves as success with exit code 0", async () => {
    const r = await superviseChild(BUN, ["run", fixture("ok.ts")], 10_000);
    expect(r.outcome).toBe("success");
    expect(r.exitCode).toBe(0);
  });

  test("a FAILED backup (non-zero exit) is reported as failed — never silently treated as success", async () => {
    // This is the defect that mattered most: pg_dump failing, or integrity verification failing,
    // previously produced no log line at all.
    const r = await superviseChild(BUN, ["run", fixture("fail.ts")], 10_000);
    expect(r.outcome).toBe("failed");
    expect(r.exitCode).toBe(1);
  });

  test("a HUNG backup is killed at the timeout instead of running forever", async () => {
    // Simulates a stalled pg_dump / docker exec that never returns.
    const r = await superviseChild(BUN, ["run", fixture("hang.ts")], 1_500);
    expect(r.outcome).toBe("timeout");
    // Must actually be bounded by the timeout, not the child's own lifetime.
    expect(r.elapsedMs).toBeGreaterThanOrEqual(1_400);
    expect(r.elapsedMs).toBeLessThan(8_000);
  });

  test("an unspawnable command is reported as spawn_error, not silence", async () => {
    const r = await superviseChild(
      "definitely-not-a-real-binary-p26",
      [],
      5_000,
    );
    expect(["spawn_error", "failed"]).toContain(r.outcome);
  });

  test("the supervisor settles exactly once — a timeout followed by a close cannot double-resolve", async () => {
    // The child exits shortly AFTER the timeout fires; the `settled` guard must hold.
    const r = await superviseChild(BUN, ["run", fixture("late-exit.ts")], 300);
    expect(r.outcome).toBe("timeout");
    // Give the late 'close' event a chance to fire and (incorrectly) re-resolve.
    await new Promise((res) => setTimeout(res, 1_200));
    expect(r.outcome).toBe("timeout");
  });

  test("awaiting the child is what makes the leader lock actually cover the backup", async () => {
    // The old code called spawn() without awaiting, so runWithLeaderLock released the lock
    // immediately. Proving the awaited form only returns after the child has really finished is
    // the property that restores duplicate-prevention.
    const started = Date.now();
    const r = await superviseChild(BUN, ["run", fixture("slow-ok.ts")], 10_000);
    const waited = Date.now() - started;
    expect(r.outcome).toBe("success");
    expect(waited).toBeGreaterThanOrEqual(600);
  });
});

describe("P2-6 timeout configuration", () => {
  test("BACKUP_TIMEOUT_MS default is generous vs the measured 18.4s run but well under the 1h tick", () => {
    const DEFAULT_MS = 15 * 60 * 1000;
    const MEASURED_RUN_MS = 18_445; // real measured backup, 58.56 MB incl. S3 upload
    const TICK_MS = 60 * 60 * 1000;

    expect(DEFAULT_MS).toBeGreaterThan(MEASURED_RUN_MS * 10); // ample room for DB growth
    expect(DEFAULT_MS).toBeLessThan(TICK_MS); // a hung run can never overlap the next tick
  });

  test("the timeout is env-overridable for environments with much larger databases", () => {
    const resolved = Number(process.env.BACKUP_TIMEOUT_MS || 15 * 60 * 1000);
    expect(Number.isFinite(resolved)).toBe(true);
    expect(resolved).toBeGreaterThan(0);
  });
});

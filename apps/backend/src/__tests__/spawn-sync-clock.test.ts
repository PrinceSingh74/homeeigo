import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { freshLoopClock } from "./helpers/fresh-loop-clock";

/**
 * The clock helper must keep a timed child alive when the previous spawnSync is older than the timeout
 * — the state every timed child in the full suite starts from (the previous spawn was files ago).
 *
 * A kill is only the defect when it lands BEFORE the budget: the stale-clock kill arrives in ~10 ms,
 * a genuinely slow child is killed at the budget. Asserting on that distinction keeps this test honest
 * on a loaded machine, where a cold child start can be slow.
 */
const BUDGET_MS = 3_000;
const IDLE_MS = 3_600; // longer than the budget, so a stale clock puts the deadline in the past
const CHILD = ["-e", "console.log('ok')"];
const idle = () => new Promise<void>((resolve) => setTimeout(resolve, IDLE_MS));

type Outcome = { killed: boolean; ms: number; ok: boolean };

function timedNodeSpawn(): Outcome {
  const started = performance.now();
  const r = spawnSync(process.execPath, CHILD, { encoding: "utf8", timeout: BUDGET_MS });
  return { killed: Boolean(r.signal || r.error), ms: Math.round(performance.now() - started), ok: r.status === 0 };
}

function timedBunSpawn(): Outcome {
  const started = performance.now();
  const r = Bun.spawnSync([process.execPath, ...CHILD], { timeout: BUDGET_MS });
  return { killed: Boolean(r.signalCode), ms: Math.round(performance.now() - started), ok: r.exitCode === 0 };
}

const killedEarly = (o: Outcome) => o.killed && o.ms < BUDGET_MS / 2;

describe("timed spawnSync after an idle stretch longer than its timeout", () => {
  test("control: reports whether this runtime still kills an unprimed timed child", async () => {
    spawnSync(process.execPath, CHILD, { encoding: "utf8" });
    await idle();
    const raw = timedNodeSpawn();
    // Informational, deliberately not asserted: the defect belongs to the runtime, and a runtime that
    // fixes it must not fail this suite. When this stops printing "PRESENT" the workaround can be retired.
    console.log(`[spawn-sync-clock] runtime defect ${killedEarly(raw) ? "PRESENT" : "absent"} — unprimed child ${raw.killed ? "killed" : "ok"} in ${raw.ms} ms (budget ${BUDGET_MS} ms)`);
  }, 30_000);

  test("node spawnSync survives once the clock is refreshed", async () => {
    await idle();
    await freshLoopClock();
    const o = timedNodeSpawn();
    expect(killedEarly(o)).toBe(false);
    expect(o.ok || o.ms >= BUDGET_MS / 2).toBe(true);
  }, 30_000);

  test("Bun.spawnSync survives once the clock is refreshed", async () => {
    await idle();
    await freshLoopClock();
    const o = timedBunSpawn();
    expect(killedEarly(o)).toBe(false);
    expect(o.ok || o.ms >= BUDGET_MS / 2).toBe(true);
  }, 30_000);
});

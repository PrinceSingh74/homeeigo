/**
 * Dispatch and accept must never need a second connection while a transaction is open.
 *
 * Runs tx-pool-of-one.child.test.ts in a child `bun test` whose DATABASE_URL is the test database
 * with connection_limit=1 (see that file for why one connection makes the defect deterministic).
 * The child's URL is derived from this process's own test URL, and load-env keeps an injected URL
 * only when it names a *test* database — the child cannot reach anything else.
 */
import "../load-env";
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { freshLoopClock } from "./helpers/fresh-loop-clock";

function poolOfOneUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const db = url.pathname.replace(/^\//, "");
  if (!/test/i.test(db)) throw new Error("refusing: this process is not on a test database");
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "8");
  return url.toString();
}

describe("transactions never wait on a second connection", () => {
  test("dispatch + accept complete on a pool of one connection", async () => {
    await freshLoopClock(); // a stale loop clock would expire the child's timeout at once
    const child = path.join(import.meta.dir, "tx-pool-of-one.child.test.ts");
    const run = spawnSync(process.execPath, ["test", "--timeout", "120000", child], {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: poolOfOneUrl(), TX_POOL_OF_ONE_PROBE: "1" },
      encoding: "utf8",
      timeout: 400_000,
    });
    const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const failed = out.split("\n").filter((l) => l.startsWith("(fail)"));
    const errors = out
      .split("\n")
      .filter((l) => /Timed out fetching a new connection|Unable to start a transaction|P2024|P2028|error:/.test(l))
      .slice(0, 6)
      .map((l) => l.replace(/postgres(ql)?:\/\/\S+/g, "<db url>").slice(0, 240));
    expect({ failed, errors }).toEqual({ failed: [], errors: [] });
    // Positive control: both probes ran (a skipped child would otherwise pass vacuously).
    expect(out).toMatch(/\b2 pass\b/);
    expect(run.status).toBe(0);
  }, 420_000);
});

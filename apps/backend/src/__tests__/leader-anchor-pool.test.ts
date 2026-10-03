/**
 * Leader-lock anchors must not consume the request pool (2026-10-01).
 *
 * Each exclusive job's Postgres anchor holds one connection open for the whole run. Taken from the
 * request pool, nine exclusive jobs on a pool of 5 pinned every connection while the jobs' own queries
 * waited for one — a boot deadlock (/ready 503 for 30 s). Anchors now live on a dedicated pool.
 *
 * Runs on the isolated test DB, whose request pool is connection_limit=5 (.env.test), i.e. SMALLER
 * than the number of exclusive jobs — the exact starvation condition.
 */
import { afterAll, describe, expect, it } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { disconnectLeaderAnchors, runWithLeaderLock } from "../lib/distributed-scheduler";
import { prismaPoolConfigFromUrl } from "../lib/database-url";

const RUN = `anchor-${Date.now().toString(36)}`;
const EXCLUSIVE_JOBS = 9;

afterAll(async () => {
  await disconnectLeaderAnchors();
});

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

async function advisoryLocksHeldFor(keys: string[]): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.granted
      AND l.objid::bigint IN (SELECT (hashtext(k) & x'ffffffff'::bigint) FROM unnest(${keys.map((k) => "leader:" + k)}::text[]) AS k)
  `;
  return Number(rows[0]?.n ?? 0);
}

describe("leader-lock anchors use their own pool", () => {
  it("the request pool is smaller than the number of exclusive jobs (the starvation condition)", () => {
    expect(prismaPoolConfigFromUrl().connectionLimit).toBeLessThan(EXCLUSIVE_JOBS);
  });

  it(`${EXCLUSIVE_JOBS} exclusive jobs hold anchors at once while their own queries AND ordinary traffic still run`, async () => {
    const keys = Array.from({ length: EXCLUSIVE_JOBS }, (_, i) => `${RUN}-job-${i}`);
    const allEntered = gate();
    const release = gate();
    let entered = 0;
    const bodyQueryMs: number[] = [];

    const runs = keys.map((key) =>
      runWithLeaderLock(
        key,
        30,
        async () => {
          // The job's own work goes through the request client, as production jobs do.
          const t0 = performance.now();
          await prisma.$queryRaw`SELECT 1`;
          bodyQueryMs.push(performance.now() - t0);
          if (++entered === EXCLUSIVE_JOBS) allEntered.open();
          await release.opened;
        },
        { exclusive: true },
      ),
    );

    await Promise.race([
      allEntered.opened,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`only ${entered}/${EXCLUSIVE_JOBS} jobs got past their anchor`)), 20_000)),
    ]);
    expect(await advisoryLocksHeldFor(keys)).toBe(EXCLUSIVE_JOBS);

    // Ordinary request traffic while every anchor is held: must not wait on the anchors.
    const t0 = performance.now();
    await Promise.all([
      ...Array.from({ length: 10 }, () => prisma.$queryRaw`SELECT 1`),
      prisma.$transaction(async (tx) => tx.$queryRaw`SELECT 1`),
    ]);
    const trafficMs = performance.now() - t0;
    expect(trafficMs).toBeLessThan(3_000);
    expect(Math.max(...bodyQueryMs)).toBeLessThan(3_000);

    release.open();
    expect(await Promise.all(runs)).toEqual(Array(EXCLUSIVE_JOBS).fill(true));
    expect(await advisoryLocksHeldFor(keys)).toBe(0);
  }, 60_000);

  it("exclusivity is unchanged: a second run of a held key does not execute", async () => {
    const key = `${RUN}-single`;
    const release = gate();
    const inside = gate();
    let executions = 0;
    const first = runWithLeaderLock(
      key,
      30,
      async () => {
        executions++;
        inside.open();
        await release.opened;
      },
      { exclusive: true },
    );
    await inside.opened;
    const second = await runWithLeaderLock(key, 30, async () => {
      executions++;
    }, { exclusive: true });
    release.open();
    expect(await first).toBe(true);
    expect(second).toBe(false);
    expect(executions).toBe(1);
  }, 30_000);

  it("a job that throws still releases its anchor; the next run acquires it", async () => {
    const key = `${RUN}-throws`;
    expect(await runWithLeaderLock(key, 30, async () => {
      throw new Error("job failed on purpose");
    }, { exclusive: true })).toBe(true);
    expect(await advisoryLocksHeldFor([key])).toBe(0);
    let ran = false;
    expect(await runWithLeaderLock(key, 30, async () => {
      ran = true;
    }, { exclusive: true })).toBe(true);
    expect(ran).toBe(true);
  }, 30_000);
});

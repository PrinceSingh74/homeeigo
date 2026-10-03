/**
 * SECTION 7E — one scheduled-job WORKER, as a separate process.
 *
 *   DATABASE_URL=... REDIS_URL=... bun run scripts/chaos/7e-job-worker.ts \
 *     --run <runId> --duration <ms> [--tick <ms>]
 *
 * Runs the real `processScheduledJobBatch()` in a loop against the real claim query, with a handler
 * registered for this run's job type. Every handler invocation writes a marker row naming the job id,
 * the process and the attempt number, so "exactly once" is decided by counting owners of each job
 * across two processes — not by trusting that `FOR UPDATE SKIP LOCKED` does what it says.
 *
 * Two processes are the point. A single process cannot double-claim a row it has already moved out of
 * `pending`, so a one-process test of an exactly-once claim proves nothing.
 */
import { assertChaosTargetIsolated } from "../../src/lib/chaos-isolation";

assertChaosTargetIsolated("7E job worker");

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--")) return argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};

const RUN = arg("run");
const DURATION_MS = Number(arg("duration", "15000"));
const TICK_MS = Number(arg("tick", "150"));
/** Simulated per-job work, so the two workers are genuinely in flight at the same time. */
const WORK_MS = Number(arg("work", "15"));

const prisma = (await import("../../src/lib/prisma")).default;
const { redisClient } = await import("../../src/lib/redis");
const { registerJobHandler } = await import("../../src/events/core/job-registry");
const { processScheduledJobBatch } = await import("../../src/events/core/job-processor");

await Promise.race([redisClient.connect(), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});

const JOB_TYPE = `7e-probe-${RUN}`;
const MARKER_TYPE = `7e-${RUN}`;
let invocations = 0;

registerJobHandler({
  jobType: JOB_TYPE,
  /** Opted out of the staleness guard so a seeded `runAt` can never be skipped as "too late". */
  maxStalenessMs: null,
  handler: async (_payload, ctx) => {
    invocations++;
    // Real jobs do work. An instant handler lets one worker drain a whole batch inside another
    // worker's tick interval, so both workers never overlap and the exactly-once claim is never
    // actually contended.
    if (WORK_MS > 0) await new Promise((r) => setTimeout(r, WORK_MS));
    await prisma.scheduledJob.create({
      data: {
        jobType: MARKER_TYPE,
        runAt: new Date(),
        status: "completed",
        completedAt: new Date(),
        payload: {
          run: RUN,
          phase: "invoked",
          pid: process.pid,
          at: Date.now(),
          jobId: ctx.jobId,
          attempt: ctx.attempt,
        },
      },
    });
  },
});

console.log(`[worker] pid=${process.pid} handling ${JOB_TYPE} for ${DURATION_MS}ms`);

const deadline = Date.now() + DURATION_MS;
let claimed = 0;
let recovered = 0;
while (Date.now() < deadline) {
  const res = await processScheduledJobBatch();
  claimed += res.claimed;
  recovered += res.recovered;
  await new Promise((r) => setTimeout(r, TICK_MS));
}

await prisma.scheduledJob.create({
  data: {
    jobType: MARKER_TYPE,
    runAt: new Date(),
    status: "completed",
    completedAt: new Date(),
    payload: { run: RUN, phase: "summary", pid: process.pid, at: Date.now(), invocations, claimed, recovered },
  },
});

console.log(`[worker] pid=${process.pid} invocations=${invocations} claimed=${claimed} recovered=${recovered}`);
await prisma.$disconnect();
await Promise.race([redisClient.disconnect().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
process.exit(0);

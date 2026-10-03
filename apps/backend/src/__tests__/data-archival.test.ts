/**
 * P1-7 — data archival robustness: real-DB prune correctness.
 *
 * Investigation found the original P0 discovery claim ("no try/catch, unhandled rejection") was
 * WRONG — `runDataArchival()` in maintenance.ts is wrapped by `runWithLeaderLock`, which already
 * has its own try/catch/finally (verified by direct read of distributed-scheduler.ts) — the exact
 * same pattern used by 6+ other jobs in the same file with no inner try/catch of their own. No
 * unhandled-rejection risk existed. The REAL gap, found by tracing every persistence operation:
 * `runArchival()` pruned appLogEntry then notification SEQUENTIALLY with a single try — a failure
 * pruning the first silently aborted the second (an unrelated model) for a full 24h with no
 * record, and `pruneInBatches`'s local `total` was discarded entirely on a mid-loop batch failure
 * even though those batches' deletes had already committed. Fixed: each model prunes
 * independently (one's failure doesn't block the other), and partial progress within a model's
 * batch loop is preserved and reported via `PartialPruneError` instead of being silently lost.
 * Failure-injection coverage for that fix is in `data-archival-failure-injection.test.ts` (needs
 * `mock.module` on the whole `../lib/prisma` import, so it runs as its own file/process — see
 * that file's header for why `spyOn(prisma.model, "method")` doesn't work against the real,
 * `$extends()`-wrapped Prisma client used in this codebase).
 *
 * Also confirms, but does not fix (flagged separately, out of this item's scope): this pipeline
 * performs irreversible hard-deletion with no cold-storage/backup step, despite `getStrategy()`
 * describing one ("S3 archive via backup-db.ts").
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { dbReachable, prisma } from "./helpers/adversarial-fixtures";
import { dataArchivalService } from "../services/data-archival.service";

let dbOk = false;
const RUN_ID = `p17-${Date.now().toString(36)}`;

beforeAll(async () => {
  dbOk = await dbReachable();
});

afterAll(async () => {
  if (dbOk) {
    await prisma.appLogEntry.deleteMany({ where: { message: { contains: RUN_ID } } });
    await prisma.notification.deleteMany({ where: { title: { contains: RUN_ID } } });
  }
}, 30_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

const OLD = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // well past any retention window
const RECENT = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

describe.serial("P1-7 — data archival: real prune correctness", () => {
  test("prunes old rows past retention, keeps recent rows, for both models independently", async () => {
    if (skipIfNoDb()) return;

    await prisma.appLogEntry.createMany({
      data: [
        { level: "info", message: `${RUN_ID}-old-1`, createdAt: OLD },
        { level: "info", message: `${RUN_ID}-old-2`, createdAt: OLD },
        { level: "info", message: `${RUN_ID}-recent`, createdAt: RECENT },
      ],
    });
    await prisma.notification.createMany({
      data: [
        { title: `${RUN_ID}-old-archived`, message: "x", type: "test", isArchived: true, createdAt: OLD },
        { title: `${RUN_ID}-old-not-archived`, message: "x", type: "test", isArchived: false, createdAt: OLD },
        { title: `${RUN_ID}-recent-archived`, message: "x", type: "test", isArchived: true, createdAt: RECENT },
      ],
    });

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors).toBeUndefined();
    expect(result.appLogsPruned).toBeGreaterThanOrEqual(2);
    expect(result.notificationsPruned).toBeGreaterThanOrEqual(1); // only the archived+old one

    const remainingLogs = await prisma.appLogEntry.findMany({ where: { message: { contains: RUN_ID } } });
    expect(remainingLogs.map((l) => l.message)).toEqual([`${RUN_ID}-recent`]);

    const remainingNotifs = await prisma.notification.findMany({ where: { title: { contains: RUN_ID } } });
    const titles = remainingNotifs.map((n) => n.title).sort();
    // old-not-archived survives (isArchived filter), recent-archived survives (too new).
    expect(titles).toEqual([`${RUN_ID}-old-not-archived`, `${RUN_ID}-recent-archived`].sort());
  });
});

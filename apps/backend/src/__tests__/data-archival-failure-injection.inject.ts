/**
 * P1-7 — data archival: failure injection (mocked Prisma).
 *
 * `spyOn(prisma.appLogEntry, "findMany")` does not reliably intercept calls in this codebase's
 * real client — `lib/prisma.ts` builds it via `prismaBase.$extends(prismaPiiExtension())`, and the
 * extended client's model delegates aren't the same mutable object `spyOn` can durably patch (an
 * initial attempt confirmed this empirically: the spy's throw never fired, and "0 pruned" turned
 * out to just mean "no old rows left", not an intercepted failure). `mock.module` on the whole
 * `../lib/prisma` import — the same technique already proven reliable for the event-bus tests —
 * works because it replaces the module at import resolution, before `data-archival.service.ts`
 * ever sees the real client. `mock.module` is a process-global override in Bun, so this file must
 * run as its own `bun test` process, never combined with `data-archival.test.ts` in one invocation.
 * The `.inject.ts` suffix keeps it off the default `*.test.ts` glob.
 */
import "../load-env";
import { describe, test, expect, beforeEach, mock } from "bun:test";

const appLogEntryMock = {
  findMany: mock(async (_args: unknown) => [] as { id: string }[]),
  deleteMany: mock(async (_args: unknown) => ({ count: 0 })),
};
const notificationMock = {
  findMany: mock(async (_args: unknown) => [] as { id: string }[]),
  deleteMany: mock(async (_args: unknown) => ({ count: 0 })),
};

const prismaMock = { appLogEntry: appLogEntryMock, notification: notificationMock };

mock.module("../lib/prisma", () => ({ default: prismaMock, prisma: prismaMock }));

const { dataArchivalService, PartialPruneError } = await import("../services/data-archival.service");

describe("P1-7 — data archival failure injection", () => {
  beforeEach(() => {
    appLogEntryMock.findMany.mockReset();
    appLogEntryMock.findMany.mockImplementation(async () => []);
    appLogEntryMock.deleteMany.mockReset();
    appLogEntryMock.deleteMany.mockImplementation(async () => ({ count: 0 }));
    notificationMock.findMany.mockReset();
    notificationMock.findMany.mockImplementation(async () => []);
    notificationMock.deleteMany.mockReset();
    notificationMock.deleteMany.mockImplementation(async () => ({ count: 0 }));
  });

  test("a failure pruning appLogEntry does NOT block notification pruning (the core fix)", async () => {
    appLogEntryMock.findMany.mockImplementation(async () => {
      throw new Error("SIMULATED_DB_FAILURE");
    });
    notificationMock.findMany.mockImplementation(async () => [{ id: "n1" }]);
    notificationMock.deleteMany.mockImplementation(async () => ({ count: 1 }));

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors?.appLogEntry).toContain("SIMULATED_DB_FAILURE");
    expect(result.appLogsPruned).toBe(0);
    // The independent model must still have run and succeeded despite the other model's failure.
    expect(result.notificationsPruned).toBe(1);
    expect(notificationMock.deleteMany).toHaveBeenCalledTimes(1);
  });

  test("a mid-batch failure preserves the partial count instead of discarding it", async () => {
    let call = 0;
    appLogEntryMock.findMany.mockImplementation(async () => {
      call += 1;
      // A FULL batch (== BATCH_SIZE=500) is required to force a second loop iteration — a short
      // batch makes the loop stop after one page regardless, never reaching batch 2 at all. Batch
      // 1 succeeds (a full page); batch 2 throws — proves batch 1's already-committed count is
      // not silently lost when batch 2 fails.
      if (call === 1) return Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` }));
      throw new Error("SIMULATED_MID_BATCH_FAILURE");
    });
    appLogEntryMock.deleteMany.mockImplementation(async () => ({ count: 500 }));

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors?.appLogEntry).toContain("SIMULATED_MID_BATCH_FAILURE");
    // The 500 rows deleted in the successful first batch must still be counted, not zeroed out.
    expect(result.appLogsPruned).toBe(500);
    expect(call).toBe(2); // proves batch 2 really was attempted, not short-circuited
  });

  test("PartialPruneError carries the partial count as a first-class property", () => {
    const err = new PartialPruneError("boom", 42);
    expect(err.partialCount).toBe(42);
    expect(err.message).toBe("boom");
    expect(err).toBeInstanceOf(Error);
  });

  test("notification-side failure is isolated from appLogEntry success", async () => {
    appLogEntryMock.findMany.mockImplementation(async () => [{ id: "a1" }]);
    appLogEntryMock.deleteMany.mockImplementation(async () => ({ count: 1 }));
    notificationMock.findMany.mockImplementation(async () => {
      throw new Error("SIMULATED_NOTIFICATION_FAILURE");
    });

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors?.notification).toContain("SIMULATED_NOTIFICATION_FAILURE");
    expect(result.appLogsPruned).toBe(1); // unaffected by the other model's failure
    expect(result.notificationsPruned).toBe(0);
  });

  test("both models succeed: no errors field, run_total metric implies success", async () => {
    appLogEntryMock.findMany.mockImplementation(async () => []);
    notificationMock.findMany.mockImplementation(async () => []);

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors).toBeUndefined();
    expect(result.appLogsPruned).toBe(0);
    expect(result.notificationsPruned).toBe(0);
  });

  test("batching: keeps looping while a full batch is returned, stops on a short batch", async () => {
    let call = 0;
    appLogEntryMock.findMany.mockImplementation(async () => {
      call += 1;
      // BATCH_SIZE is 500 internally; return exactly that many to force a second loop iteration,
      // then an empty page to terminate — proves the loop itself (not just single-batch pruning)
      // is exercised and its total isn't reset between iterations.
      if (call === 1) return Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` }));
      if (call === 2) return Array.from({ length: 3 }, (_, i) => ({ id: `b${i}` }));
      return [];
    });
    appLogEntryMock.deleteMany.mockImplementation(async (args: unknown) => {
      const ids = (args as { where: { id: { in: string[] } } }).where.id.in;
      return { count: ids.length };
    });

    const result = await dataArchivalService.runArchival(90);

    expect(result.errors).toBeUndefined();
    expect(result.appLogsPruned).toBe(503);
    expect(appLogEntryMock.findMany).toHaveBeenCalledTimes(2);
  });
});

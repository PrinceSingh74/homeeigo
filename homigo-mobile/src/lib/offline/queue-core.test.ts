import { describe, expect, test } from "bun:test";
import {
  enqueueTo,
  isPermanentFailure,
  makeQueueId,
  readQueue,
  replayQueueWith,
  type QueueStorage,
  type QueuedRequest,
} from "./queue-core";

function memStorage(): QueueStorage & { dump: () => string | null } {
  let data: string | null = null;
  return {
    getItem: async () => data,
    setItem: async (_k, v) => {
      data = v;
    },
    dump: () => data,
  };
}

describe("queue-core", () => {
  test("makeQueueId produces unique ids", () => {
    const a = makeQueueId();
    const b = makeQueueId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  test("enqueue persists FIFO order", async () => {
    const storage = memStorage();
    await enqueueTo({ path: "/a", method: "POST", body: { n: 1 } }, storage);
    await enqueueTo({ path: "/b", method: "POST", body: { n: 2 } }, storage);
    const q = await readQueue(storage);
    expect(q).toHaveLength(2);
    expect(q[0].path).toBe("/a");
    expect(q[1].path).toBe("/b");
  });

  test("replay drains successful items", async () => {
    const storage = memStorage();
    const id = await enqueueTo({ path: "/ok", method: "POST" }, storage);
    const sent: string[] = [];
    const result = await replayQueueWith(async (item) => {
      sent.push(item.id);
    }, storage);
    expect(result.sent).toBe(1);
    expect(result.kept).toBe(0);
    expect(sent).toEqual([id]);
    expect(await readQueue(storage)).toHaveLength(0);
  });

  test("replay retries transient failures", async () => {
    const storage = memStorage();
    await enqueueTo({ path: "/retry", method: "POST" }, storage);
    let calls = 0;
    const r1 = await replayQueueWith(async () => {
      calls++;
      throw { status: 503 };
    }, storage);
    expect(r1.sent).toBe(0);
    expect(r1.kept).toBe(1);
    expect(calls).toBe(1);
    const r2 = await replayQueueWith(async () => {
      calls++;
    }, storage);
    expect(r2.sent).toBe(1);
    expect(calls).toBe(2);
  });

  test("replay drops permanent 4xx except idempotency in progress", async () => {
    expect(isPermanentFailure(409, "IDEMPOTENCY_IN_PROGRESS")).toBe(false);
    expect(isPermanentFailure(409, "OVERLAPPING_BOOKING")).toBe(true);
    expect(isPermanentFailure(422)).toBe(true);
    expect(isPermanentFailure(429)).toBe(false);

    const storage = memStorage();
    await enqueueTo({ path: "/bad", method: "POST" }, storage);
    const r = await replayQueueWith(async () => {
      throw { status: 422, code: "VALIDATION_ERROR" };
    }, storage);
    expect(r.dropped).toBe(1);
    expect(r.kept).toBe(0);
  });

  test("custom id is preserved for idempotency", async () => {
    const storage = memStorage();
    const stable = "stable-queue-id-123";
    const id = await enqueueTo({ path: "/x", method: "POST", id: stable }, storage);
    expect(id).toBe(stable);
    const q = await readQueue(storage);
    expect(q[0].id).toBe(stable);
  });

  test("concurrent replay is guarded", async () => {
    const storage = memStorage();
    await enqueueTo({ path: "/x", method: "POST" }, storage);
    let inFlight = 0;
    const slowSend = async (_item: QueuedRequest) => {
      inFlight++;
      await new Promise((r) => setTimeout(r, 50));
      inFlight--;
    };
    const [a, b] = await Promise.all([
      replayQueueWith(slowSend, storage),
      replayQueueWith(slowSend, storage),
    ]);
    expect(a.sent + b.sent).toBe(1);
  });
});

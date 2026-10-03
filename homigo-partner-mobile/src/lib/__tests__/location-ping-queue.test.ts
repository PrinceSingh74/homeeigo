import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPingError, createPingQueue, type QueuedFix } from "../location-ping-queue.ts";

const T0 = Date.parse("2026-09-19T10:00:00.000Z");
const fix = (sequence: number, ageMs = 0): QueuedFix => ({
  latitude: 12.97,
  longitude: 77.59,
  capturedAt: new Date(T0 - ageMs).toISOString(),
  sequence,
});

test("flushes strictly in sequence order, even if enqueued out of order", async () => {
  const q = createPingQueue({ maxPerFlush: 10 });
  q.enqueue(fix(3), T0);
  q.enqueue(fix(1), T0);
  q.enqueue(fix(2), T0);
  const sent: number[] = [];
  await q.flush(async (f) => {
    sent.push(f.sequence);
    return "sent";
  }, T0);
  assert.deepEqual(sent, [1, 2, 3]);
  assert.equal(q.size(), 0);
});

test("offline: retry stops the flush and keeps the fix and everything after it", async () => {
  const q = createPingQueue({ maxPerFlush: 10 });
  [1, 2, 3].forEach((s) => q.enqueue(fix(s), T0));
  const res = await q.flush(async (f) => (f.sequence === 2 ? "retry" : "sent"), T0);
  assert.deepEqual(res, { sent: 1, dropped: 0, remaining: 2 });
  assert.deepEqual(
    q.peekAll().map((f) => f.sequence),
    [2, 3],
  );
});

test("permanently refused fixes are dropped and the flush continues", async () => {
  const q = createPingQueue({ maxPerFlush: 10 });
  [1, 2].forEach((s) => q.enqueue(fix(s), T0));
  const res = await q.flush(async (f) => (f.sequence === 1 ? "drop" : "sent"), T0);
  assert.deepEqual(res, { sent: 1, dropped: 1, remaining: 0 });
});

test("fixes older than the server 300 s bound are discarded, not replayed", () => {
  const q = createPingQueue({ maxAgeMs: 280_000 });
  q.enqueue(fix(1, 400_000), T0);
  q.enqueue(fix(2, 10_000), T0);
  assert.deepEqual(
    q.peekAll().map((f) => f.sequence),
    [2],
  );
});

test("bounded size and per-flush burst (presence rate limit)", async () => {
  const q = createPingQueue({ maxSize: 5, maxPerFlush: 3 });
  for (let s = 1; s <= 8; s += 1) q.enqueue(fix(s), T0);
  assert.deepEqual(
    q.peekAll().map((f) => f.sequence),
    [4, 5, 6, 7, 8],
  );
  let n = 0;
  await q.flush(async () => {
    n += 1;
    return "sent";
  }, T0);
  assert.equal(n, 3);
  assert.equal(q.size(), 2);
});

test("concurrent flushes share one pass (no double-send)", async () => {
  const q = createPingQueue({ maxPerFlush: 10 });
  [1, 2].forEach((s) => q.enqueue(fix(s), T0));
  const sent: number[] = [];
  const send = async (f: QueuedFix) => {
    sent.push(f.sequence);
    await new Promise((r) => setTimeout(r, 1));
    return "sent" as const;
  };
  await Promise.all([q.flush(send, T0), q.flush(send, T0)]);
  assert.deepEqual(sent, [1, 2]);
});

test("error classification", () => {
  assert.equal(classifyPingError(400, "SEQUENCE_REGRESSION"), "drop");
  assert.equal(classifyPingError(400, "TIMESTAMP_TOO_OLD"), "drop");
  assert.equal(classifyPingError(429, "RATE_LIMIT_EXCEEDED"), "retry");
  assert.equal(classifyPingError(401, "INVALID_SESSION"), "retry");
  assert.equal(classifyPingError(503, null), "retry");
  assert.equal(classifyPingError(0, "NETWORK_ERROR"), "retry");
});

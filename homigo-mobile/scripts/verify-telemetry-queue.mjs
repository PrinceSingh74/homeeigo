#!/usr/bin/env node
/**
 * Phase 1: durable telemetry queue — offline enqueue, online replay, idempotency.
 */
const TELEMETRY_QUEUE_KEY = "homigo_telemetry_queue";
const DELIVERED_IDS_KEY = "homigo_telemetry_delivered";
const MAX_QUEUE_SIZE = 256;
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 300000;

class MemStorage {
  constructor() {
    this.map = new Map();
  }
  async getItem(k) {
    return this.map.get(k) ?? null;
  }
  async setItem(k, v) {
    this.map.set(k, v);
  }
}

function backoffMs(attempts) {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts));
}

function makeTelemetryId() {
  return `tel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readDeliveredIds(storage) {
  const raw = await storage.getItem(DELIVERED_IDS_KEY);
  return new Set(raw ? JSON.parse(raw) : []);
}

async function markDelivered(id, storage) {
  const set = await readDeliveredIds(storage);
  set.add(id);
  await storage.setItem(DELIVERED_IDS_KEY, JSON.stringify([...set]));
}

async function readTelemetryQueue(storage) {
  const raw = await storage.getItem(TELEMETRY_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeTelemetryQueue(items, storage) {
  await storage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE_SIZE)));
}

async function enqueueTelemetry(req, storage) {
  const delivered = await readDeliveredIds(storage);
  const id = req.id ?? makeTelemetryId();
  if (delivered.has(id)) return id;
  const item = { id, path: req.path, body: { ...req.body, telemetryId: id }, createdAt: Date.now(), attempts: 0, nextRetryAt: Date.now() };
  const queue = await readTelemetryQueue(storage);
  if (queue.some((q) => q.id === id)) return id;
  queue.push(item);
  while (queue.length > MAX_QUEUE_SIZE) queue.shift();
  await writeTelemetryQueue(queue, storage);
  return id;
}

async function replayTelemetryQueue(send, storage, now = Date.now(), ignoreBackoff = false) {
  const delivered = await readDeliveredIds(storage);
  const queue = await readTelemetryQueue(storage);
  const remaining = [];
  let sent = 0;
  let dropped = 0;
  let skipped = 0;
  for (const item of queue) {
    if (delivered.has(item.id)) {
      skipped++;
      continue;
    }
    if (!ignoreBackoff && item.nextRetryAt > now) {
      remaining.push(item);
      continue;
    }
    try {
      await send(item);
      await markDelivered(item.id, storage);
      sent++;
    } catch {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) dropped++;
      else remaining.push({ ...item, attempts, nextRetryAt: now + backoffMs(attempts) });
    }
  }
  await writeTelemetryQueue(remaining, storage);
  return { sent, dropped, kept: remaining.length, skipped };
}

let online = false;
const sent = [];
const sender = async (item) => {
  if (!online) throw new Error("offline");
  sent.push({ id: item.id, signal: item.body.signal });
};

async function main() {
  const storage = new MemStorage();
  online = false;

  for (const m of [
    { signal: "hydration_duration", value: 320 },
    { signal: "bootstrap_duration", value: 890 },
    { signal: "interactive_duration", value: 1450 },
  ]) {
    await enqueueTelemetry({ path: "/api/ux-signals", body: m }, storage);
  }

  const queued = (await readTelemetryQueue(storage)).length;
  if (queued !== 3) {
    console.error(`[verify:telemetry-queue] FAIL — queued ${queued}, expected 3`);
    process.exit(1);
  }

  const offlineReplay = await replayTelemetryQueue(sender, storage);
  if (offlineReplay.sent !== 0 || sent.length !== 0) {
    console.error("[verify:telemetry-queue] FAIL — delivered while offline");
    process.exit(1);
  }

  online = true;
  const onlineReplay = await replayTelemetryQueue(sender, storage, Date.now(), true);
  if (onlineReplay.sent !== 3) {
    console.error(`[verify:telemetry-queue] FAIL — sent ${onlineReplay.sent}, expected 3`);
    process.exit(1);
  }

  const finalQueue = (await readTelemetryQueue(storage)).length;
  if (finalQueue !== 0) {
    console.error(`[verify:telemetry-queue] FAIL — queue not empty (${finalQueue})`);
    process.exit(1);
  }

  // Max queue size enforcement
  for (let i = 0; i < MAX_QUEUE_SIZE + 10; i++) {
    await enqueueTelemetry({ path: "/api/ux-signals", body: { signal: "test", value: i } }, storage);
  }
  const capped = (await readTelemetryQueue(storage)).length;
  if (capped > MAX_QUEUE_SIZE) {
    console.error(`[verify:telemetry-queue] FAIL — queue exceeded cap (${capped})`);
    process.exit(1);
  }

  console.log("[verify:telemetry-queue] PASS");
  console.log(`  offline queued: 3`);
  console.log(`  online delivered: ${onlineReplay.sent}`);
  console.log(`  signals: ${sent.map((s) => s.signal).join(", ")}`);
  console.log(`  max queue cap enforced: ${capped}<=${MAX_QUEUE_SIZE}`);
}

main().catch((e) => {
  console.error("[verify:telemetry-queue] FAIL", e);
  process.exit(1);
});

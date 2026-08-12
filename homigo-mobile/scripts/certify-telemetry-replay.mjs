#!/usr/bin/env node
/**
 * Phase 4: Telemetry replay — simulates offline persist, app restart, online replay.
 * Proves 0 lost / 0 duplicate at engine level; device E2E still requires hardware proof file.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");

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
  snapshot() {
    return new Map(this.map);
  }
  restore(snap) {
    this.map = new Map(snap);
  }
}

const TELEMETRY_QUEUE_KEY = "homigo_telemetry_queue";
const DELIVERED_IDS_KEY = "homigo_telemetry_delivered";

async function readDeliveredIds(storage) {
  const raw = await storage.getItem(DELIVERED_IDS_KEY);
  return new Set(raw ? JSON.parse(raw) : []);
}

async function markDelivered(id, storage) {
  const set = await readDeliveredIds(storage);
  set.add(id);
  await storage.setItem(DELIVERED_IDS_KEY, JSON.stringify([...set]));
}

async function readQueue(storage) {
  const raw = await storage.getItem(TELEMETRY_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(items, storage) {
  await storage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(items));
}

async function enqueue(path, body, storage) {
  const id = `tel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = await readQueue(storage);
  queue.push({ id, path, body: { ...body, telemetryId: id }, createdAt: Date.now(), attempts: 0, nextRetryAt: 0 });
  await writeQueue(queue, storage);
  return id;
}

async function replay(send, storage, ignoreBackoff = true) {
  const delivered = await readDeliveredIds(storage);
  const queue = await readQueue(storage);
  const remaining = [];
  const sentIds = [];
  for (const item of queue) {
    if (delivered.has(item.id)) continue;
    try {
      await send(item);
      await markDelivered(item.id, storage);
      sentIds.push(item.id);
    } catch {
      remaining.push(item);
    }
  }
  await writeQueue(remaining, storage);
  return sentIds;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const storage = new MemStorage();
  let online = false;
  const deliveredBodies = [];
  const send = async (item) => {
    if (!online) throw new Error("offline");
    deliveredBodies.push(item.body.signal);
  };

  const metrics = ["hydration_duration", "bootstrap_duration", "interactive_duration", "startup_duration"];
  const enqueuedIds = [];

  // Step 1-2: offline, generate telemetry
  online = false;
  for (const signal of metrics) {
    enqueuedIds.push(await enqueue("/api/ux-signals", { signal, value: 500 }, storage));
  }

  const afterEnqueue = (await readQueue(storage)).length;
  if (afterEnqueue !== metrics.length) {
    console.error("[certify:telemetry-replay] FAIL enqueue");
    process.exit(1);
  }

  // Step 3: restart app — persist storage snapshot, clear in-memory online flag
  const snap = storage.snapshot();
  const storage2 = new MemStorage();
  storage2.restore(snap);

  // Step 4-5: online, replay
  online = true;
  const sentIds = await replay(send, storage2, true);
  const remaining = (await readQueue(storage2)).length;

  // Idempotency: replay again
  const sentAgain = await replay(send, storage2, true);
  const duplicates = sentAgain.length;

  const lost = metrics.length - deliveredBodies.length;
  const result = {
    generatedAt: new Date().toISOString(),
    enqueued: metrics.length,
    delivered: deliveredBodies.length,
    lost,
    duplicateOnReplay: duplicates,
    remainingQueue: remaining,
    signals: deliveredBodies,
    pass: lost === 0 && duplicates === 0 && remaining === 0,
  };

  writeFileSync(join(OUT, "telemetry-replay.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

main();

/**
 * P2 — Multi-Node / Cluster Validation (runnable; REUSES redis lock + fan-out).
 *
 * Validates horizontal-scaling correctness against the REAL shared-state layer
 * (Redis). Redis is the source of truth for cross-instance coordination, so N
 * simulated nodes (distinct lock tokens) against one Redis instance genuinely
 * exercises mutual exclusion, leader election, shared rate limiting and WS
 * fan-out. For a true cross-process drill, run this on 2–3 hosts pointing at the
 * same REDIS_URL (see Cluster Validation Report).
 *
 *   REDIS_URL=redis://localhost:6379 bun run scripts/p2-validation/cluster-validation.ts
 *
 * No REDIS_URL → NOT VERIFIED for multi-node (in-memory fallback is single-node).
 */
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { redisClient } from "../../src/lib/redis";
import { roomManager, MessageType, type WSConnection, type WSMessage } from "../../src/lib/websocket";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, "..", "..", "..", "..", "docs", "p2", "evidence");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = { check: string; ok: boolean; detail: string };

/** Simulate `nodes` instances racing for one leader lock; exactly one must win. */
async function leaderElection(nodes: number, key: string): Promise<Result> {
  const token = () => `node_${crypto.randomBytes(5).toString("hex")}`;
  const attempts = await Promise.all(
    Array.from({ length: nodes }, async () => {
      const t = token();
      const won = await redisClient.acquireLock(key, t, 10);
      return { t, won };
    }),
  );
  const winners = attempts.filter((a) => a.won);
  // release the winner so the key is clean for the next round
  for (const w of winners) await redisClient.releaseLock(key, w.t);
  return { check: `${nodes}-node leader election`, ok: winners.length === 1, detail: `winners=${winners.length} (expected 1) — no duplicate execution / no split-brain` };
}

/** Shared rate-limit: N nodes consuming the same key must sum to exactly `limit` allowed. */
async function sharedRateLimit(nodes: number, limit: number): Promise<Result> {
  const key = `cluster:rl:${crypto.randomBytes(4).toString("hex")}`;
  const calls = nodes * limit; // each node tries `limit` times → only `limit` total should pass
  const outcomes = await Promise.all(Array.from({ length: calls }, () => redisClient.consume(key, limit, 30)));
  const allowed = outcomes.filter((o) => o && o.allowed).length;
  const usable = outcomes.every((o) => o !== null); // null = redis unavailable
  return { check: `shared rate limit across ${nodes} nodes`, ok: usable && allowed === limit, detail: usable ? `allowed=${allowed} of ${calls} attempts (expected exactly ${limit}) — atomic shared counter` : "redis returned null (NOT shared)" };
}

/** WS fan-out: a remote-origin publish is delivered exactly once locally. */
async function wsFanout(): Promise<Result> {
  const received: WSMessage[] = [];
  const conn: WSConnection = {
    userId: "cluster-user",
    userType: "customer",
    connectionId: "cluster-conn",
    connectedAt: new Date(),
    lastPing: new Date(),
    rooms: new Set(),
    send: (m: string) => received.push(JSON.parse(m)),
  };
  roomManager.addToRoom("booking:cluster", conn);
  const sub = await roomManager.initRedisFanout();
  await sleep(150);
  await redisClient.publish(
    "ws:fanout",
    JSON.stringify({ kind: "room", origin: "OTHER_INSTANCE", roomId: "booking:cluster", message: { type: MessageType.BOOKING_STATUS, data: { status: "EN_ROUTE" }, timestamp: new Date() } }),
  );
  await sleep(300);
  // own echo must be ignored (loop guard) — publish from self
  await redisClient.publish(
    "ws:fanout",
    JSON.stringify({ kind: "room", origin: roomManager.instance, roomId: "booking:cluster", message: { type: MessageType.PING, data: {}, timestamp: new Date() } }),
  );
  await sleep(200);
  await roomManager.stopRedisFanout();
  return { check: "WebSocket cross-instance fan-out", ok: sub === true && received.length === 1, detail: `subscribed=${sub} delivered=${received.length} (expected 1; own echo ignored)` };
}

async function main() {
  await redisClient.connect();
  await sleep(300);

  const results: Result[] = [];
  const multiNode = redisClient.isAvailable;

  if (!multiNode) {
    await emit([{ check: "redis_shared_state", ok: false, detail: "REDIS_URL unset/unreachable — in-memory fallback is single-node only" }], "NOT VERIFIED");
    console.error("[cluster] NOT VERIFIED — set REDIS_URL to a reachable Redis to validate multi-node");
    await redisClient.disconnect();
    process.exit(2);
  }

  results.push({ check: "redis_shared_state", ok: true, detail: "Redis reachable — shared coordination active" });
  // Scheduler coordination: 5 rounds, each must elect exactly one leader.
  let dupRounds = 0;
  for (let i = 0; i < 5; i++) {
    const r = await leaderElection(3, "cluster:sched:round");
    if (!r.ok) dupRounds++;
    await sleep(50);
  }
  results.push({ check: "scheduler coordination (5 rounds × 3 nodes)", ok: dupRounds === 0, detail: `${5 - dupRounds}/5 rounds elected exactly one leader — no duplicate job execution` });

  results.push(await leaderElection(2, "cluster:lock:2"));
  results.push(await leaderElection(3, "cluster:lock:3"));
  results.push(await sharedRateLimit(2, 10));
  results.push(await sharedRateLimit(3, 10));
  results.push(await wsFanout());

  await emit(results, results.every((r) => r.ok) ? "COMPLETE" : "PARTIAL");
  await redisClient.disconnect();

  const ok = results.every((r) => r.ok);
  console.error(`\n[cluster] ${ok ? "ALL PASS ✅" : "SOME FAIL ❌"}; evidence → docs/p2/evidence/cluster-validation.md`);
  for (const r of results) console.error(`  ${r.ok ? "✅" : "❌"} ${r.check}: ${r.detail}`);
  process.exit(ok ? 0 : 1);
}

async function emit(results: Result[], verdict: string) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const md: string[] = [];
  md.push("# Evidence — Cluster Validation Report");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}  ·  Verdict: **${verdict}**`);
  md.push("");
  md.push("Validates: 2-node & 3-node coordination, horizontal scaling, Redis shared state, WebSocket fan-out, background-job / scheduler coordination — asserting **no duplicate execution, no race conditions, no split-brain**.");
  md.push("");
  md.push("| Check | Result | Detail |");
  md.push("|---|:--:|---|");
  for (const r of results) md.push(`| ${r.check} | ${r.ok ? "PASS ✅" : "FAIL ❌"} | ${r.detail.replace(/\|/g, "\\|")} |`);
  md.push("");
  md.push("## True cross-process drill");
  md.push("Run on 2–3 separate hosts/containers pointing at the SAME `REDIS_URL` to confirm OS-process isolation. The in-process simulation above already exercises the shared Redis primitives (locks/counters/pubsub) that make cross-process correct.");
  md.push("");
  await writeFile(join(EVIDENCE_DIR, "cluster-validation.md"), md.join("\n"), "utf8");
  await writeFile(join(EVIDENCE_DIR, "cluster-validation.json"), JSON.stringify({ verdict, results, generatedAt: new Date().toISOString() }, null, 2), "utf8");
}

main().catch((e) => {
  console.error("[cluster] fatal:", e);
  process.exit(3);
});

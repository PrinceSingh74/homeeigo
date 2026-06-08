/**
 * Live Redis smoke test — exercises the REAL redisClient against a running
 * Redis instance (not a mock). Run with REDIS_URL pointing at a test Redis:
 *
 *   REDIS_URL=redis://localhost:6399 bun run scripts/smoke-redis.ts
 *
 * Verifies: connect, get/set/del, TTL expiry, atomic rate-limit (consume),
 * Pub/Sub round-trip, and INFO-based metrics. Exits non-zero on any failure.
 */
import { redisClient } from "../src/lib/redis";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n🔌 Connecting (REDIS_URL=${process.env.REDIS_URL || "<unset>"})`);
  await redisClient.connect();
  // Give the "ready" event a beat to flip isAvailable.
  await sleep(300);
  ok("isEnabled", redisClient.isEnabled);
  ok("isAvailable", redisClient.isAvailable);
  ok("healthCheck PING", await redisClient.healthCheck());
  ok("topology", redisClient.topology === "standalone", redisClient.topology);

  console.log("\n📦 Cache primitives");
  await redisClient.set("smoke:k1", "hello", 60);
  ok("set+get", (await redisClient.get("smoke:k1")) === "hello");
  await redisClient.del("smoke:k1");
  ok("del", (await redisClient.get("smoke:k1")) === null);
  await redisClient.set("smoke:ttl", "x", 1);
  await sleep(1200);
  ok("TTL expiry", (await redisClient.get("smoke:ttl")) === null);

  console.log("\n🚦 Atomic rate limiting (consume)");
  const rlKey = `smoke:rl:${Date.now()}`;
  const r1 = await redisClient.consume(rlKey, 3, 60);
  const r2 = await redisClient.consume(rlKey, 3, 60);
  const r3 = await redisClient.consume(rlKey, 3, 60);
  const r4 = await redisClient.consume(rlKey, 3, 60);
  ok("1st allowed, remaining 2", r1?.allowed === true && r1?.remaining === 2);
  ok("3rd allowed, remaining 0", r3?.allowed === true && r3?.remaining === 0);
  ok("4th blocked", r4?.allowed === false, `remaining=${r4?.remaining}`);

  console.log("\n📡 Pub/Sub round-trip");
  const channel = `smoke:chan:${Date.now()}`;
  let received: string | null = null;
  const unsub = await redisClient.subscribe(channel, (m) => {
    received = m;
  });
  ok("subscribe returns unsubscribe fn", typeof unsub === "function");
  await sleep(150);
  const delivered = await redisClient.publish(channel, "ping-payload");
  await sleep(250);
  ok("publish reached 1 subscriber", delivered === 1, `subscribers=${delivered}`);
  ok("subscriber received payload", received === "ping-payload", String(received));
  if (unsub) await unsub();

  console.log("\n📊 Metrics (INFO)");
  const m = await redisClient.getMetrics();
  ok("metrics.available", m.available === true);
  ok("metrics.connectedClients > 0", m.connectedClients > 0, String(m.connectedClients));
  ok("metrics.usedMemoryHuman present", m.usedMemoryHuman !== "n/a", m.usedMemoryHuman);
  ok("metrics.hitRate is 0..1", m.hitRate >= 0 && m.hitRate <= 1, String(m.hitRate));

  await redisClient.disconnect();
  console.log(`\n${fail === 0 ? "✅" : "❌"} Redis smoke: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

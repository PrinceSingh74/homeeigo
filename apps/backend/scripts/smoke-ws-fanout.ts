/**
 * Live WebSocket Redis fan-out test. Proves the cross-instance delivery path
 * without spinning two full servers: we register a local fake connection, start
 * the fan-out subscriber, then publish envelopes to the channel as if from
 * another instance — and assert delivery + loop-guard + no double-delivery.
 *
 *   REDIS_URL=redis://localhost:6399 bun run scripts/smoke-ws-fanout.ts
 */
import { redisClient } from "../src/lib/redis";
import { roomManager, MessageType, type WSConnection, type WSMessage } from "../src/lib/websocket";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) (pass++, console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`));
  else (fail++, console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const received: WSMessage[] = [];
const fakeConn: WSConnection = {
  userId: "user-1",
  userType: "customer",
  connectionId: "conn-1",
  connectedAt: new Date(),
  lastPing: new Date(),
  rooms: new Set(),
  send: (m: string) => received.push(JSON.parse(m)),
};

const pub = (env: object) => redisClient.publish("ws:fanout", JSON.stringify(env));

async function main() {
  await redisClient.connect();
  await sleep(300);
  ok("redis available", redisClient.isAvailable);

  roomManager.addToRoom("booking:test", fakeConn);
  const sub = await roomManager.initRedisFanout();
  ok("fanout subscribed", sub === true, `instance=${roomManager.instance}`);
  await sleep(150);

  console.log("\n📥 Remote room message (from ANOTHER instance) is delivered locally");
  await pub({
    kind: "room",
    origin: "OTHER_INSTANCE",
    roomId: "booking:test",
    message: { type: MessageType.BOOKING_STATUS, data: { status: "EN_ROUTE" }, timestamp: new Date() },
  });
  await sleep(300);
  ok("delivered once", received.length === 1, `count=${received.length}`);
  ok("payload correct", received[0]?.data?.status === "EN_ROUTE");

  console.log("\n🔁 Loop guard: our OWN echo (origin = this instance) is ignored");
  await pub({
    kind: "room",
    origin: roomManager.instance,
    roomId: "booking:test",
    message: { type: MessageType.PING, data: {}, timestamp: new Date() },
  });
  await sleep(300);
  ok("own echo ignored (still 1)", received.length === 1, `count=${received.length}`);

  console.log("\n👤 Remote user message delivered to that user's local connections");
  await pub({
    kind: "user",
    origin: "OTHER_INSTANCE",
    userId: "user-1",
    message: { type: MessageType.NOTIFICATION, data: { title: "hi" }, timestamp: new Date() },
  });
  await sleep(300);
  ok("user delivery (now 2)", received.length === 2, `count=${received.length}`);

  console.log("\n📤 Local broadcast() delivers exactly once (own publish echo ignored)");
  roomManager.broadcast("booking:test", {
    type: MessageType.BOOKING_STATUS,
    data: { status: "ARRIVED" },
    timestamp: new Date(),
  });
  await sleep(300);
  ok("no double-delivery (now 3)", received.length === 3, `count=${received.length}`);

  await roomManager.stopRedisFanout();
  await redisClient.disconnect();
  console.log(`\n${fail === 0 ? "✅" : "❌"} WS fan-out: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

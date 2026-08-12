/**
 * Clear stuck login rate-limit counters in Redis (dev recovery).
 * Run: bun run scripts/clear-login-rate-limits.ts
 */
import "../src/load-env";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL?.trim();
if (!REDIS_URL) {
  console.log("REDIS_URL not set — nothing to clear.");
  process.exit(0);
}

const client = createClient({ url: REDIS_URL });
await client.connect();

let cursor = "0";
let deleted = 0;
do {
  const reply = await client.scan(cursor, { MATCH: "ratelimit:login-fail-*", COUNT: 100 });
  cursor = reply.cursor;
  for (const key of reply.keys) {
    await client.del(key);
    deleted += 1;
  }
} while (cursor !== "0");

await client.quit();
console.log(JSON.stringify({ deletedLoginRateLimitKeys: deleted }));

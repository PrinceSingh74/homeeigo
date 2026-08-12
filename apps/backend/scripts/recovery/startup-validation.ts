/**
 * HOMIGO — Startup Validation (pre-flight, READ-ONLY).
 * Run BEFORE booting the backend (PM2 pre-start / systemd ExecStartPre / CI gate). Refuses a
 * broken or DUPLICATE boot. Exit 0 = safe to start; non-zero = abort (do NOT start the server).
 *
 *   pm2 / systemd:  bun run scripts/recovery/startup-validation.ts && bun run src/index.ts
 */
import { execSync } from "child_process";
import prisma from "../../src/lib/prisma";
import { redisClient } from "../../src/lib/redis";

const PORT = Number(process.env.PORT || 3000);
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"];

async function main() {
  console.log(`\n=== Startup Validation · ${new Date().toISOString()} ===\n`);
  const fails: string[] = [];
  const warns: string[] = [];

  // 1. required env
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || process.env[k]!.trim() === "");
  console.log(`  ${missing.length === 0 ? "✅" : "❌"} env vars: ${missing.length === 0 ? "all required present" : "MISSING " + missing.join(",")}`);
  if (missing.length) fails.push(`missing env: ${missing.join(",")}`);
  if (!process.env.GOOGLE_MAPS_API_KEY) warns.push("GOOGLE_MAPS_API_KEY empty — maps run on haversine fallback");

  // 2. DB reachable + TRULY pending migrations (exclude rolled-back historical records)
  try {
    const mig = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
    const pending = mig[0].n;
    console.log(`  ${pending === 0 ? "✅" : "❌"} database reachable · truly-pending migrations=${pending}`);
    if (pending > 0) fails.push(`${pending} unfinished (non-rolled-back) migration(s)`);
  } catch (e) {
    console.log(`  ❌ database UNREACHABLE: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    fails.push("database unreachable");
  }

  // 3. Redis reachable (optional — degrades gracefully if disabled). Use a real set/get roundtrip.
  try {
    await redisClient.connect?.();
    if (!redisClient.isEnabled) {
      console.log(`  ⚠️  redis: not configured (single-node mode)`);
    } else {
      const k = `startup:probe:${Date.now()}`;
      const wrote = await redisClient.set(k, "1", 10).catch(() => false);
      const read = wrote ? await redisClient.get(k).catch(() => null) : null;
      const ok = read === "1" || redisClient.isAvailable;
      console.log(`  ${ok ? "✅" : "⚠️ "} redis: ${ok ? "reachable" : "unreachable (app degrades to single-node in-memory)"}`);
      if (!ok) warns.push("redis unreachable — WS fan-out + distributed locks degrade");
    }
  } catch {
    console.log(`  ⚠️  redis: probe skipped (single-node mode)`);
  }

  // 4. NO duplicate backend already listening on the port (the critical guard)
  try {
    const isWin = process.platform === "win32";
    const out = isWin ? execSync("netstat -ano", { encoding: "utf8" }) : execSync("ss -ltn 2>/dev/null || netstat -ltn", { encoding: "utf8" });
    const already = out.split("\n").some((l) => l.includes(`:${PORT}`) && /LISTEN/i.test(l));
    console.log(`  ${already ? "❌" : "✅"} port :${PORT} ${already ? "ALREADY IN USE — a backend is already running (refuse duplicate)" : "free"}`);
    if (already) fails.push(`port ${PORT} already bound — duplicate backend`);
  } catch { /* skip if tooling missing */ }

  console.log("");
  warns.forEach((w) => console.log(`  ⚠️  WARN: ${w}`));
  if (fails.length) {
    console.log(`\n❌ STARTUP ABORTED — ${fails.length} blocking issue(s): ${fails.join("; ")}`);
    process.exit(1);
  }
  console.log(`✅ Startup validation passed — safe to boot.`);
  process.exit(0);
}

main().catch((e) => { console.error("STARTUP VALIDATION ERROR:", e instanceof Error ? e.message : e); process.exit(2); });

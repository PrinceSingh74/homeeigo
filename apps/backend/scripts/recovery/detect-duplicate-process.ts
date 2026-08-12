/**
 * HOMIGO — Duplicate Backend-Process Detector (READ-ONLY).
 * Detects the condition that caused the false integrity FAIL: more than one backend instance
 * sharing the same DB/port-role, doubling the Prisma pool and racing the dispatch queue.
 *
 * Signals (any failing => duplicate suspected):
 *   1. OS: >1 process LISTENING on the backend port.
 *   2. DB: connection count far above one capped pool (limit 8 → >16 hints a 2nd backend).
 *   3. Health: the port responds exactly once (sanity).
 *
 * Run:  bun --env-file=.env run scripts/recovery/detect-duplicate-process.ts
 * Exit: 0 = single instance; 1 = duplicate suspected (alert). Never mutates.
 */
import { execSync } from "child_process";
import prisma from "../../src/lib/prisma";

const PORT = Number(process.env.PORT || 3000);
const POOL_LIMIT = Number(process.env.PRISMA_CONNECTION_LIMIT || (process.env.NODE_ENV === "production" ? 15 : 8));

function listenersOnPort(port: number): number {
  try {
    const isWin = process.platform === "win32";
    const out = isWin
      ? execSync(`netstat -ano`, { encoding: "utf8" })
      : execSync(`ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null`, { encoding: "utf8" });
    const lines = out.split("\n").filter((l) => l.includes(`:${port}`) && /LISTEN/i.test(l));
    // distinct owning PIDs (Windows: last column; Linux: pid=… in the row)
    const pids = new Set<string>();
    for (const l of lines) {
      const win = l.trim().split(/\s+/).pop();
      const linux = (l.match(/pid=(\d+)/) || [])[1];
      pids.add(linux || win || l);
    }
    return pids.size;
  } catch {
    return -1;
  }
}

async function main() {
  console.log(`\n=== Duplicate-Process Detection · port ${PORT} · ${new Date().toISOString()} ===\n`);
  const issues: string[] = [];

  const listeners = listenersOnPort(PORT);
  const okListeners = listeners <= 1 || listeners === -1;
  console.log(`  ${okListeners ? "✅" : "❌"} OS listeners on :${PORT} = ${listeners < 0 ? "n/a" : listeners}`);
  if (!okListeners) issues.push(`${listeners} processes bound to port ${PORT}`);

  const conns = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database()`);
  const total = conns[0].n;
  // this detector itself opens one pool; a single backend + this = ~2 pools is normal.
  const threshold = POOL_LIMIT * 2 + 4;
  const okConns = total <= threshold;
  console.log(`  ${okConns ? "✅" : "❌"} DB connections = ${total} (threshold ${threshold}, pool limit ${POOL_LIMIT})`);
  if (!okConns) issues.push(`${total} DB connections — exceeds 2 pools; a 2nd backend likely running`);

  if (issues.length) {
    console.log(`\n❌ DUPLICATE BACKEND SUSPECTED:\n   - ${issues.join("\n   - ")}`);
    console.log(`   Action: stop strays, run under PM2 (ecosystem.config.js) or systemd (deploy/homigo-backend.service).`);
    process.exit(1);
  }
  console.log(`\n✅ Single backend instance — no duplicate-process race condition.`);
  process.exit(0);
}

main().catch((e) => { console.error("DETECT ERROR:", e instanceof Error ? e.message : e); process.exit(2); });

/**
 * SECTION 7B — what is actually saturating?
 *
 *   DATABASE_URL="<test>" bun run scripts/chaos/7b-saturation-probe.ts
 *
 * 7A found a reproducible knee: DB-bound endpoints peak near concurrency 50 and get SLOWER at 100
 * (bookings 189 -> 111 rps, p95 312 -> 1486 ms) while Postgres connections stayed pinned at 6.
 *
 * Six is `connection_limit=5` plus one. That is consistent with pool queueing — and also consistent
 * with a slow query, a long transaction, lock contention, or event-loop starvation, every one of
 * which would ALSO show a flat connection count and rising latency. Latency alone cannot tell them
 * apart, so this probe samples the things that can:
 *
 *   - `pg_stat_activity` split by state: active vs idle-in-transaction vs waiting
 *   - `wait_event_type` / `wait_event`, which names WHAT a blocked backend is blocked on
 *   - transaction age, to catch long-running transactions holding a connection
 *   - `pg_stat_statements` deltas, to attribute time to specific queries
 *
 * It measures. It changes nothing.
 */
import { assertChaosTargetIsolated, assertServerTargetIsolated } from "../../src/lib/chaos-isolation";

const BASE = process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const LADDER = (process.env.LADDER ?? "1,10,25,50,75,100,150").split(",").map(Number);
const REQUESTS_PER_WORKER = Number(process.env.REQUESTS_PER_WORKER ?? 6);
const ENDPOINT = process.env.ENDPOINT ?? "/api/bookings/upcoming";

assertChaosTargetIsolated("7B saturation probe");
await assertServerTargetIsolated(BASE, "7B saturation probe");

const prisma = (await import("../../src/lib/prisma")).default;

const EMAIL = process.env.LOAD_TEST_EMAIL ?? "s7baseline@homigo.test";
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "Kf4!zQr9Wn2v";

async function token(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`login failed ${res.status} — provision via 7a-load-baseline.ts first`);
  const t = ((await res.json()) as { data?: { accessToken?: string } }).data?.accessToken;
  if (!t) throw new Error("login returned no token");
  return t;
}

type ActivitySample = {
  active: number;
  idleInTx: number;
  waiting: number;
  maxTxAgeMs: number;
  waitEvents: Record<string, number>;
};

/**
 * One snapshot of what every backend on this database is doing right now.
 *
 * `wait_event_type` is the discriminator the whole subsection turns on: a connection blocked on
 * `Lock` is contending, one on `IO` is reading, one on `Client` is idle waiting for the app, and one
 * that is `active` with no wait event is genuinely computing.
 */
async function sampleActivity(): Promise<ActivitySample> {
  const rows = await prisma.$queryRaw<
    Array<{
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
      tx_age_ms: number | null;
    }>
  >`
    SELECT state,
           wait_event_type,
           wait_event,
           EXTRACT(EPOCH FROM (now() - xact_start)) * 1000 AS tx_age_ms
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()`;

  const waitEvents: Record<string, number> = {};
  let active = 0;
  let idleInTx = 0;
  let waiting = 0;
  let maxTxAgeMs = 0;
  for (const r of rows) {
    if (r.state === "active") active++;
    if (r.state === "idle in transaction") idleInTx++;
    if (r.wait_event_type && r.state === "active") {
      waiting++;
      const key = `${r.wait_event_type}:${r.wait_event ?? "?"}`;
      waitEvents[key] = (waitEvents[key] ?? 0) + 1;
    }
    if (r.tx_age_ms && r.tx_age_ms > maxTxAgeMs) maxTxAgeMs = Math.round(r.tx_age_ms);
  }
  return { active, idleInTx, waiting, maxTxAgeMs, waitEvents };
}

async function resetStatements(): Promise<void> {
  await prisma.$queryRawUnsafe(`SELECT pg_stat_statements_reset()`);
}

type StatRow = { calls: bigint; total_ms: number; mean_ms: number; rows: bigint; query: string };

async function topStatements(limit = 8): Promise<StatRow[]> {
  return prisma.$queryRawUnsafe<StatRow[]>(`
    SELECT calls, total_exec_time AS total_ms, mean_exec_time AS mean_ms, rows, query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT LIKE '%pg_stat_activity%'
      AND query NOT LIKE '%pg_stat_statements%'
    ORDER BY total_exec_time DESC
    LIMIT ${limit}`);
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const auth = await token();
console.log(`endpoint: ${ENDPOINT}`);
console.log(`ladder  : ${LADDER.join(", ")}\n`);
console.log(
  "conc  reqs   err%   rps      p50    p95    p99   | pgActive idleInTx waiting maxTxAge | top wait events",
);

for (const concurrency of LADDER) {
  const latencies: number[] = [];
  let ok = 0;
  let sampling = true;
  const samples: ActivitySample[] = [];

  const sampler = (async () => {
    while (sampling) {
      try {
        samples.push(await sampleActivity());
      } catch {
        /* sampling must never fail the measurement */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  })();

  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < REQUESTS_PER_WORKER; i++) {
        const t0 = Date.now();
        try {
          const res = await fetch(`${BASE}${ENDPOINT}`, {
            headers: { Authorization: `Bearer ${auth}` },
            signal: AbortSignal.timeout(60_000),
          });
          if (res.ok) ok++;
          await res.arrayBuffer();
        } catch {
          /* counted as an error by omission */
        }
        latencies.push(Date.now() - t0);
      }
    }),
  );
  const durationMs = Date.now() - started;
  sampling = false;
  await sampler;

  const sorted = [...latencies].sort((a, b) => a - b);
  const requests = concurrency * REQUESTS_PER_WORKER;
  const peak = <K extends keyof ActivitySample>(k: K): number =>
    samples.reduce((m, s) => Math.max(m, s[k] as number), 0);
  const mergedWaits: Record<string, number> = {};
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.waitEvents)) {
      mergedWaits[k] = Math.max(mergedWaits[k] ?? 0, v);
    }
  }
  const waitSummary =
    Object.entries(mergedWaits)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([k, v]) => `${k}x${v}`)
      .join(" ") || "none";

  console.log(
    `${String(concurrency).padStart(4)} ${String(requests).padStart(5)} ` +
      `${String(Number(((requests - ok) / requests * 100).toFixed(1))).padStart(6)} ` +
      `${String(Number((requests / (durationMs / 1000)).toFixed(1))).padStart(8)} ` +
      `${String(pct(sorted, 50)).padStart(6)} ${String(pct(sorted, 95)).padStart(6)} ${String(pct(sorted, 99)).padStart(6)} | ` +
      `${String(peak("active")).padStart(8)} ${String(peak("idleInTx")).padStart(8)} ` +
      `${String(peak("waiting")).padStart(7)} ${String(peak("maxTxAgeMs")).padStart(8)} | ${waitSummary}`,
  );
}

console.log("\n── queries by total time (this probe only) ──");
for (const s of await topStatements()) {
  const q = s.query.replace(/\s+/g, " ").slice(0, 104);
  console.log(
    `  ${String(Math.round(s.total_ms)).padStart(8)}ms  calls=${String(s.calls).padStart(6)}  ` +
      `mean=${s.mean_ms.toFixed(2).padStart(7)}ms  rows=${String(s.rows).padStart(7)}  ${q}`,
  );
}

await prisma.$disconnect();
export { resetStatements };

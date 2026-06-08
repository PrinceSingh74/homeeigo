/**
 * HOMIGO load test runner — concurrent HTTP benchmark without external deps.
 *
 * Usage:
 *   bun run scripts/load-test/runner.ts --scenario booking --concurrency 100
 *   bun run scripts/load-test/runner.ts --scenario all --concurrency 500
 */

const BASE = process.env.LOAD_TEST_BASE_URL || "http://localhost:3000";

type Scenario = "health" | "ready" | "metrics" | "booking" | "payment" | "wallet" | "websocket" | "provider" | "finance" | "all";

type Result = {
  scenario: string;
  concurrency: number;
  totalRequests: number;
  durationMs: number;
  throughput: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let scenario: Scenario = "health";
  let concurrency = 100;
  let requestsPerWorker = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scenario" && args[i + 1]) scenario = args[++i] as Scenario;
    if (args[i] === "--concurrency" && args[i + 1]) concurrency = Number(args[++i]);
    if (args[i] === "--requests" && args[i + 1]) requestsPerWorker = Number(args[++i]);
  }
  return { scenario, concurrency, requestsPerWorker };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

async function hit(path: string): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) });
    return { ok: res.ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

const SCENARIO_PATHS: Record<Exclude<Scenario, "all">, string> = {
  health: "/health",
  ready: "/ready",
  metrics: "/metrics",
  booking: "/api/v1/status",
  payment: "/api/v1/status",
  wallet: "/api/v1/status",
  websocket: "/api/v1/ws/stats",
  provider: "/api/v1/status",
  finance: "/api/v1/status",
};

async function runScenario(name: string, path: string, concurrency: number, requestsPerWorker: number): Promise<Result> {
  const latencies: number[] = [];
  let errors = 0;
  const started = Date.now();

  const workers = Array.from({ length: concurrency }, async () => {
    for (let i = 0; i < requestsPerWorker; i++) {
      const r = await hit(path);
      latencies.push(r.ms);
      if (!r.ok) errors += 1;
    }
  });

  await Promise.all(workers);
  const durationMs = Date.now() - started;
  const sorted = [...latencies].sort((a, b) => a - b);
  const totalRequests = concurrency * requestsPerWorker;

  return {
    scenario: name,
    concurrency,
    totalRequests,
    durationMs,
    throughput: round2((totalRequests / durationMs) * 1000),
    errorRate: round2((errors / totalRequests) * 100),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    errors,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  const { scenario, concurrency, requestsPerWorker } = parseArgs();
  const scenarios: Array<[string, string]> =
    scenario === "all"
      ? Object.entries(SCENARIO_PATHS)
      : [[scenario, SCENARIO_PATHS[scenario as Exclude<Scenario, "all">]]];

  console.log(`\nHOMIGO Load Test — base=${BASE} concurrency=${concurrency}\n`);
  const results: Result[] = [];
  for (const [name, path] of scenarios) {
    const result = await runScenario(name, path, concurrency, requestsPerWorker);
    results.push(result);
    console.log(JSON.stringify(result));
  }

  const summary = {
    timestamp: new Date().toISOString(),
    base: BASE,
    concurrency,
    results,
    avgP95: round2(results.reduce((s, r) => s + r.p95, 0) / results.length),
    maxErrorRate: Math.max(...results.map((r) => r.errorRate)),
  };
  console.log("\n--- SUMMARY ---");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

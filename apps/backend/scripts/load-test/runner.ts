/**
 * HOMIGO load test runner — concurrent HTTP benchmark with optional auth.
 *
 * Usage:
 *   bun run scripts/load-test/runner.ts --scenario booking --concurrency 100
 *   LOGIN_EMAIL=customer@homigo.demo LOGIN_PASSWORD=Homigo@123 bun run scripts/load-test/runner.ts --scenario all --concurrency 100
 */

const BASE = process.env.LOAD_TEST_BASE_URL || "http://localhost:3000";
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || "customer@homigo.demo";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || "Homigo@123";

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
  authenticated: boolean;
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

async function login(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD, setAuthCookies: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { accessToken?: string } };
    return json.data?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function hit(path: string, token?: string | null): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(10000) });
    return { ok: res.ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

const SCENARIO_PATHS: Record<Exclude<Scenario, "all">, string> = {
  health: "/health",
  ready: "/ready",
  metrics: "/metrics",
  booking: "/api/bookings/upcoming",
  payment: "/api/payments/history?limit=10",
  wallet: "/api/wallet/balance",
  websocket: "/api/v1/ws/stats",
  provider: "/api/services?limit=10",
  finance: "/api/wallet/transactions?limit=10",
};

const AUTH_SCENARIOS = new Set<Exclude<Scenario, "all">>([
  "booking",
  "payment",
  "wallet",
  "finance",
]);

async function runScenario(
  name: string,
  path: string,
  concurrency: number,
  requestsPerWorker: number,
  token: string | null,
): Promise<Result> {
  const latencies: number[] = [];
  let errors = 0;
  const started = Date.now();
  const useAuth = AUTH_SCENARIOS.has(name as Exclude<Scenario, "all">);
  const authToken = useAuth ? token : null;

  const workers = Array.from({ length: concurrency }, async () => {
    for (let i = 0; i < requestsPerWorker; i++) {
      const r = await hit(path, authToken);
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
    authenticated: Boolean(authToken),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  const { scenario, concurrency, requestsPerWorker } = parseArgs();
  const token = await login();
  console.log(`\nHOMIGO Load Test — base=${BASE} concurrency=${concurrency} auth=${token ? "yes" : "no"}\n`);

  const scenarios: Array<[string, string]> =
    scenario === "all"
      ? Object.entries(SCENARIO_PATHS)
      : [[scenario, SCENARIO_PATHS[scenario as Exclude<Scenario, "all">]]];

  const results: Result[] = [];
  for (const [name, path] of scenarios) {
    const result = await runScenario(name, path, concurrency, requestsPerWorker, token);
    results.push(result);
    console.log(JSON.stringify(result));
  }

  const summary = {
    timestamp: new Date().toISOString(),
    base: BASE,
    concurrency,
    authenticated: Boolean(token),
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

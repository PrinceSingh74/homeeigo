/**
 * SECTION 7A — load baseline against an ISOLATED backend.
 *
 *   DATABASE_URL="<test>" bun run scripts/chaos/7a-load-baseline.ts
 *
 * Establishes what "healthy under controlled load" looks like BEFORE any failure is injected, so
 * that every later subsection has something to be compared against. It optimises nothing and fixes
 * nothing; it measures.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 * Two independent checks, both fail-closed:
 *   1. `assertChaosTargetIsolated` — this process's own DATABASE_URL must be disposable.
 *   2. `assertServerTargetIsolated` — the SERVER being driven must report `isolatedDatabase: true`.
 *
 * The second matters more than it looks: a harness pointed at a base URL inherits whatever database
 * that server was started with, and nothing in the harness's own environment reveals it.
 *
 * ── What is sampled ─────────────────────────────────────────────────────────
 *
 * Throughput, latency percentiles and error rate come from the client. Postgres connection counts
 * come from `pg_stat_activity` on the target database, and the process's own RSS from `/metrics`.
 * Sampling runs concurrently with the load, because a connection count read after the load has
 * drained tells you nothing about saturation.
 */
import { assertChaosTargetIsolated, assertServerTargetIsolated } from "../../src/lib/chaos-isolation";

const BASE = process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const LADDER = (process.env.LADDER ?? "10,25,50,100").split(",").map(Number);
const REQUESTS_PER_WORKER = Number(process.env.REQUESTS_PER_WORKER ?? 6);
/** Read-only endpoints. A baseline must not leave state behind that changes the next run. */
const ENDPOINTS = [
  { name: "health", path: "/health", auth: false },
  { name: "services", path: "/api/services", auth: false },
  { name: "bookings", path: "/api/bookings/upcoming", auth: true },
  { name: "wallet", path: "/api/wallet/balance", auth: true },
];

const localTarget = assertChaosTargetIsolated("7A load baseline");
const serverTarget = await assertServerTargetIsolated(BASE, "7A load baseline");
console.log(`harness DB : ${localTarget.redacted}`);
console.log(`server     : ${serverTarget.redacted}\n`);

const prisma = (await import("../../src/lib/prisma")).default;

/**
 * Ensure a customer exists IN THE ISOLATED DATABASE, and return a token for it.
 *
 * The first run of this baseline authenticated as `customer@homigo.demo` — which exists in the live
 * database and not in the test one — so every authenticated step reported 100% errors and measured
 * the 401 path instead of the endpoint. Those numbers looked like a baseline and were not one.
 *
 * Provisioned through the real register endpoint rather than by inserting rows: it exercises the
 * path the application actually uses, and needs no knowledge of the user schema, hashing or PII
 * encryption to stay correct as those change.
 */
async function ensureLoadUser(): Promise<{ email: string; password: string } | null> {
  const email = process.env.LOAD_TEST_EMAIL ?? "s7baseline@homigo.test";
  /**
   * Deliberately shares no substring with the email. Registration rejects a password that is
   * `isSimilarToUsername`, and the first attempt ("Homigo@Load1" for "loadtest@homigo.test")
   * was refused as "Weak password" for similarity rather than for entropy.
   */
  const password = process.env.LOAD_TEST_PASSWORD ?? "Kf4!zQr9Wn2v";
  // Already registered from a previous run?
  if (await tokenFor(email, password)) return { email, password };

  const phoneNumber = process.env.LOAD_TEST_PHONE ?? "+919000000111";
  try {
    const otpRes = await fetch(`${BASE}/api/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber }),
      signal: AbortSignal.timeout(15_000),
    });
    const otp = ((await otpRes.json()) as { data?: { devOtp?: string } }).data?.devOtp;
    if (!otp) {
      console.error("  could not obtain a dev OTP — cannot provision the load user");
      return null;
    }
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        phoneNumber,
        firstName: "Load",
        lastName: "Baseline",
        password,
        confirmPassword: password,
        otp,
        agreeToTerms: true,
        setAuthCookies: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!reg.ok) console.error(`  register failed: ${reg.status} ${(await reg.text()).slice(0, 160)}`);
  } catch (err) {
    console.error("  provisioning failed:", err instanceof Error ? err.message : String(err));
  }
  return (await tokenFor(email, password)) ? { email, password } : null;
}

async function tokenFor(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, setAuthCookies: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: { accessToken?: string } }).data?.accessToken ?? null;
  } catch {
    return null;
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function dbConnections(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database()`;
  return Number(rows[0]?.n ?? 0);
}

async function processRssMb(): Promise<number | null> {
  try {
    const text = await (await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(8_000) })).text();
    const m = text.match(/^process_resident_memory_bytes\s+([0-9.e+]+)/m);
    return m ? Math.round(Number(m[1]) / 1024 / 1024) : null;
  } catch {
    return null;
  }
}

type Row = {
  endpoint: string;
  concurrency: number;
  requests: number;
  ok: number;
  errorPct: number;
  throughput: number;
  p50: number;
  p95: number;
  p99: number;
  peakDbConns: number;
  rssMb: number | null;
};

async function runStep(
  endpoint: (typeof ENDPOINTS)[number],
  concurrency: number,
  token: string | null,
): Promise<Row> {
  const latencies: number[] = [];
  let ok = 0;
  let peakDbConns = 0;
  let sampling = true;

  // Sampled DURING the load — a connection count read afterwards has already drained.
  const sampler = (async () => {
    while (sampling) {
      try {
        peakDbConns = Math.max(peakDbConns, await dbConnections());
      } catch {
        /* a sampling failure must not fail the measurement it is observing */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  })();

  const headers: Record<string, string> =
    endpoint.auth && token ? { Authorization: `Bearer ${token}` } : {};
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < REQUESTS_PER_WORKER; i++) {
        const t0 = Date.now();
        try {
          const res = await fetch(`${BASE}${endpoint.path}`, {
            headers,
            signal: AbortSignal.timeout(30_000),
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
  return {
    endpoint: endpoint.name,
    concurrency,
    requests,
    ok,
    errorPct: Number((((requests - ok) / requests) * 100).toFixed(1)),
    throughput: Number((requests / (durationMs / 1000)).toFixed(1)),
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    peakDbConns,
    rssMb: await processRssMb(),
  };
}

/**
 * Machine state, recorded WITH the numbers.
 *
 * Without this the baseline is unfalsifiable. An early run of this harness reported the bookings
 * endpoint peaking at 111 rps and FALLING past concurrency 50; a later run of the same code against
 * the same database reported 328 rps and rising. Connection pool size, query plans, lock waits,
 * transaction age and process age were each investigated and each cleared — and the discrepancy
 * still could not be settled, because nothing had recorded what else the machine was doing. Four
 * other dev servers were running during one of those runs and not the other, which is the most
 * likely explanation and remains unproven, because the evidence was never captured.
 *
 * A throughput number without the machine it was measured on is not a measurement.
 */
async function machineState(): Promise<string> {
  try {
    const { spawnSync } = await import("node:child_process");
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$os = Get-CimInstance Win32_OperatingSystem;" +
          "$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage;" +
          "$listen = (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |" +
          " Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3110 } |" +
          " Select-Object -ExpandProperty LocalPort -Unique | Sort-Object) -join ',';" +
          "'{0:N2} GB free of {1:N2} GB | CPU {2}% | listeners {3}' -f" +
          " ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB), $cpu, $listen",
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
    const out = (ps.stdout ?? "").trim();
    if (out) return out;
    /**
     * A telemetry probe that fails must say so, loudly.
     *
     * The first version returned the string "(machine state unavailable)" and the run carried on
     * printing throughput numbers underneath it. That is a measurement with its context silently
     * missing — exactly the class of failure this whole section exists to catch. A run that cannot
     * record what the machine was doing is not a run whose numbers can be signed off.
     */
    throw new Error(
      `machine-state probe produced no output (status=${ps.status}, signal=${ps.signal}, ` +
        `stderr=${(ps.stderr ?? "").trim().slice(0, 200) || "none"})`,
    );
  } catch (err) {
    throw new Error(
      `MACHINE-STATE PROBE FAILED — refusing to report throughput without it: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const machineBefore = await machineState();
console.log(`machine    : ${machineBefore}`);

const creds = await ensureLoadUser();
const token = creds ? await tokenFor(creds.email, creds.password) : null;
/**
 * A baseline that cannot authenticate is not a baseline — the authenticated rows would measure the
 * 401 path and report it as throughput. Refuse rather than publish numbers that mean nothing.
 */
if (!token) {
  console.error(
    "\nREFUSING TO PUBLISH A BASELINE: could not authenticate against the isolated server, so the " +
      "authenticated endpoints would measure 401 responses and report them as throughput.",
  );
  process.exit(1);
}
console.log(`authenticated as ${creds!.email} ✔`);
console.log(`idle DB connections: ${await dbConnections()}`);
console.log(`idle RSS: ${(await processRssMb()) ?? "?"} MB\n`);

const rows: Row[] = [];
for (const endpoint of ENDPOINTS) {
  for (const concurrency of LADDER) {
    rows.push(await runStep(endpoint, concurrency, token));
  }
}

console.log(
  "endpoint   conc  reqs   err%   rps      p50    p95    p99    peakConns  rss",
);
for (const r of rows) {
  console.log(
    `${r.endpoint.padEnd(10)} ${String(r.concurrency).padStart(4)} ${String(r.requests).padStart(5)} ` +
      `${String(r.errorPct).padStart(6)} ${String(r.throughput).padStart(8)} ` +
      `${String(r.p50).padStart(6)} ${String(r.p95).padStart(6)} ${String(r.p99).padStart(6)} ` +
      `${String(r.peakDbConns).padStart(10)} ${String(r.rssMb ?? "?").padStart(4)}`,
  );
}

console.log(`\nsettled DB connections: ${await dbConnections()}`);
// Printed at both ends: a run whose machine changed underneath it is a run to discard, and that is
// only visible if both readings are on the page.
console.log(`machine before: ${machineBefore}`);
console.log(`machine after : ${await machineState()}`);
await prisma.$disconnect();

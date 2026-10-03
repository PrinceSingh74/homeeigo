/**
 * SECTION 7F — shared harness for HTTP/API burst, concurrency, timeout and resilience work.
 *
 * Three things this file exists to prevent, each of which produced a false result in an earlier
 * section and would produce a worse one here:
 *
 *  1. Driving the wrong server. A base URL says nothing about which database is behind it, so the
 *     SERVER is asked (`/health.isolatedDatabase`) and the answer is required, not assumed.
 *  2. Calling a process "ready" because it answered. HTTP 200 from a server whose database is
 *     unreachable is still 200. Readiness here is semantic: status ok AND database ok.
 *  3. Reporting numbers from a machine whose state was never recorded. Every measurement carries the
 *     machine it came from, and a telemetry probe that fails throws rather than returning a blank.
 */
import { assertChaosTargetIsolated, assertServerTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";

/**
 * The local barrier fires on IMPORT, before any scenario can run and before any process can be
 * spawned.
 *
 * It first lived inside a per-scenario `assertIsolation()` that ran after the scenario had already
 * started a server. The barrier did fire — and by then a full backend had booted against the live
 * database, run its boot sequence and its first maintenance tick. A guard placed after the dangerous
 * action is not a guard; it is a report. Importing this module is now enough to be stopped, and
 * `startServer` asserts again immediately before spawning, so neither a new scenario nor a
 * reordering can get a process started against the wrong database.
 */
assertChaosTargetIsolated("7F harness import");

// ── targets ───────────────────────────────────────────────────────────────────────────────────────

/**
 * 7F runs its own server rather than borrowing the long-lived chaos backend on :3100.
 *
 * Restart-under-load, flag changes (LOAD_TEST_MODE on for the ladder, off for the rate-limit work)
 * and PID verification all require owning the process. Borrowing one also means a second process
 * ticking maintenance and scheduled jobs against the same database throughout every measurement —
 * exactly the third-claimer contamination that invalidated a 7E scenario until it was removed.
 */
export const PORT = Number(process.env.SEVEN_F_PORT ?? 3200);
export const BASE = `http://127.0.0.1:${PORT}`;

export type Gates = {
  runId: string;
  db: ReturnType<typeof describeDatabaseTarget>;
  redis: ReturnType<typeof describeRedisTarget>;
};

export function newRunId(prefix: string): string {
  return `7f-${prefix}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

// ── process control ───────────────────────────────────────────────────────────────────────────────

export type ServerHandle = {
  pid: number;
  port: number;
  env: Record<string, string>;
  /** Raw spawn handle; on Windows its pid is a launcher, so `listenerPid` is the real one. */
  proc: ReturnType<typeof Bun.spawn>;
  listenerPid: number;
  logPath: string;
};

/**
 * The pid that OWNS the listening socket, which on Windows is not the pid `Bun.spawn` returns —
 * `bun run <file>` launches the script in a separate process, and killing the launcher leaves the
 * real server alive. 7E lost a scenario to exactly this before it was measured rather than assumed.
 */
export function listenerPidOn(port: number): number | null {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c[0].OwningProcess } else { '' }`,
  ]);
  const out = ps.stdout.toString().trim();
  return out ? Number(out) : null;
}

/**
 * Kills a process and its children.
 *
 * Done through PowerShell rather than `taskkill /PID`: under the Git-Bash shell this session uses,
 * MSYS rewrites a leading `/PID` into a Windows path and taskkill rejects it, so a "kill" can report
 * failure — or, worse, be assumed to have worked. Walking Win32_Process for children first also
 * matters because `bun run <file>` puts the real server one level below the pid we hold.
 */
export function killTree(pid: number): boolean {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    `$ErrorActionPreference='SilentlyContinue';` +
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force };` +
      `Stop-Process -Id ${pid} -Force;` +
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`,
  ]);
  return ps.stdout.toString().trim().endsWith("gone");
}

/** Kills whatever is listening on the port, plus any 7F server launcher left behind. */
export function clearPort(port: number): number {
  let killed = 0;
  for (let i = 0; i < 5; i++) {
    const pid = listenerPidOn(port);
    if (pid === null) break;
    killTree(pid);
    killed++;
    Bun.spawnSync(["powershell", "-NoProfile", "-Command", "Start-Sleep -Milliseconds 400"]);
  }
  return killed;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts a backend dedicated to this run and refuses to hand it back until it is SEMANTICALLY ready.
 *
 * `env` is spread over the parent environment, so a caller turning LOAD_TEST_MODE off for the
 * rate-limit scenarios must pass an empty string rather than omitting the key — the value is
 * recorded in the evidence either way, because "which limiter was active" changes what the numbers
 * mean.
 */
export async function startServer(opts: {
  env: Record<string, string>;
  logPath: string;
  port?: number;
  readyTimeoutMs?: number;
}): Promise<ServerHandle> {
  // Re-asserted immediately before the spawn, not only at import: the child inherits DATABASE_URL,
  // so this is the last point at which a wrong target can still be stopped for free.
  assertChaosTargetIsolated("7F server start");
  const port = opts.port ?? PORT;
  const stale = clearPort(port);
  if (stale > 0) console.log(`  [warn] cleared ${stale} stale listener(s) on :${port} before starting`);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    ...opts.env,
  };
  const logFile = Bun.file(opts.logPath);
  await Bun.write(logFile, "");
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: process.cwd(),
    env,
    stdout: Bun.file(opts.logPath),
    stderr: Bun.file(opts.logPath),
  });

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 60_000);
  let listenerPid: number | null = null;
  while (Date.now() < deadline) {
    await sleep(400);
    const health = await probeHealth(port).catch(() => null);
    if (health?.ready) {
      listenerPid = listenerPidOn(port);
      if (listenerPid !== null) break;
    }
  }
  if (listenerPid === null) {
    const tail = (await Bun.file(opts.logPath).text().catch(() => "")).slice(-1500);
    killTree(proc.pid);
    clearPort(port);
    throw new Error(`7F SETUP: server on :${port} never became semantically ready.\n--- server log tail ---\n${tail}`);
  }

  return { pid: proc.pid, listenerPid, port, env: opts.env, proc, logPath: opts.logPath };
}

export function stopServer(h: ServerHandle): void {
  killTree(h.listenerPid);
  killTree(h.proc.pid);
  clearPort(h.port);
}

// ── readiness, the semantic kind ──────────────────────────────────────────────────────────────────

export type Health = {
  httpOk: boolean;
  status: string;
  database: string;
  redis: string;
  isolatedDatabase: boolean;
  environment: string;
  /** Semantic readiness: answering is not the same as being able to serve. */
  ready: boolean;
};

/**
 * The 15s budget is deliberate, not generous.
 *
 * `/health` calls `redisClient.healthCheck()`, which is bounded by the 5s Redis command deadline
 * (7C). With Redis frozen the endpoint therefore answers at ~5.03s — and a probe that aborted at
 * exactly 5000ms raced it, timed out, and reported a server that "never became ready" when it was
 * answering correctly a few milliseconds later. A probe's deadline has to be longer than the
 * deadlines of everything it is observing, or it measures itself.
 */
export async function probeHealth(port = PORT, timeoutMs = 15_000): Promise<Health> {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json()) as {
    status?: string;
    services?: { database?: string; redis?: string };
    isolatedDatabase?: boolean;
    environment?: string;
  };
  const status = body.status ?? "";
  const database = body.services?.database ?? "";
  const redis = body.services?.redis ?? "";
  return {
    httpOk: res.ok,
    status,
    database,
    redis,
    isolatedDatabase: body.isolatedDatabase === true,
    environment: body.environment ?? "",
    ready: res.ok && status === "ok" && database === "ok",
  };
}

/** Both barriers: the harness's own DB env, and the database the SERVER is actually attached to. */
export async function assertIsolation(scenario: string, port = PORT): Promise<Gates> {
  assertChaosTargetIsolated(scenario);
  await assertServerTargetIsolated(`http://127.0.0.1:${port}`, scenario);
  const health = await probeHealth(port);
  if (!health.ready) {
    throw new Error(
      `7F SETUP: "${scenario}" refused — :${port} is not semantically ready ` +
        `(status=${health.status} database=${health.database}). An HTTP 200 from a server that cannot reach its database is still 200.`,
    );
  }
  return {
    runId: newRunId(scenario.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 24)),
    db: describeDatabaseTarget(),
    redis: describeRedisTarget(),
  };
}

// ── telemetry ─────────────────────────────────────────────────────────────────────────────────────

export type Telemetry = {
  rssMb: number;
  heapUsedMb: number;
  redisUp: number;
  redisClients: number;
  httpTotal: number;
  dbConnections: number;
  dbActive: number;
  dbIdleInTx: number;
  dbPoolWaitHint: number;
};

/**
 * Scraped from the server's own `/metrics` plus the database's own view.
 *
 * Throws on failure rather than returning zeroes. A silently-blank telemetry row reads exactly like
 * a healthy one, and every capacity claim in this section rests on these numbers being real.
 */
export async function telemetry(prisma: { $queryRawUnsafe: (q: string) => Promise<unknown> }, port = PORT): Promise<Telemetry> {
  const res = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`telemetry: /metrics returned ${res.status}`);
  const text = await res.text();
  const gauge = (name: string): number => {
    const m = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, "m"));
    if (!m) throw new Error(`telemetry: metric ${name} absent from /metrics — the probe would otherwise report 0 and look healthy`);
    return Number(m[1]);
  };
  const sumFamily = (name: string): number => {
    const re = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, "gm");
    let total = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) total += Number(m[1]);
    return total;
  };

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE state = 'active')::int AS active,
           count(*) FILTER (WHERE state = 'idle in transaction')::int AS idletx,
           count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lockwait
    FROM pg_stat_activity WHERE datname = current_database()
  `)) as Array<{ total: number; active: number; idletx: number; lockwait: number }>;

  return {
    rssMb: Math.round(gauge("process_resident_memory_bytes") / 1048576),
    heapUsedMb: Math.round(gauge("nodejs_heap_used_bytes") / 1048576),
    redisUp: gauge("redis_up"),
    redisClients: gauge("redis_connected_clients"),
    httpTotal: sumFamily("http_requests_total"),
    dbConnections: rows[0]?.total ?? 0,
    dbActive: rows[0]?.active ?? 0,
    dbIdleInTx: rows[0]?.idletx ?? 0,
    dbPoolWaitHint: rows[0]?.lockwait ?? 0,
  };
}

/** Host-level state, recorded at both ends of every measured run. Throws if it cannot be read. */
export async function machineState(): Promise<string> {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    "$os = Get-CimInstance Win32_OperatingSystem; " +
      "$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; " +
      "'{0}|{1}|{2}' -f [math]::Round($os.FreePhysicalMemory/1024), [math]::Round($os.TotalVisibleMemorySize/1024), $cpu",
  ]);
  const out = ps.stdout.toString().trim();
  const [freeMb, totalMb, cpu] = out.split("|");
  if (!freeMb || !totalMb) throw new Error(`machine state probe failed (exit ${ps.exitCode}): ${out || ps.stderr.toString().trim()}`);
  return `RAM free ${freeMb}MB / ${totalMb}MB, CPU load ${cpu || "?"}%`;
}

// ── load driver ───────────────────────────────────────────────────────────────────────────────────

export type Call = {
  label: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  auth?: boolean;
  /** Relative share when mixed with others; defaults to 1. */
  weight?: number;
  /** Statuses that are a correct outcome for this call, so they are not counted as errors. */
  expect?: number[];
};

export type LoadResult = {
  label: string;
  concurrency: number;
  durationMs: number;
  requests: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  statuses: Record<string, number>;
  errors: number;
  timeouts: number;
  networkErrors: number;
  maxInFlight: number;
  /**
   * True when wall-clock time advanced far beyond the requested duration — the signature of the
   * machine suspending mid-run. A 6-minute soak that spanned a Modern Standby reported rps=8.5 and a
   * single "request" lasting 4.6 hours, because `Date.now()` jumped while the process was frozen.
   * Those numbers look like a catastrophic server failure and are simply not a measurement.
   */
  clockJumped: boolean;
  /**
   * Per-endpoint breakdown of a mixed run. Starvation is a statement about ONE endpoint inside a
   * mix, so an aggregate number cannot express it — a fast endpoint and a starved one average into
   * something that looks merely mediocre.
   */
  byLabel: Record<string, { n: number; p50: number; p95: number; max: number; errors: number }>;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i]!);
}

/**
 * Sustained closed-loop concurrency: `concurrency` workers each issue one request at a time for
 * `durationMs`. Closed-loop on purpose — an open-loop generator on a laptop measures the generator's
 * own scheduling under stress as much as the server's, and the question here is how the server
 * behaves when N clients are genuinely waiting on it.
 *
 * The harness performs NO retries. A retry here would silently repair the very amplification and
 * backpressure behaviour the section exists to measure.
 */
export async function drive(opts: {
  calls: Call[];
  concurrency: number;
  durationMs: number;
  token?: string;
  timeoutMs?: number;
  label?: string;
  /** Called with each completed sample; used by scenarios that need per-request timelines. */
  onSample?: (s: { label: string; status: number | null; ms: number; at: number }) => void;
}): Promise<LoadResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const latencies: number[] = [];
  const perLabel = new Map<string, { lat: number[]; errors: number }>();
  const statuses: Record<string, number> = {};
  let timeouts = 0;
  let networkErrors = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  // Weighted expansion once, then round-robin: keeps the mix exact instead of statistical.
  const pool: Call[] = [];
  for (const c of opts.calls) for (let i = 0; i < (c.weight ?? 1); i++) pool.push(c);

  const started = Date.now();
  const deadline = started + opts.durationMs;
  let cursor = 0;

  const worker = async () => {
    while (Date.now() < deadline) {
      const call = pool[cursor++ % pool.length]!;
      const t0 = Date.now();
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      let status: number | null = null;
      try {
        const res = await fetch(`${BASE}${call.path}`, {
          method: call.method,
          headers: {
            "content-type": "application/json",
            ...(call.auth && opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          },
          body: call.method === "POST" ? JSON.stringify(call.body ?? {}) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = res.status;
        await res.arrayBuffer(); // drain, so the socket is released rather than left half-read
      } catch (err) {
        const name = (err as { name?: string } | null)?.name ?? "";
        if (name === "TimeoutError" || name === "AbortError") timeouts++;
        else networkErrors++;
      } finally {
        inFlight--;
      }
      const ms = Date.now() - t0;
      latencies.push(ms);
      const key = status === null ? "network/timeout" : String(status);
      statuses[key] = (statuses[key] ?? 0) + 1;
      let bucket = perLabel.get(call.label);
      if (!bucket) {
        bucket = { lat: [], errors: 0 };
        perLabel.set(call.label, bucket);
      }
      bucket.lat.push(ms);
      if (status === null || !(call.expect ?? [200, 201]).includes(status)) bucket.errors++;
      opts.onSample?.({ label: call.label, status, ms, at: t0 });
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  const durationMs = Date.now() - started;
  // 1.5× the requested window is generous for scheduling overhead and far below what a suspend costs.
  const clockJumped = durationMs > opts.durationMs * 1.5 + 30_000;
  latencies.sort((a, b) => a - b);

  const expected = new Set<number>();
  for (const c of opts.calls) for (const s of c.expect ?? [200, 201]) expected.add(s);
  let errors = 0;
  for (const [k, n] of Object.entries(statuses)) {
    if (k === "network/timeout") continue;
    if (!expected.has(Number(k))) errors += n;
  }

  const byLabel: LoadResult["byLabel"] = {};
  for (const [label, b] of perLabel) {
    const sorted = b.lat.slice().sort((x, y) => x - y);
    byLabel[label] = {
      n: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1] ?? 0,
      errors: b.errors,
    };
  }

  return {
    byLabel,
    clockJumped,
    label: opts.label ?? opts.calls.map((c) => c.label).join("+"),
    concurrency: opts.concurrency,
    durationMs,
    requests: latencies.length,
    rps: Math.round((latencies.length / durationMs) * 1000 * 10) / 10,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    min: latencies[0] ?? 0,
    max: latencies[latencies.length - 1] ?? 0,
    statuses,
    errors,
    timeouts,
    networkErrors,
    maxInFlight,
  };
}

// ── identity ──────────────────────────────────────────────────────────────────────────────────────

export const LOAD_USER_EMAIL = process.env.SEVEN_F_EMAIL ?? "s7f.load@homigo.test";
export const LOAD_USER_PASSWORD = process.env.SEVEN_F_PASSWORD ?? "Qx7!mVt4Rp9z";

/**
 * Provisions the load identity through the REAL register endpoint, then logs in for a token.
 *
 * Registering rather than inserting rows means the account passes the same validation, hashing and
 * side effects a real signup does, so an authenticated measurement is not quietly exercising a
 * fixture the product would never have produced. Returns null rather than a fake token: a scenario
 * that cannot authenticate must refuse to publish numbers, not publish 401 latencies as if they were
 * the endpoint's.
 */
export async function authenticate(): Promise<string | null> {
  const login = async (): Promise<string | null> => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: LOAD_USER_EMAIL, password: LOAD_USER_PASSWORD }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { accessToken?: string; tokens?: { accessToken?: string } } };
    return body.data?.accessToken ?? body.data?.tokens?.accessToken ?? null;
  };

  const existing = await login();
  if (existing) return existing;

  /**
   * Field names taken from `schemas/auth.schema.ts`, not from what a registration payload "usually"
   * looks like — the first version of this used name/phone/role and every attempt came back 400.
   * An `@homigo.test` address also skips the hourly per-IP register limiter by design, so repeated
   * runs on one machine are not throttled into a false failure.
   */
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: LOAD_USER_EMAIL,
      password: LOAD_USER_PASSWORD,
      confirmPassword: LOAD_USER_PASSWORD,
      firstName: "Section",
      lastName: "SevenF",
      // E.164, because the schema requires length >= 13 — a bare 10-digit number is rejected.
      phoneNumber: `+91${Math.floor(7000000000 + Math.random() * 999999999)}`,
      userType: "customer",
      agreeToTerms: true,
      setAuthCookies: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!reg.ok) {
    console.error(`  register failed: ${reg.status} ${(await reg.text()).slice(0, 200)}`);
    return null;
  }
  return login();
}

// ── evidence ──────────────────────────────────────────────────────────────────────────────────────

export type Status = "PASS" | "FAIL" | "NOT_PROVEN" | "INFO";
export type Check = { id: string; title: string; status: Status; detail: string };

export function makeRecorder(checks: Check[]) {
  return (id: string, title: string, status: Status, detail: string) => {
    checks.push({ id, title, status, detail });
    const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : status === "NOT_PROVEN" ? "????" : "info";
    console.log(`  [${mark}] ${id} ${title}\n         ${detail}`);
  };
}

export function formatLoad(r: LoadResult): string {
  const suspended = r.clockJumped
    ? " ⚠ CLOCK JUMPED — the machine suspended during this run and these numbers are not a measurement"
    : "";
  const st = Object.entries(r.statuses)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  return (
    `c=${String(r.concurrency).padStart(3)} rps=${String(r.rps).padStart(7)} ` +
    `p50=${String(r.p50).padStart(5)}ms p95=${String(r.p95).padStart(6)}ms p99=${String(r.p99).padStart(6)}ms ` +
    `max=${String(r.max).padStart(6)}ms n=${r.requests} err=${r.errors} to=${r.timeouts} net=${r.networkErrors} [${st}]${suspended}`
  );
}

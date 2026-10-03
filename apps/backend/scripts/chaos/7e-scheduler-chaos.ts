/**
 * SECTION 7E — scheduler / distributed lock stress, leadership, recovery.
 *
 *   DATABASE_URL="<homigo_test>" REDIS_URL="redis://localhost:6380" \
 *     bun run scripts/chaos/7e-scheduler-chaos.ts --test all
 *
 * What this measures, and why it is built the way it is:
 *
 * Leadership is a property BETWEEN processes. `INSTANCE_ID` in `lib/distributed-scheduler` is
 * module-global, so two `runWithLeaderLock` calls inside one process are the same node wearing two
 * hats — they can demonstrate re-entrancy but nothing at all about two servers. Every contention
 * test here therefore spawns real `7e-contender.ts` processes, and every conclusion is drawn from
 * rows those processes wrote, never from this orchestrator's own view of what "should" have happened.
 *
 * A double-leadership defect has exactly one observable shape: two instances occupying the protected
 * section over overlapping wall-clock intervals. That is the primitive `overlaps()` computes, and
 * every mutual-exclusion invariant below is a statement about it.
 */
import net from "node:net";
import { assertChaosTargetIsolated, assertRedisTargetIsolated } from "../../src/lib/chaos-isolation";

const SCENARIO = "7E scheduler/lock chaos";
const dbTarget = assertChaosTargetIsolated(SCENARIO);
const redisTarget = assertRedisTargetIsolated(SCENARIO);

const REDIS_CONTAINER = process.env.CHAOS_REDIS_CONTAINER || "homigo-staging-redis";
const REDIS_PORT = Number(redisTarget.port);

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const SELECTED = arg("test", "all");
const RUN_TAG = arg("tag", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

const prisma = (await import("../../src/lib/prisma")).default;
const { redisClient } = await import("../../src/lib/redis");

/**
 * `redisClient` connects only when `connect()` is called — the server does it at boot, a script must
 * do it itself. Without this, `isAvailable` stays false, every lock call quietly takes the
 * per-process in-memory fallback, and the harness measures a private map while reporting on a
 * distributed lock. This is a readiness gate in the 7C sense: reachable is not the same as ready,
 * and the run refuses to start rather than produce results about the wrong code path.
 */
await redisClient.connect().catch(() => {});
if (!redisClient.isAvailable) {
  throw new Error(
    `CHAOS SETUP: 7E refused — redisClient.connect() did not yield an available client for ${redisTarget.redacted}. ` +
      "Every lock call would silently use the in-memory fallback and the results would describe a private map, not a distributed lock.",
  );
}

// ── evidence model ────────────────────────────────────────────────────────────────────────────────

type Status = "PASS" | "FAIL" | "NOT_PROVEN" | "INFO";
type Check = { id: string; title: string; status: Status; detail: string };
const checks: Check[] = [];
const record = (id: string, title: string, status: Status, detail: string) => {
  checks.push({ id, title, status, detail });
  const mark = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : status === "NOT_PROVEN" ? "????" : "info";
  console.log(`  [${mark}] ${id} ${title}\n         ${detail}`);
};

type Marker = {
  run: string;
  instance: string;
  pid: number;
  lockKey: string;
  exclusive: boolean;
  at: number;
  phase: "entered" | "exited" | "refused" | "summary";
  leadershipLost?: boolean;
  entries?: number;
  refusals?: number;
  redisAvailable?: boolean;
  lockFallbackTotal?: number;
  anchorTotal?: number;
  redisUnavailableTotal?: number;
  leaseLostTotal?: number;
};

/**
 * Guards every contention result against the failure that produced a false finding on the first run
 * of this harness: a contender whose Redis client never connected holds a private in-memory lock,
 * enters unopposed, and is indistinguishable from a broken distributed lock.
 */
function redisPathCheck(id: string, ms: Marker[]): boolean {
  const summaries = ms.filter((m) => m.phase === "summary");
  const ok = summaries.length > 0 && summaries.every((s) => s.redisAvailable === true);
  record(
    id,
    "each contender's lock calls actually reached Redis (not its own in-memory map)",
    summaries.length === 0 ? "NOT_PROVEN" : ok ? "PASS" : "FAIL",
    `summaries=${summaries.length} redisAvailable=${JSON.stringify(summaries.map((s) => s.redisAvailable))}`,
  );
  return ok;
}

type Occupancy = { instance: string; pid: number; enteredAt: number; exitedAt: number | null; leadershipLost: boolean };

async function markers(run: string): Promise<Marker[]> {
  const rows = await prisma.scheduledJob.findMany({
    where: { jobType: `7e-${run}` },
    orderBy: { createdAt: "asc" },
    select: { payload: true },
  });
  return rows.map((r) => r.payload as unknown as Marker).sort((a, b) => a.at - b.at);
}

/**
 * Pairs each "entered" with its instance's next "exited". A killed process never writes "exited",
 * which is exactly the case the crash test needs to see, so an unclosed interval is represented as
 * `exitedAt: null` rather than dropped — dropping it would hide the crash.
 */
function occupancies(ms: Marker[]): Occupancy[] {
  const out: Occupancy[] = [];
  const open = new Map<string, Occupancy>();
  for (const m of ms) {
    if (m.phase === "entered") {
      const occ: Occupancy = { instance: m.instance, pid: m.pid, enteredAt: m.at, exitedAt: null, leadershipLost: false };
      open.set(m.instance, occ);
      out.push(occ);
    } else if (m.phase === "exited") {
      const occ = open.get(m.instance);
      if (occ) {
        occ.exitedAt = m.at;
        occ.leadershipLost = Boolean(m.leadershipLost);
        open.delete(m.instance);
      }
    }
  }
  return out;
}

/**
 * Overlapping occupancy by DIFFERENT instances. An interval still open at `now` is treated as
 * running until `now`: a crashed holder really was inside the section for that whole time, and
 * treating it as zero-length would manufacture a pass.
 */
function overlaps(occ: Occupancy[], now = Date.now()): Array<{ a: Occupancy; b: Occupancy; ms: number }> {
  const end = (o: Occupancy) => o.exitedAt ?? now;
  const found: Array<{ a: Occupancy; b: Occupancy; ms: number }> = [];
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i]!;
      const b = occ[j]!;
      if (a.instance === b.instance) continue;
      const ms = Math.min(end(a), end(b)) - Math.max(a.enteredAt, b.enteredAt);
      if (ms > 0) found.push({ a, b, ms });
    }
  }
  return found;
}

// ── contender processes ───────────────────────────────────────────────────────────────────────────

type Contender = { proc: ReturnType<typeof Bun.spawn>; label: string };

/**
 * Contenders demand a live Redis unless the test is explicitly about Redis being down. A contender
 * that quietly ran on its in-memory fallback would enter the section unopposed and look exactly like
 * a mutual-exclusion defect, so the default is to abort at the source instead.
 */
function spawnContender(label: string, args: string[]): Contender {
  const withGate = args.includes("--allow-redis-down") ? args : [...args, "--require-redis"];
  const proc = Bun.spawn(["bun", "run", "scripts/chaos/7e-contender.ts", ...withGate], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { proc, label };
}

/**
 * Bounded on purpose. An unbounded wait once turned a contender that had finished its work but never
 * released its Redis socket into a silent, indefinite hang of the whole suite — the run looked stuck
 * on a test that had in fact passed. A timeout here converts that class of harness fault into a
 * reported failure with a process kill, which is the difference between a diagnosable run and a
 * run that just stops.
 */
async function settle(c: Contender, maxMs = 120_000): Promise<{ code: number; out: string; err: string; timedOut: boolean }> {
  let timedOut = false;
  const guard = setTimeout(() => {
    timedOut = true;
    console.log(`  [warn] contender ${c.label} exceeded ${maxMs}ms — killing`);
    // The launcher's own kill leaves the script process alive holding the pipe write end, so the
    // stream reads below never finish and the timeout turns one stuck contender into a stuck suite.
    // Killing the tree closes the pipes.
    hardKill(c.proc.pid);
    killStrayContenders();
  }, maxMs);
  try {
    const [out, err, code] = await Promise.all([
      new Response(c.proc.stdout as ReadableStream).text(),
      new Response(c.proc.stderr as ReadableStream).text(),
      c.proc.exited,
    ]);
    return { code, out, err, timedOut };
  } finally {
    clearTimeout(guard);
  }
}

/**
 * Kills a process by OS pid, with its children.
 *
 * `Bun.spawn(["bun", ...])` on Windows returns the pid of a launcher, not of the process that ends up
 * running the script: `proc.kill(9)` terminated the launcher and left the real contender alive,
 * renewing its lease. The crash test then observed a lock that never expired and a successor that
 * never got in, and would have reported a permanently stuck lock as a product defect. The contender
 * writes its own `process.pid` into every marker, so the crash test kills the process that is
 * demonstrably holding the lock rather than the one the spawn handle happens to name.
 */
function hardKill(pid: number): boolean {
  const p = Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"]);
  return p.exitCode === 0;
}

/** Sweeps any contender left behind by a killed or timed-out scenario, so runs cannot contaminate. */
function killStrayContenders(): number {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='bun.exe'\" | Where-Object { $_.CommandLine -like '*7e-contender*' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null; $_.ProcessId }",
  ]);
  const out = ps.stdout.toString().trim();
  return out ? out.split(/\r?\n/).filter(Boolean).length : 0;
}

// ── Redis freeze, and proof that it froze ─────────────────────────────────────────────────────────

async function docker(cmd: "pause" | "unpause"): Promise<void> {
  const p = Bun.spawn(["docker", cmd, REDIS_CONTAINER], { stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0) {
    const err = await new Response(p.stderr as ReadableStream).text();
    throw new Error(`docker ${cmd} ${REDIS_CONTAINER} failed (${code}): ${err.trim()}`);
  }
}

/**
 * PING over a host TCP socket, never `docker exec`.
 *
 * A paused container cannot start a process, so `docker exec redis-cli PING` against a frozen Redis
 * either fails to launch or reports a fast local round trip — in 7C that made a stall that never
 * happened look like a stall that did. The only honest measurement is from outside the container,
 * across the same socket the application uses.
 */
function pingLatencyMs(timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => finish(null));
    sock.on("error", () => finish(null));
    sock.on("data", (buf) => {
      if (buf.toString().includes("PONG")) finish(Date.now() - started);
    });
    sock.connect(REDIS_PORT, "127.0.0.1", () => sock.write("*1\r\n$4\r\nPING\r\n"));
  });
}

// ── lock-state probes ─────────────────────────────────────────────────────────────────────────────

async function redisCmd(args: string[]): Promise<string> {
  const p = Bun.spawn(["docker", "exec", REDIS_CONTAINER, "redis-cli", ...args], { stdout: "pipe", stderr: "pipe" });
  await p.exited;
  return (await new Response(p.stdout as ReadableStream).text()).trim();
}

async function strayLockKeys(): Promise<string[]> {
  const out = await redisCmd(["--scan", "--pattern", "lock:7e:*"]);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

async function advisoryLockCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype = 'advisory'
  `;
  return Number(rows[0]?.n ?? 0);
}

async function cleanupRun(run: string): Promise<number> {
  const res = await prisma.scheduledJob.deleteMany({ where: { jobType: `7e-${run}` } });
  return res.count;
}

const key = (name: string) => `7e:${RUN_TAG}:${name}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── tests ─────────────────────────────────────────────────────────────────────────────────────────

const runs: string[] = [];
function newRun(name: string): string {
  const r = `${RUN_TAG}-${name}`;
  runs.push(r);
  return r;
}

/** BASELINE — one instance, uncontended, repeated. Establishes that the happy path is boring. */
async function baseline(pass: number): Promise<void> {
  console.log(`\n── BASELINE pass ${pass} ─────────────────────────────`);
  const run = newRun(`base${pass}`);
  const k = key(`base${pass}`);
  const started = Date.now();
  const c = spawnContender("base", ["--run", run, "--key", k, "--hold", "150", "--attempts", "12", "--gap", "60", "--ttl", "10"]);
  const res = await settle(c);
  const elapsed = Date.now() - started;
  const ms = await markers(run);
  const summary = ms.find((m) => m.phase === "summary");
  const occ = occupancies(ms);

  record(
    `B${pass}-1`,
    "uncontended acquisition always succeeds",
    res.code === 0 && summary?.entries === 12 && summary?.refusals === 0 ? "PASS" : "FAIL",
    `exit=${res.code} entries=${summary?.entries ?? "n/a"} refusals=${summary?.refusals ?? "n/a"} wall=${elapsed}ms${res.code !== 0 ? ` stderr=${res.err.trim().slice(0, 300)}` : ""}`,
  );
  record(
    `B${pass}-2`,
    "no lease loss and no fallback on a healthy path",
    summary && summary.leaseLostTotal === 0 && summary.lockFallbackTotal === 0 ? "PASS" : summary ? "FAIL" : "NOT_PROVEN",
    `lease_lost=${summary?.leaseLostTotal ?? "n/a"} lock_fallback=${summary?.lockFallbackTotal ?? "n/a"}`,
  );
  record(
    `B${pass}-3`,
    "lock released on exit (next acquisition is immediate, not TTL-bound)",
    occ.length >= 2 && occ.every((o) => o.exitedAt !== null) ? "PASS" : "FAIL",
    `occupancies=${occ.length} closed=${occ.filter((o) => o.exitedAt !== null).length}; ` +
      `max gap between consecutive holds=${occ.length > 1 ? Math.max(...occ.slice(1).map((o, i) => o.enteredAt - (occ[i]!.exitedAt ?? o.enteredAt))) : "n/a"}ms (TTL was 10000ms)`,
  );
}

/** A — two calls, one process. Re-entrancy only; deliberately NOT presented as a two-node result. */
async function testA(): Promise<void> {
  console.log("\n── A · overlapping ticks in one process ──────────────");
  const run = newRun("a");
  const k = key("a");
  const { runWithLeaderLock } = await import("../../src/lib/distributed-scheduler");
  let concurrent = 0;
  let maxConcurrent = 0;
  let ran = 0;
  const tick = async () =>
    runWithLeaderLock(k, 10, async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      ran++;
      await sleep(800);
      concurrent--;
    });
  const results = await Promise.all([tick(), tick(), tick(), tick()]);
  record(
    "A1",
    "a second tick never enters while the first holds the lock",
    maxConcurrent === 1 && ran === 1 ? "PASS" : "FAIL",
    `entered=${ran} maxConcurrentInSection=${maxConcurrent} returns=${JSON.stringify(results)}`,
  );
  record(
    "A2",
    "a refused tick returns false rather than throwing or silently succeeding",
    results.filter((r) => r === false).length === 3 ? "PASS" : "FAIL",
    `false=${results.filter((r) => r === false).length} expected=3`,
  );
  await cleanupRun(run);
}

/** B — two real processes. This is the first result that says anything about two nodes. */
async function testB(): Promise<void> {
  console.log("\n── B · two instances, same lock ──────────────────────");
  const run = newRun("b");
  const k = key("b");
  /**
   * Both instances get a retry budget that spans many of the other's hold-and-release cycles.
   * The first version gave each 4 attempts at 100ms spacing against a 1200ms hold, so the loser
   * exhausted its budget inside the winner's very first hold and the run reported "starvation" that
   * was purely an artifact of the parameters. 24 rounds of ~420ms cover roughly 30 cycles.
   *
   * The 170ms stagger is not there to engineer a pass: two real nodes are never phase-locked, and
   * starting both on an identical cadence measures a coincidence rather than the lock.
   */
  const a = spawnContender("B-a", ["--run", run, "--key", k, "--hold", "300", "--attempts", "24", "--gap", "120", "--ttl", "10"]);
  const b = spawnContender("B-b", ["--run", run, "--key", k, "--hold", "300", "--attempts", "24", "--gap", "120", "--ttl", "10", "--delay", "170"]);
  const [ra, rb] = await Promise.all([settle(a), settle(b)]);
  const ms = await markers(run);
  const occ = occupancies(ms);
  const ov = overlaps(occ);
  const instances = new Set(ms.map((m) => m.instance));

  redisPathCheck("B-R", ms);
  record(
    "B0",
    "the two contenders really are two distinct instances",
    instances.size === 2 && ra.code === 0 && rb.code === 0 ? "PASS" : "FAIL",
    `instances=${[...instances].join(",")} exits=${ra.code}/${rb.code}${ra.code || rb.code ? ` err=${(ra.err + rb.err).trim().slice(0, 300)}` : ""}`,
  );
  record(
    "B1",
    "MUTUAL EXCLUSION — no two instances occupy the section at once",
    instances.size < 2 ? "NOT_PROVEN" : ov.length === 0 ? "PASS" : "FAIL",
    ov.length === 0
      ? `${occ.length} occupancies across 2 instances, 0 overlapping`
      : `${ov.length} overlapping pairs, worst=${Math.max(...ov.map((o) => o.ms))}ms`,
  );
  record(
    "B2",
    "contention is resolved by refusal, not by queueing or error",
    ms.some((m) => m.phase === "refused") ? "PASS" : "NOT_PROVEN",
    `refused marks=${ms.filter((m) => m.phase === "refused").length}, entered marks=${ms.filter((m) => m.phase === "entered").length}`,
  );
  const winners = new Map<string, number>();
  for (const o of occ) winners.set(o.instance, (winners.get(o.instance) ?? 0) + 1);
  record(
    "B3",
    "neither instance is permanently starved across ~24 contention rounds",
    winners.size === 2 ? "PASS" : occ.length === 0 ? "NOT_PROVEN" : "FAIL",
    `holds won per instance: ${JSON.stringify([...winners.entries()])} over ${occ.length} total occupancies`,
  );
}

/** C — the holder is killed without releasing. TTL is the only thing that can free the lock. */
async function testC(): Promise<void> {
  console.log("\n── C · leader crash (SIGKILL, no release) ────────────");
  const run = newRun("c");
  const k = key("c");
  const TTL = 6;
  const spawnedAt = Date.now();
  const a = spawnContender("C-a", ["--run", run, "--key", k, "--hold", "60000", "--attempts", "1", "--ttl", String(TTL)]);

  // Wait for A to actually be inside, so the kill lands on a real holder rather than a race.
  let insideAt: number | null = null;
  let holderPid: number | null = null;
  for (let i = 0; i < 80 && insideAt === null; i++) {
    await sleep(250);
    const entered = (await markers(run)).find((x) => x.phase === "entered");
    insideAt = entered?.at ?? null;
    holderPid = entered?.pid ?? null;
  }
  if (insideAt === null || holderPid === null) {
    killStrayContenders();
    record("C0", "holder reached the protected section before the kill", "NOT_PROVEN", "no 'entered' mark appeared within 20s — the rest of C is not measurable");
    return;
  }
  record("C0", "holder reached the protected section before the kill", "PASS", `pid ${holderPid} entered ${insideAt - spawnedAt}ms after spawn (${new Date(insideAt).toISOString()})`);

  const killedAt = Date.now();
  const killedOk = hardKill(holderPid);
  await sleep(300);
  const stillAlive = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `(Get-Process -Id ${holderPid} -ErrorAction SilentlyContinue | Measure-Object).Count`]).stdout.toString().trim();
  record(
    "C0b",
    "the holder process is genuinely dead (not just its launcher)",
    killedOk && stillAlive === "0" ? "PASS" : "FAIL",
    `taskkill ok=${killedOk}; processes with pid ${holderPid} still running = ${stillAlive}`,
  );

  const b = spawnContender("C-b", ["--run", run, "--key", k, "--hold", "300", "--attempts", "120", "--gap", "250", "--ttl", String(TTL), "--stop-after-entries", "1"]);
  const rb = await settle(b);
  const ms = await markers(run);
  const occ = occupancies(ms);
  const recovered = occ.find((o) => o.enteredAt > killedAt);

  record(
    "C1",
    "a crashed holder does not hold the lock forever",
    recovered ? "PASS" : "FAIL",
    recovered ? `successor entered ${recovered.enteredAt - killedAt}ms after the kill` : `no successor entered within the polling budget; exit=${rb.code}`,
  );
  record(
    "C2",
    `recovery is bounded by the lease TTL (${TTL}s), not by the job's declared runtime (60s)`,
    recovered ? (recovered.enteredAt - killedAt <= TTL * 1000 + 1500 ? "PASS" : "FAIL") : "NOT_PROVEN",
    recovered ? `observed ${recovered.enteredAt - killedAt}ms vs bound ${TTL * 1000 + 1500}ms` : "no successor to measure",
  );
  record(
    "C3",
    "the killed holder left no 'exited' mark (proving the release path was genuinely skipped)",
    ms.some((m) => m.phase === "exited" && m.at < killedAt + 200) ? "FAIL" : "PASS",
    `exited marks before/at kill: ${ms.filter((m) => m.phase === "exited" && m.at < killedAt + 200).length} (expected 0 — a graceful exit would invalidate C)`,
  );

  // The launcher that spawned the killed holder is still around; leaving it would let the next
  // scenario contend against a process from this one.
  a.proc.kill();
  killStrayContenders();
}

/** E — renewal. The lease must outlive its own TTL while the job is still working. */
async function testE(): Promise<void> {
  console.log("\n── E · lease renewal beyond TTL ──────────────────────");
  const run = newRun("e");
  const k = key("e");
  const TTL = 4;
  const HOLD = 20_000;
  const a = spawnContender("E-a", ["--run", run, "--key", k, "--hold", String(HOLD), "--attempts", "1", "--ttl", String(TTL)]);
  await sleep(2500);
  const b = spawnContender("E-b", ["--run", run, "--key", k, "--hold", "200", "--attempts", "45", "--gap", "350", "--ttl", String(TTL), "--stop-after-entries", "1"]);
  const [ra, rb] = await Promise.all([settle(a), settle(b)]);
  const ms = await markers(run);
  const occ = occupancies(ms);
  const ov = overlaps(occ);
  const holder = occ[0];
  const heldMs = holder && holder.exitedAt ? holder.exitedAt - holder.enteredAt : 0;

  redisPathCheck("E-R", ms);
  record(
    "E1",
    `a ${HOLD / 1000}s job keeps a ${TTL}s lease alive (renewal at ttl/3 works)`,
    heldMs >= HOLD - 500 && !ms.find((m) => m.phase === "exited")?.leadershipLost ? "PASS" : "FAIL",
    `held=${heldMs}ms expected~${HOLD}ms leadershipLost=${ms.find((m) => m.phase === "exited")?.leadershipLost}`,
  );
  record(
    "E2",
    "no other instance gets in during those 20s, despite the TTL expiring 5 times over",
    ov.length === 0 ? "PASS" : "FAIL",
    ov.length === 0 ? `challenger made ${ms.filter((m) => m.phase === "refused").length} refused attempts across ~${HOLD / 1000}s` : `${ov.length} overlaps, worst=${Math.max(...ov.map((o) => o.ms))}ms`,
  );
  record("E3", "both processes exited cleanly", ra.code === 0 && rb.code === 0 ? "PASS" : "FAIL", `exits=${ra.code}/${rb.code}`);
}

/**
 * F — the 7D shape, applied to leadership.
 *
 * Freeze Redis for longer than the TTL while a job is running. Renewal fails, the lease genuinely
 * lapses in Redis, and the question the mandate asks is what the holder does next: `leadershipLost()`
 * is set, but nothing in production reads it. If a successor can enter while the original is still
 * working, that is check-then-act with an expiring lease — the same structure as 7D's claim, and it
 * must be measured rather than argued about.
 */
async function testF(politeJob: boolean, exclusive = false): Promise<void> {
  const id = exclusive ? "FX" : politeJob ? "FP" : "F";
  const slug = id.toLowerCase();
  /**
   * `exclusive: true` is the flag a job sets when it "must never run on two nodes at once (it moves
   * money, calls a gateway, spawns a backup)". It changes the ACQUISITION path — Redis, or a Postgres
   * advisory lock when Redis cannot answer. This scenario asks a different question: whether it also
   * protects a job whose lease lapses mid-run while Redis is perfectly reachable again afterwards.
   */
  console.log(
    `\n── ${id} · lease lapse under a Redis freeze ${exclusive ? "(EXCLUSIVE job — must never double-run)" : politeJob ? "(job reads leadershipLost)" : "(job ignores it, as production does)"} ──`,
  );
  const run = newRun(slug);
  const k = key(slug);
  const TTL = 4;
  const HOLD = 34_000;
  const FREEZE_MS = 14_000;

  const a = spawnContender(`${id}-a`, [
    "--run", run, "--key", k, "--hold", String(HOLD), "--attempts", "1", "--ttl", String(TTL),
    ...(politeJob ? ["--stop-on-lease-loss"] : []),
    ...(exclusive ? ["--exclusive"] : []),
  ]);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if ((await markers(run)).some((m) => m.phase === "entered")) break;
  }
  const healthyPing = await pingLatencyMs(2000);

  await docker("pause");
  const frozenPing = await pingLatencyMs(2500);
  await sleep(FREEZE_MS);
  await docker("unpause");
  const thawedPing = await pingLatencyMs(2500);

  record(
    `${id}0`,
    "the freeze was real (positive control on the host socket, not docker exec)",
    healthyPing !== null && frozenPing === null && thawedPing !== null ? "PASS" : "FAIL",
    `ping healthy=${healthyPing}ms frozen=${frozenPing === null ? "timeout(>2500ms)" : `${frozenPing}ms`} thawed=${thawedPing}ms`,
  );

  // Redis expiry is wall-clock, so the lease set before the pause has genuinely lapsed by now.
  const ttlAfter = await redisCmd(["TTL", `lock:${k}`]);
  record(
    `${id}1`,
    `the lease actually lapsed in Redis during the freeze (TTL ${TTL}s < freeze ${FREEZE_MS / 1000}s)`,
    ttlAfter === "-2" ? "PASS" : "FAIL",
    `TTL lock:${k} = ${ttlAfter} (-2 = key gone; a positive number would mean it was renewed and this scenario proves nothing)`,
  );

  const b = spawnContender(`${id}-b`, [
    "--run", run, "--key", k, "--hold", "2000", "--attempts", "20", "--gap", "300", "--ttl", String(TTL), "--stop-after-entries", "1",
    ...(exclusive ? ["--exclusive"] : []),
  ]);
  const [ra, rb] = await Promise.all([settle(a), settle(b)]);
  const ms = await markers(run);
  const occ = occupancies(ms);
  const ov = overlaps(occ);
  /**
   * The holder is the instance that got in FIRST, not the first "exited" row in time order. The
   * challenger holds for 2s and exits long before the 34s holder does, so `find(phase === "exited")`
   * returned the challenger's marker — which of course never lost a lease. That misread reported
   * "the holder did not detect the lapse" about a process that was never frozen.
   */
  const holder = occ[0];
  const holderExit = holder ? ms.find((m) => m.phase === "exited" && m.instance === holder.instance) : undefined;
  const occupiedMs = holderExit && holder ? holderExit.at - holder.enteredAt : null;

  redisPathCheck(`${id}-R`, ms);
  const holderSummary = ms.find((m) => m.phase === "summary" && m.pid === holderExit?.pid);
  if (exclusive) {
    /**
     * An exclusive job's exclusivity is anchored in an open Postgres transaction, so there is no
     * Redis lease left to lose and `leadershipLost` staying false is the CORRECT answer, not a
     * missed detection. The check is still falsifiable: a true here, with no successor in sight,
     * would be a false alarm, and a missing anchor would mean the run never took the fixed path.
     */
    record(
      `${id}2`,
      "leadership is genuinely retained, and reported as retained, through the whole outage",
      holderExit?.leadershipLost === false ? "PASS" : "FAIL",
      `leadershipLost inside the job = ${holderExit?.leadershipLost}; lease_lost counter = ${holderSummary?.leaseLostTotal ?? "n/a"}`,
    );
    record(
      `${id}2b`,
      "the exclusive run was anchored in Postgres (the fixed path was the path taken)",
      (holderSummary?.anchorTotal ?? 0) > 0 ? "PASS" : "FAIL",
      `homigo_lock_fallback_total{reason=exclusive_anchor}=${holderSummary?.anchorTotal ?? "n/a"}, {reason=redis_unavailable}=${holderSummary?.redisUnavailableTotal ?? "n/a"} in the holder process`,
    );
  } else {
    record(
      `${id}2`,
      "the holder DETECTS the lost lease (leadershipLost flips, counter increments)",
      holderExit?.leadershipLost === true ? "PASS" : "FAIL",
      `leadershipLost observed inside the job = ${holderExit?.leadershipLost}; lease_lost counter in that process = ${holderSummary?.leaseLostTotal ?? "n/a"}`,
    );
  }
  /**
   * Not a pass/fail of the platform: `runWithLeaderLock` has no way to abort `fn`, so whether the
   * job keeps working after its lease lapses is decided entirely by the job. Recorded as a measured
   * fact for both kinds of job, because the difference between them is the whole recommendation.
   */
  record(
    `${id}3`,
    exclusive
      ? "the job runs to completion through the outage, holding its claim the whole time"
      : politeJob
        ? "a job that reads leadershipLost yields promptly after the lapse"
        : "a job that ignores leadershipLost (every production caller) keeps working after the lapse",
    politeJob ? (occupiedMs !== null && occupiedMs < HOLD - 2000 ? "PASS" : "FAIL") : "INFO",
    `the job occupied the section for ${occupiedMs ?? "n/a"}ms of its ${HOLD}ms schedule; the lease lapsed roughly ${TTL}s into a ${FREEZE_MS / 1000}s freeze`,
  );
  record(
    `${id}4`,
    exclusive
      ? "MUTUAL EXCLUSION SURVIVES A LEASE LAPSE for a job declared exclusive (must never double-run)"
      : "a NON-exclusive job may double-run after a lease lapse (the documented trade, measured)",
    /**
     * Only a hard invariant for exclusive jobs. For non-exclusive ones the design states the trade
     * outright — they "are idempotent (SKIP LOCKED claims, deleteMany-by-cutoff, pure recomputes)" —
     * so concurrency here is the accepted behaviour, recorded with its duration rather than scored.
     * Whether that idempotency claim actually holds for each job is a separate question, and test K
     * is where it is checked; this scenario cannot answer it.
     */
    exclusive ? (ov.length === 0 ? "PASS" : "FAIL") : "INFO",
    ov.length === 0
      ? `no overlapping occupancy; successor entries after the lapse = ${occ.length - 1}`
      : `${ov.length} overlapping pair(s), worst=${Math.max(...ov.map((o) => o.ms))}ms — two instances executed the same job concurrently`,
  );
  record(`${id}5`, "both processes exited cleanly despite the outage", ra.code === 0 && rb.code === 0 ? "PASS" : "FAIL", `exits=${ra.code}/${rb.code}`);
  killStrayContenders();
}

/**
 * BREAK THE FIX — a job that outlives its anchor's transaction deadline.
 *
 * The fix anchors exclusive jobs in an open Postgres transaction, and that transaction has a deadline
 * of `max(60s, ttlSec * 1000)`. Prisma rolls it back when the deadline passes, releasing the advisory
 * lock, but it cannot abort the callback — so the job carries on UNLOCKED. The scheduler's own
 * contract says the opposite about the Redis path: "`ttlSec` bounds how long a crashed holder blocks
 * the next tick — not how long the job may run." Redis renewal upheld that; a transaction deadline
 * does not renew. No freeze is needed here, and that is the point: this attacks the fix on a
 * perfectly healthy system.
 */
async function testFXB(): Promise<void> {
  console.log("\n── FXB · BREAK THE FIX: exclusive job outliving its anchor deadline ──");
  const run = newRun("fxb");
  const k = key("fxb");
  const TTL = 4; // ⇒ advisory deadline = max(60_000, 4_000) = 60s
  const DEADLINE_MS = 60_000;
  const HOLD = 95_000;

  const a = spawnContender("FXB-a", ["--run", run, "--key", k, "--hold", String(HOLD), "--attempts", "1", "--ttl", String(TTL), "--exclusive"]);
  await sleep(3000);
  const b = spawnContender("FXB-b", ["--run", run, "--key", k, "--hold", "3000", "--attempts", "120", "--gap", "700", "--ttl", String(TTL), "--exclusive", "--stop-after-entries", "1"]);
  const [ra, rb] = await Promise.all([settle(a, 180_000), settle(b, 180_000)]);

  const ms = await markers(run);
  const occ = occupancies(ms);
  const ov = overlaps(occ);
  const holder = occ[0];
  const successor = occ.find((o) => holder && o.instance !== holder.instance);

  record(
    "FXB0",
    `the job really did outlive the anchor deadline (${HOLD / 1000}s job vs ${DEADLINE_MS / 1000}s deadline)`,
    holder && holder.exitedAt && holder.exitedAt - holder.enteredAt > DEADLINE_MS ? "PASS" : "NOT_PROVEN",
    `holder occupied the section for ${holder?.exitedAt ? holder.exitedAt - holder.enteredAt : "n/a"}ms`,
  );
  record(
    "FXB1",
    "a second instance CANNOT enter after the anchor's transaction deadline passes",
    ov.length === 0 ? "PASS" : "FAIL",
    ov.length === 0
      ? "no overlapping occupancy across the full 95s run"
      : `${ov.length} overlapping pair(s), worst=${Math.max(...ov.map((o) => o.ms))}ms; successor entered ${successor && holder ? successor.enteredAt - holder.enteredAt : "n/a"}ms into the holder's run (deadline is ${DEADLINE_MS}ms)`,
  );
  record("FXB2", "both processes exited cleanly", ra.code === 0 && rb.code === 0 ? "PASS" : "FAIL", `exits=${ra.code}/${rb.code}`);
  killStrayContenders();
}

/** G/H — Redis down for the whole test. Exclusive must hold the line; non-exclusive is measured. */
async function testGH(exclusive: boolean): Promise<void> {
  const label = exclusive ? "G · exclusive" : "H · non-exclusive";
  const id = exclusive ? "G" : "H";
  console.log(`\n── ${label}, Redis down throughout ───────────`);
  const run = newRun(exclusive ? "g" : "h");
  const k = key(exclusive ? "g" : "h");
  // Redis being down IS the scenario here, so these two contenders are the only ones allowed to boot
  // without it. Every other test aborts rather than silently measuring the in-memory fallback.
  const extra = exclusive ? ["--exclusive", "--allow-redis-down"] : ["--allow-redis-down"];

  await docker("pause");
  const frozenPing = await pingLatencyMs(2500);
  let ra: Awaited<ReturnType<typeof settle>>;
  let rb: Awaited<ReturnType<typeof settle>>;
  try {
    const a = spawnContender(`${id}-a`, ["--run", run, "--key", k, "--hold", "4000", "--attempts", "1", "--ttl", "10", ...extra]);
    const b = spawnContender(`${id}-b`, ["--run", run, "--key", k, "--hold", "4000", "--attempts", "1", "--ttl", "10", "--delay", "700", ...extra]);
    [ra, rb] = await Promise.all([settle(a), settle(b)]);
  } finally {
    await docker("unpause");
  }

  const ms = await markers(run);
  const occ = occupancies(ms);
  const ov = overlaps(occ);
  const fallbacks = ms.filter((m) => m.phase === "summary").map((m) => m.lockFallbackTotal ?? 0);

  record(`${id}0`, "Redis was genuinely unreachable for the whole test", frozenPing === null ? "PASS" : "FAIL", `frozen ping = ${frozenPing === null ? "timeout" : `${frozenPing}ms`}`);

  if (exclusive) {
    record(
      "G1",
      "EXCLUSIVE jobs keep cross-node mutual exclusion with Redis down (Postgres advisory fallback)",
      ov.length === 0 && occ.length >= 1 ? "PASS" : "FAIL",
      `occupancies=${occ.length} overlaps=${ov.length}${ov.length ? ` worst=${Math.max(...ov.map((o) => o.ms))}ms` : ""}; exits=${ra!.code}/${rb!.code}`,
    );
    record(
      "G2",
      "exactly one of the two instances ran; the other was refused, not errored",
      occ.length === 1 && ms.filter((m) => m.phase === "refused").length === 1 ? "PASS" : occ.length === 0 ? "FAIL" : "INFO",
      `entered=${occ.length} refused=${ms.filter((m) => m.phase === "refused").length}`,
    );
    record(
      "G3",
      "the advisory-lock fallback was the path taken (and was counted)",
      fallbacks.some((f) => f > 0) ? "PASS" : "NOT_PROVEN",
      `per-process homigo_lock_fallback_total = ${JSON.stringify(fallbacks)}`,
    );
  } else {
    record(
      "H1",
      "NON-EXCLUSIVE jobs lose cross-node mutual exclusion with Redis down (per-process in-memory lock)",
      occ.length === 2 && ov.length > 0 ? "INFO" : occ.length <= 1 ? "INFO" : "INFO",
      occ.length === 2 && ov.length > 0
        ? `both instances entered concurrently for ${Math.max(...ov.map((o) => o.ms))}ms — this is the documented design, measured rather than assumed`
        : `entered=${occ.length} overlaps=${ov.length}`,
    );
    record(
      "H2",
      "the degradation is signalled rather than silent (fallback counter fires in each process)",
      fallbacks.length > 0 && fallbacks.every((f) => f > 0) ? "PASS" : "FAIL",
      `per-process homigo_lock_fallback_total = ${JSON.stringify(fallbacks)}`,
    );
    record("H3", "neither process crashed while Redis was down", ra!.code === 0 && rb!.code === 0 ? "PASS" : "FAIL", `exits=${ra!.code}/${rb!.code}`);
  }
}

/**
 * J — scheduled-job execution semantics under two concurrent workers.
 *
 * The lock tests above answer "does one node win the tick". This one answers the question the lock
 * exists to serve: is each due job executed exactly once, is a job never executed early, is a
 * cancelled job left alone, and does a job whose worker died get picked up again — once.
 */
async function testJ(): Promise<void> {
  console.log("\n── J · scheduled jobs: exactly-once, early, cancelled, stale ──");
  const run = newRun("j");
  const jobType = `7e-probe-${run}`;
  /**
   * Comfortably more than one batch (`EVENTS_JOBS_BATCH_SIZE` is 25). Seeding exactly one batch let
   * the first worker to tick claim every row, leaving the second nothing to contend for — the run
   * then "passed" exactly-once without two workers ever having raced.
   */
  const DUE = 120;

  // Seeded a few minutes back, not hours: recent enough to be due, far from any staleness guard.
  const dueAt = new Date(Date.now() - 60_000);
  const seedDue = await prisma.scheduledJob.createManyAndReturn({
    data: Array.from({ length: DUE }, (_, i) => ({
      jobType,
      runAt: dueAt,
      status: "pending",
      payload: { run, seq: i, kind: "due" },
    })),
    select: { id: true },
  });
  const future = await prisma.scheduledJob.create({
    data: { jobType, runAt: new Date(Date.now() + 600_000), status: "pending", payload: { run, kind: "future" } },
    select: { id: true },
  });
  const cancelled = await prisma.scheduledJob.create({
    data: { jobType, runAt: dueAt, status: "cancelled", cancelledAt: new Date(), payload: { run, kind: "cancelled" } },
    select: { id: true },
  });
  /**
   * A job left `running` by a worker that died. `EVENTS_JOBS_LEASE_MS` is pinned to its 30s minimum
   * for this scenario (see the orchestrator's spawn env), so `startedAt` 90s ago is unambiguously
   * past the lease and recovery is a real transition rather than a coincidence of defaults.
   */
  const stale = await prisma.scheduledJob.create({
    data: { jobType, runAt: dueAt, status: "running", startedAt: new Date(Date.now() - 90_000), payload: { run, kind: "stale" } },
    select: { id: true },
  });

  const spawnWorker = (label: string) => {
    const proc = Bun.spawn(["bun", "run", "scripts/chaos/7e-job-worker.ts", "--run", run, "--duration", "25000", "--tick", "80", "--work", "15"], {
      cwd: process.cwd(),
      env: { ...process.env, EVENTS_JOBS_LEASE_MS: "30000", EVENTS_JOBS_ENABLED: "true" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { proc, label };
  };
  const [ra, rb] = await Promise.all([settle(spawnWorker("J-a"), 90_000), settle(spawnWorker("J-b"), 90_000)]);

  const ms = await markers(run);
  const invocations = ms.filter((m) => (m as unknown as { phase: string }).phase === "invoked") as unknown as Array<{
    pid: number;
    jobId: string;
    attempt: number;
  }>;
  const byJob = new Map<string, number>();
  for (const inv of invocations) byJob.set(inv.jobId, (byJob.get(inv.jobId) ?? 0) + 1);

  const dueIds = new Set(seedDue.map((r) => r.id));
  const rows = await prisma.scheduledJob.findMany({
    where: { jobType },
    // `lastError` is the whole point of collecting this: a run that reports "25 jobs never executed"
    // without the reason cannot be told apart from a product defect, and the rows are deleted at the
    // end of the scenario, so it has to be captured here or not at all.
    select: { id: true, status: true, attempts: true, startedAt: true, lastError: true },
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const workerPids = new Set(invocations.map((i) => i.pid));

  record(
    "J0",
    "both workers were live and competing for the same rows",
    ra.code === 0 && rb.code === 0 && workerPids.size === 2 ? "PASS" : "FAIL",
    `exits=${ra.code}/${rb.code}; distinct worker pids that executed a job = ${workerPids.size}${ra.code || rb.code ? ` err=${(ra.err + rb.err).trim().slice(0, 300)}` : ""}`,
  );

  /**
   * A job type only these two workers know about can still be CLAIMED by any other instance pointed
   * at this database — the isolated backend on :3100 runs the same processor and terminates what it
   * cannot handle. That is a legitimate third claimer, and it is reported here rather than allowed to
   * surface as a bogus exactly-once failure. The distinction matters: it never produced a duplicate,
   * only a job this test's workers never got to run.
   */
  const foreign = [...dueIds].filter((id) => (rowById.get(id)?.lastError ?? "").includes("No handler registered"));
  record(
    "J-ENV",
    "no instance outside this test competed for the same rows",
    foreign.length === 0 ? "PASS" : "FAIL",
    foreign.length === 0
      ? "every due job was claimed by one of the two workers under test"
      : `${foreign.length} of ${DUE} jobs were claimed and terminated by another processor on this database ` +
        `(lastError names the missing handler). The exactly-once numbers below cover only what this test owned.`,
  );

  const multi = [...byJob.entries()].filter(([id, n]) => dueIds.has(id) && n > 1);
  const owned = [...dueIds].filter((id) => !foreign.includes(id));
  const missed = owned.filter((id) => !byJob.has(id));
  record(
    "J1",
    "NO DUPLICATE EXECUTION — no job was executed more than once by anyone",
    multi.length === 0 ? "PASS" : "FAIL",
    `${DUE} due jobs, ${invocations.length} total executions: more than once=${multi.length}` +
      (multi.length ? ` — duplicated: ${multi.map(([id, n]) => `${id}×${n}`).join(", ")}` : ""),
  );
  record(
    "J1b",
    "EXACTLY ONCE — every job this test owned was executed, once",
    missed.length === 0 && owned.length > 0 ? "PASS" : "FAIL",
    `${owned.length} owned jobs: executed once=${owned.length - missed.length}, never=${missed.length}`,
  );
  record(
    "J2",
    "every due job reached a terminal state with a single attempt",
    [...dueIds].every((id) => ["completed", "failed", "skipped"].includes(rowById.get(id)?.status ?? "") && rowById.get(id)?.attempts === 1) &&
      owned.every((id) => rowById.get(id)?.status === "completed")
      ? "PASS"
      : "FAIL",
    `statuses=${JSON.stringify([...new Set([...dueIds].map((id) => rowById.get(id)?.status))])} ` +
      `attempts=${JSON.stringify([...new Set([...dueIds].map((id) => rowById.get(id)?.attempts))])} ` +
      `errors=${JSON.stringify([...new Set([...dueIds].map((id) => rowById.get(id)?.lastError).filter(Boolean))].slice(0, 3))}`,
  );
  record(
    "J3",
    "NO EARLY EXECUTION — a job whose runAt is 10 minutes out was never touched",
    !byJob.has(future.id) && rowById.get(future.id)?.status === "pending" && rowById.get(future.id)?.attempts === 0 ? "PASS" : "FAIL",
    `invocations=${byJob.get(future.id) ?? 0} status=${rowById.get(future.id)?.status} attempts=${rowById.get(future.id)?.attempts}`,
  );
  record(
    "J4",
    "a cancelled job is never executed and stays cancelled",
    !byJob.has(cancelled.id) && rowById.get(cancelled.id)?.status === "cancelled" ? "PASS" : "FAIL",
    `invocations=${byJob.get(cancelled.id) ?? 0} status=${rowById.get(cancelled.id)?.status}`,
  );
  record(
    "J5",
    "WORKER CRASH RECOVERY — a job stranded in 'running' is recovered and then executed exactly once",
    byJob.get(stale.id) === 1 && rowById.get(stale.id)?.status === "completed" ? "PASS" : "FAIL",
    `invocations=${byJob.get(stale.id) ?? 0} final status=${rowById.get(stale.id)?.status} attempts=${rowById.get(stale.id)?.attempts}`,
  );

  await prisma.scheduledJob.deleteMany({ where: { jobType } });
}

/**
 * K — financial safety of the NON-exclusive money-adjacent jobs.
 *
 * `maintenance:finance_reconcile`, `maintenance:financial_integrity` and
 * `retention:wallet_pending_expire` do not set `exclusive`, and F/H showed that non-exclusive jobs
 * really do run on two nodes during a Redis outage. Their safety therefore rests entirely on the
 * design's claim that they are idempotent. The heaviest write any of them performs is the journal
 * backfill reached from `financial_integrity` on liability drift, and that write is check-then-act.
 * This tests the write itself, at the layer where a duplicate would actually appear.
 */
async function testK(): Promise<void> {
  console.log("\n── K · money-path idempotency under two nodes ─────────");
  const run = newRun("k");
  const idemKey = `7e-chaos:${run}`;
  const RACERS = 4;

  const before = await prisma.journalEntry.count();
  const barrier = Date.now() + 4000;
  const racers = Array.from({ length: RACERS }, (_, i) =>
    Bun.spawn(["bun", "run", "scripts/chaos/7e-ledger-racer.ts", "--run", run, "--key", idemKey, "--barrier", String(barrier), "--amount", "125.50"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const results = await Promise.all(
    racers.map(async (proc, i) => settle({ proc, label: `K-${i}` }, 90_000)),
  );

  const ms = (await markers(run)) as unknown as Array<{ phase: string; outcome: string; entryId: string | null; pid: number }>;
  const raced = ms.filter((m) => m.phase === "raced");
  const entries = await prisma.journalEntry.findMany({
    where: { idempotencyKey: idemKey },
    select: { id: true, lines: { select: { debit: true, credit: true } } },
  });
  const after = await prisma.journalEntry.count();

  record(
    "K0",
    `all ${RACERS} racers reached the same key at the same instant`,
    raced.length === RACERS && results.every((r) => r.code === 0) ? "PASS" : "FAIL",
    `racers reporting=${raced.length}/${RACERS} exits=${results.map((r) => r.code).join(",")} outcomes=${JSON.stringify(raced.map((r) => r.outcome))}` +
      (results.some((r) => r.code !== 0) ? ` err=${results.map((r) => r.err.trim().slice(0, 150)).filter(Boolean).join(" | ")}` : ""),
  );
  record(
    "K1",
    "EXACTLY ONE journal entry exists for the key, despite concurrent posting from several processes",
    entries.length === 1 ? "PASS" : "FAIL",
    `journal entries with idempotencyKey ${idemKey} = ${entries.length}; total journal rows ${before} → ${after} (delta ${after - before})`,
  );
  record(
    "K2",
    "the single entry is a balanced double entry (no half-written journal from a lost race)",
    entries.length === 1 && entries[0]!.lines.length === 2 &&
      Math.abs(entries[0]!.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)) < 0.011
      ? "PASS"
      : "FAIL",
    entries.length === 1
      ? `lines=${entries[0]!.lines.length} debit−credit=${entries[0]!.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)}`
      : "no single entry to inspect",
  );
  /**
   * The losers must be rejected by the database, not quietly told the entry already existed by a
   * lookup that raced. Either answer is safe, but only one of them proves the UNIQUE constraint is
   * what is holding — and the constraint is the guard that survives two nodes.
   */
  const rejected = raced.filter((r) => r.outcome === "rejected_unique").length;
  const reused = raced.filter((r) => r.outcome === "wrote_or_reused").length;
  record(
    "K3",
    "the UNIQUE constraint — not the check-then-act lookup — is what prevents the duplicate",
    rejected + reused === RACERS && entries.length === 1 ? "PASS" : "FAIL",
    `rejected by unique constraint=${rejected}, wrote-or-reused=${reused}; a duplicate would need entries>1, observed ${entries.length}`,
  );

  // The probe entry is a real ledger row in the test database; remove it and leave balances as found.
  if (entries.length > 0) {
    // Three tables hang off a journal entry: its lines, and the balance snapshot the ledger writes
    // after every post. Deleting the entry without them trips ledger_balance_snapshots_journal_id_fkey.
    const ids = entries.map((e) => e.id);
    await prisma.ledgerBalanceSnapshot.deleteMany({ where: { journalId: { in: ids } } });
    await prisma.ledgerEntry.deleteMany({ where: { journalId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { idempotencyKey: idemKey } });
  }
  const cleaned = await prisma.journalEntry.count();
  record("K4", "the probe left the ledger as it found it", cleaned === before ? "PASS" : "FAIL", `journal rows before=${before} after cleanup=${cleaned}`);
}

/**
 * R — rapid restart, shaped like a rolling deploy.
 *
 * The replacement instance starts while the outgoing one is still mid-job, and only then is the
 * outgoing one killed without a chance to release. Each cycle asks two things: the newcomer must not
 * get in while the incumbent is alive, and it must get in once the incumbent dies — within the lease,
 * not after some unbounded wait. Repeating it checks that churn does not accumulate stuck locks.
 */
async function testR(): Promise<void> {
  console.log("\n── R · rapid restart / rolling replacement ───────────");
  const TTL = 5;
  const CYCLES = 3;
  let cleanHandovers = 0;
  let earlyEntries = 0;
  const recoveryMs: number[] = [];

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const run = newRun(`r${cycle}`);
    const k = key(`r${cycle}`);

    const outgoing = spawnContender(`R${cycle}-old`, ["--run", run, "--key", k, "--hold", "45000", "--attempts", "1", "--ttl", String(TTL)]);
    let holderPid: number | null = null;
    for (let i = 0; i < 60 && holderPid === null; i++) {
      await sleep(250);
      holderPid = (await markers(run)).find((m) => m.phase === "entered")?.pid ?? null;
    }
    if (holderPid === null) {
      killStrayContenders();
      record(`R${cycle}`, "rolling replacement cycle", "NOT_PROVEN", "the outgoing instance never entered the section");
      continue;
    }

    // The replacement boots while the incumbent is still working — the overlap a deploy really has.
    const incoming = spawnContender(`R${cycle}-new`, ["--run", run, "--key", k, "--hold", "1200", "--attempts", "90", "--gap", "400", "--ttl", String(TTL), "--stop-after-entries", "1"]);
    await sleep(2500);

    const beforeKill = (await markers(run)).filter((m) => m.phase === "entered" && m.pid !== holderPid);
    if (beforeKill.length > 0) earlyEntries++;

    const killedAt = Date.now();
    hardKill(holderPid);

    const rb = await settle(incoming, 90_000);
    outgoing.proc.kill();
    killStrayContenders();

    const successor = (await markers(run)).find((m) => m.phase === "entered" && m.pid !== holderPid);
    if (successor && successor.at > killedAt) {
      recoveryMs.push(successor.at - killedAt);
      if (beforeKill.length === 0) cleanHandovers++;
    }
    if (rb.code !== 0) console.log(`  [warn] cycle ${cycle} replacement exited ${rb.code}`);
  }

  record(
    "R1",
    "a replacement never enters while the outgoing instance is still alive",
    earlyEntries === 0 ? "PASS" : "FAIL",
    `${earlyEntries} of ${CYCLES} cycles let the newcomer in before the incumbent was killed`,
  );
  record(
    "R2",
    "every cycle handed over cleanly once the incumbent died",
    cleanHandovers === CYCLES ? "PASS" : "FAIL",
    `${cleanHandovers}/${CYCLES} clean handovers; recovery times ${JSON.stringify(recoveryMs)}ms`,
  );
  record(
    "R3",
    `handover stays bounded by the lease across repeated churn (TTL ${TTL}s)`,
    recoveryMs.length === CYCLES && recoveryMs.every((m) => m <= TTL * 1000 + 1500) ? "PASS" : "FAIL",
    `recoveries=${JSON.stringify(recoveryMs)}ms against a bound of ${TTL * 1000 + 1500}ms`,
  );
}

/**
 * N — positive control for the `no_arbiter` branch and the LockNoArbiter alert.
 *
 * The fix introduced a refusal path for the case where neither Redis nor Postgres can arbitrate. A
 * branch that nothing can reach, and an alert on a label nothing ever writes, are worth exactly as
 * much as no branch and no alert — so the condition is driven on purpose rather than reasoned about.
 */
async function testN(): Promise<void> {
  console.log("\n── N · no-arbiter refusal (positive control) ──────────");
  const k = key("n");
  await docker("pause");
  let out = "";
  let code = -1;
  try {
    const frozen = await pingLatencyMs(2500);
    record("N0", "Redis is genuinely unreachable for this control", frozen === null ? "PASS" : "FAIL", `frozen ping = ${frozen === null ? "timeout" : `${frozen}ms`}`);
    const proc = Bun.spawn(["bun", "run", "scripts/chaos/7e-no-arbiter.ts", "--key", k, "--hold-pool", "25000"], {
      cwd: process.cwd(),
      // One connection, already taken by a held transaction, so the anchor's own `$transaction`
      // cannot get one and times out at maxWait — Postgres cannot answer either.
      env: { ...process.env, DATABASE_URL: `${process.env.DATABASE_URL!.split("?")[0]}?connection_limit=1&pool_timeout=8` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const settled = await settle({ proc, label: "N" }, 120_000);
    out = settled.out;
    code = settled.code;
  } finally {
    await docker("unpause");
  }

  const line = out.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  if (!line) {
    record("N1", "the no-arbiter branch is reachable", "NOT_PROVEN", `the control produced no RESULT line (exit=${code}); output: ${out.trim().slice(0, 300)}`);
    return;
  }
  const r = JSON.parse(line.slice(7)) as {
    redisUp: boolean;
    acquired: boolean;
    jobRan: boolean;
    noArbiter: number;
    exclusiveAnchor: number;
    redisUnavailable: number;
  };

  record(
    "N1",
    "with neither arbiter available, an exclusive job is REFUSED rather than run by every node",
    r.redisUp === false && r.acquired === false && r.jobRan === false ? "PASS" : "FAIL",
    `redisUp=${r.redisUp} runWithLeaderLock returned ${r.acquired} jobRan=${r.jobRan}`,
  );
  record(
    "N2",
    "the refusal is counted under reason=no_arbiter, which is what LockNoArbiter alerts on",
    r.noArbiter === 1 ? "PASS" : "FAIL",
    `no_arbiter=${r.noArbiter} exclusive_anchor=${r.exclusiveAnchor} redis_unavailable=${r.redisUnavailable} — the alert expression matches reason="no_arbiter"`,
  );

  /**
   * The same pool pressure with Redis HEALTHY. This is the failure mode the fix could plausibly have
   * introduced: exclusive jobs now always ask for a connection, so if a busy pool made them refuse,
   * every money-moving maintenance job would stop silently under load. One guard is enough to run —
   * the job must proceed on the Redis lease alone, exactly as it did before the fix.
   */
  const proc2 = Bun.spawn(["bun", "run", "scripts/chaos/7e-no-arbiter.ts", "--key", key("n2"), "--hold-pool", "20000"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `${process.env.DATABASE_URL!.split("?")[0]}?connection_limit=1&pool_timeout=8` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const s2 = await settle({ proc: proc2, label: "N-pool" }, 120_000);
  const line2 = s2.out.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  if (!line2) {
    record("N3", "a busy connection pool does not silently stop exclusive jobs", "NOT_PROVEN", `no RESULT line (exit=${s2.code}): ${s2.out.trim().slice(0, 300)}`);
    return;
  }
  const r2 = JSON.parse(line2.slice(7)) as typeof r;
  record(
    "N3",
    "with the pool exhausted but Redis healthy, an exclusive job STILL RUNS (degraded to one guard, not stopped)",
    r2.redisUp === true && r2.acquired === true && r2.jobRan === true ? "PASS" : "FAIL",
    `redisUp=${r2.redisUp} acquired=${r2.acquired} jobRan=${r2.jobRan} no_arbiter=${r2.noArbiter}; ` +
      "a false here would mean the fix silently stops every money-moving maintenance job under pool pressure",
  );
}

/** I — release is owner-checked: a late or foreign release must not free a live lock. */
async function testI(): Promise<void> {
  console.log("\n── I · owner-checked release ─────────────────────────");
  const k = key("i");
  const mine = "inst_owner_aaa";
  const theirs = "inst_intruder_bbb";

  const got = await redisClient.acquireLock(k, mine, 30);
  /**
   * Positive control before any assertion: the token must be visible in Redis itself. If the client
   * had fallen back to its in-memory map, every assertion below would still "work" against that map
   * and I would be certifying the wrong implementation.
   */
  const inRedis = (await redisCmd(["GET", `lock:${k}`])) === mine;
  if (!inRedis) {
    record("I0", "the lock under test actually lives in Redis (not the in-memory fallback)", "NOT_PROVEN", `GET lock:${k} did not return the owner token — I1..I4 would describe the in-memory map, so they are not run`);
    await redisClient.releaseLock(k, mine);
    return;
  }
  record("I0", "the lock under test actually lives in Redis (not the in-memory fallback)", "PASS", `GET lock:${k} returned the owner token`);

  await redisClient.releaseLock(k, theirs);
  const stillHeld = (await redisCmd(["GET", `lock:${k}`])) === mine;
  const intruderRefused = !(await redisClient.acquireLock(k, theirs, 30));
  const refreshedByIntruder = await redisClient.refreshLock(k, theirs, 300);
  const ttlAfterIntruderRefresh = Number(await redisCmd(["TTL", `lock:${k}`]));
  await redisClient.releaseLock(k, mine);
  const releasedByOwner = (await redisCmd(["EXISTS", `lock:${k}`])) === "0";

  record("I1", "a foreign release does not free someone else's lock", got && stillHeld ? "PASS" : "FAIL", `acquired=${got} stillHeldByOwner=${stillHeld}`);
  record("I2", "a second holder cannot acquire while the lock is live", intruderRefused ? "PASS" : "FAIL", `intruder acquire refused = ${intruderRefused}`);
  record(
    "I3",
    "a foreign refresh cannot extend a lock it does not own",
    !refreshedByIntruder && ttlAfterIntruderRefresh <= 30 ? "PASS" : "FAIL",
    `refresh returned ${refreshedByIntruder}; TTL after = ${ttlAfterIntruderRefresh}s (would be ~300s if the intruder had extended it)`,
  );
  record("I4", "the real owner's release does free the lock", releasedByOwner ? "PASS" : "FAIL", `key exists after owner release = ${!releasedByOwner}`);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

console.log(`SECTION 7E — scheduler / distributed lock chaos`);
console.log(`  database : ${dbTarget.redacted} (${dbTarget.databaseName})`);
console.log(`  redis    : ${redisTarget.redacted} (container ${REDIS_CONTAINER})`);
console.log(`  run tag  : ${RUN_TAG}\n`);

/**
 * A previous run that was killed mid-freeze leaves the container paused, and every scenario after it
 * silently measures a Redis-down world while claiming to measure a healthy one. Clearing it here is
 * cheap and makes the starting state explicit rather than inherited.
 */
await docker("unpause").catch(() => {});
const strayAtStart = killStrayContenders();
if (strayAtStart > 0) console.log(`  [warn] killed ${strayAtStart} contender process(es) left over from an earlier run\n`);

const advisoryBefore = await advisoryLockCount();
const strayBefore = await strayLockKeys();

const selected = new Set(SELECTED.split(",").map((s) => s.trim()));
const want = (name: string) => selected.has("all") || selected.has(name);

if (want("baseline")) {
  await baseline(1);
  await baseline(2);
}
if (want("a")) await testA();
if (want("b")) await testB();
if (want("c")) await testC();
if (want("e")) await testE();
if (want("f")) await testF(false);
if (want("fp")) await testF(true);
if (want("fx")) await testF(false, true);
if (want("fxb")) await testFXB();
if (want("g")) await testGH(true);
if (want("h")) await testGH(false);
if (want("i")) await testI();
if (want("j")) await testJ();
if (want("k")) await testK();
if (want("r")) await testR();
if (want("n")) await testN();

// ── leak check ────────────────────────────────────────────────────────────────────────────────────

console.log("\n── LEAK CHECK ────────────────────────────────────────");
const strays = killStrayContenders();
record(
  "L0",
  "no contender process outlived its scenario",
  strays === 0 ? "PASS" : "FAIL",
  `${strays} stray contender process(es) had to be killed — a survivor keeps renewing its lease and contaminates every later scenario`,
);
await sleep(1000);
const strayAfter = await strayLockKeys();
const advisoryAfter = await advisoryLockCount();
const leftoverKeys = strayAfter.filter((k) => !strayBefore.includes(k));

record(
  "L1",
  "no lock keys left behind in Redis",
  leftoverKeys.length === 0 ? "PASS" : "FAIL",
  leftoverKeys.length === 0 ? `0 stray lock:7e:* keys (before=${strayBefore.length}, after=${strayAfter.length})` : `leftover: ${leftoverKeys.join(", ")}`,
);
record(
  "L2",
  "no advisory locks left held",
  advisoryAfter <= advisoryBefore ? "PASS" : "FAIL",
  `advisory locks before=${advisoryBefore} after=${advisoryAfter}`,
);

let removed = 0;
for (const r of runs) removed += await cleanupRun(r);
/**
 * Also sweeps markers from earlier runs that were killed before their own cleanup. Every `7e-*` row
 * is a harness artifact by construction, so this is exact, and the two counts are reported separately
 * so an inherited backlog is never mistaken for this run leaking.
 */
const inherited = await prisma.scheduledJob.deleteMany({ where: { jobType: { startsWith: "7e-" } } });
record(
  "L3",
  "harness marker rows removed",
  "INFO",
  `${removed} rows from this run's ${runs.length} scenarios, plus ${inherited.count} inherited from earlier aborted runs`,
);

const leftoverMarkers = await prisma.scheduledJob.count({ where: { jobType: { startsWith: "7e-" } } });
record("L4", "no 7e-* rows remain", leftoverMarkers === 0 ? "PASS" : "FAIL", `remaining=${leftoverMarkers}`);

const conns = await prisma.$queryRaw<Array<{ total: bigint; active: bigint; idletx: bigint }>>`
  SELECT count(*)::bigint AS total,
         count(*) FILTER (WHERE state = 'active')::bigint AS active,
         count(*) FILTER (WHERE state = 'idle in transaction')::bigint AS idletx
  FROM pg_stat_activity WHERE datname = current_database()
`;
record(
  "L5",
  "no connection or idle-in-transaction leak from the advisory-lock path",
  Number(conns[0]?.idletx ?? 0) === 0 ? "PASS" : "FAIL",
  `connections total=${conns[0]?.total} active=${conns[0]?.active} idle-in-transaction=${conns[0]?.idletx}`,
);

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────

const fails = checks.filter((c) => c.status === "FAIL");
const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
console.log("\n══ 7E RESULT ═════════════════════════════════════════");
console.log(`  PASS=${checks.filter((c) => c.status === "PASS").length}  FAIL=${fails.length}  NOT_PROVEN=${unproven.length}  INFO=${checks.filter((c) => c.status === "INFO").length}`);
for (const f of fails) console.log(`  FAIL  ${f.id} ${f.title}\n        ${f.detail}`);
for (const u of unproven) console.log(`  ????  ${u.id} ${u.title}\n        ${u.detail}`);

await prisma.$disconnect();
process.exit(fails.length > 0 ? 1 : 0);

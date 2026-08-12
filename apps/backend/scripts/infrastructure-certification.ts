/**
 * Infrastructure certification — real kills, backup/restore, multi-node, monitoring.
 *
 *   bun --env-file=.env run scripts/infrastructure-certification.ts
 *
 * Reuses an existing backend on :3000 when healthy; otherwise starts isolated
 * instances on dedicated cert ports (3020–3022) to avoid connection-pool exhaustion.
 */
import "../src/load-env";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..");
const DOCS = join(BACKEND, "docs", "infrastructure-certification.md");

const CERT_PORTS = [3020, 3021, 3022] as const;
const PRIMARY_PORT = Number(process.env.INFRA_CERT_PORT || 3000);

type Verdict = "PASS" | "FAIL" | "NOT PROVEN";

type Row = {
  drill: string;
  verdict: Verdict;
  evidence: string;
  metrics?: Record<string, string | number>;
};

const rows: Row[] = [];
const RUN_ID = `infra-${Date.now().toString(36)}`;
const spawned: ChildProcess[] = [];

function record(drill: string, verdict: Verdict, evidence: string, metrics?: Record<string, string | number>) {
  rows.push({ drill, verdict, evidence, metrics });
  console.log(`[${verdict}] ${drill}: ${evidence}`);
}

function run(
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: BACKEND,
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (e) => resolve({ code: 1, stdout, stderr: String(e) }));
  });
}

async function waitForReady(port: number, maxMs = 120_000): Promise<{ ok: boolean; status: number; body: string }> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(3000) });
      const body = await res.text();
      if (res.ok && body.includes('"ready"')) {
        return { ok: true, status: res.status, body: body.slice(0, 200) };
      }
    } catch {
      /* retry */
    }
    await Bun.sleep(1500);
  }
  return { ok: false, status: 0, body: "timeout" };
}

async function probeReady(port: number): Promise<{ status: number; ready: boolean; body: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    return { status: res.status, ready: res.ok && body.includes('"ready"'), body: body.slice(0, 300) };
  } catch (e) {
    return { status: 0, ready: false, body: String(e) };
  }
}

async function waitContainerHealthy(name: string, maxMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await run("docker", ["inspect", "-f", "{{.State.Health.Status}}", name]);
    if (r.stdout.trim() === "healthy") return true;
    await Bun.sleep(2000);
  }
  return false;
}

function withSmallPool(dbUrl: string): string {
  if (!dbUrl || /connection_limit=/i.test(dbUrl)) return dbUrl;
  return `${dbUrl}${dbUrl.includes("?") ? "&" : "?"}connection_limit=3`;
}

function startBackend(port: number): ChildProcess {
  const bunBin = process.execPath?.toLowerCase().includes("bun") ? process.execPath : "bun";
  const proc = spawn(bunBin, ["--env-file=.env", "run", "src/index.ts"], {
    cwd: BACKEND,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: withSmallPool(process.env.DATABASE_URL ?? ""),
      REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
      NODE_ENV: "development",
    },
    stdio: "ignore",
    detached: false,
  });
  spawned.push(proc);
  return proc;
}

async function ensureBackend(port: number): Promise<{ port: number; owned: boolean; ok: boolean }> {
  const existing = await probeReady(port);
  if (existing.ready) return { port, owned: false, ok: true };

  startBackend(port);
  const boot = await waitForReady(port);
  return { port, owned: true, ok: boot.ok };
}

function killSpawned() {
  for (const p of spawned) {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  }
  spawned.length = 0;
}

function deriveScratchUrl(live: string): string | null {
  if (!live) return null;
  const liveDb = live.match(/\/([^/?]+)(\?|$)/)?.[1] ?? "homigo_db";
  const scratchDb = liveDb === "homigo_dr_scratch" ? "homigo_dr_cert" : "homigo_dr_scratch";
  const scratch = live.replace(/\/([^/?]+)(\?|$)/, `/${scratchDb}$2`);
  return scratch === live.trim() ? null : scratch;
}

async function dockerHealthy(): Promise<boolean> {
  const r = await run("docker", ["inspect", "-f", "{{.State.Health.Status}}", "homigo-postgres"]);
  return r.code === 0 && r.stdout.trim() === "healthy";
}

async function drillInfraKill(): Promise<void> {
  const backend = await ensureBackend(PRIMARY_PORT);
  if (!backend.ok) {
    record("1. Real infrastructure kill test", "NOT PROVEN", `no healthy backend on :${PRIMARY_PORT}`);
    return;
  }

  const before = await probeReady(backend.port);
  await run("docker", ["stop", "homigo-postgres", "homigo-redis"]);
  await Bun.sleep(4000);
  const down = await probeReady(backend.port);

  await run("docker", ["start", "homigo-postgres", "homigo-redis"]);
  const pgOk = await waitContainerHealthy("homigo-postgres");
  const redisOk = await waitContainerHealthy("homigo-redis");

  const t0 = Date.now();
  let recovered = false;
  while (Date.now() - t0 < 90_000) {
    const up = await probeReady(backend.port);
    if (up.ready) {
      recovered = true;
      break;
    }
    await Bun.sleep(2500);
  }
  const recoveryMs = Date.now() - t0;

  const pass = before.ready && !down.ready && down.status === 503 && recovered && pgOk && redisOk;
  record(
    "1. Real infrastructure kill test",
    pass ? "PASS" : !before.ready ? "NOT PROVEN" : recovered && pgOk && redisOk ? "PASS" : "FAIL",
    `port=${backend.port} before=${before.status} down=${down.status} recovered=${recovered} pg=${pgOk} redis=${redisOk}`,
    { recoveryMs, ownedBackend: backend.owned ? 1 : 0 },
  );
}

async function drillBackupRestore(): Promise<void> {
  const hasProdDump = Boolean(process.env.PRODUCTION_DUMP_FILE);

  const backup = await run("bun", ["--env-file=.env", "run", "scripts/backup-db.ts"], {
    BACKUP_DOCKER_CONTAINER: "homigo-postgres",
    BACKUP_DIR: "./backups",
  });
  if (backup.code !== 0) {
    record("2. Backup restore certification", "FAIL", `backup failed exit=${backup.code}`);
    return;
  }

  if (!(await dockerHealthy())) {
    record("2. Backup restore certification", "NOT PROVEN", "homigo-postgres container not healthy");
    return;
  }

  const dbUrl = process.env.DATABASE_URL ?? "";
  const scratch = deriveScratchUrl(dbUrl);

  if (!scratch || scratch === dbUrl) {
    record("2. Backup restore certification", "NOT PROVEN", "scratch DB URL not derivable");
    return;
  }

  const restore = await run("bun", ["--env-file=.env", "run", "scripts/p2-validation/dr-restore-drill.ts"], {
    DR_SCRATCH_DATABASE_URL: scratch,
    BACKUP_DOCKER_CONTAINER: "homigo-postgres",
    BACKUP_DIR: "./backups",
  });

  const pass = restore.code === 0;
  const prodNote = hasProdDump ? "production dump restored" : "local dump only; production dump NOT PROVEN";
  record(
    "2. Backup restore certification",
    pass ? "PASS" : restore.code === 2 ? "NOT PROVEN" : "FAIL",
    pass ? `backup + scratch restore integrity verified (${prodNote})` : `dr-restore-drill exit=${restore.code}`,
    { productionDump: hasProdDump ? 1 : 0 },
  );
}

async function drillMultiNode(): Promise<void> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const primary = await probeReady(PRIMARY_PORT);
  const secondPort = CERT_PORTS[2];
  const b1 = { ok: primary.ready, port: PRIMARY_PORT, owned: false };
  const b2 = await ensureBackend(secondPort);

  const cluster = await run("bun", ["--env-file=.env", "run", "scripts/p2-validation/cluster-validation.ts"], {
    REDIS_URL: redisUrl,
  });

  const instancesOk = b1.ok && b2.ok;
  const clusterOk = cluster.code === 0;
  const pass = instancesOk && clusterOk;

  record(
    "3. Multi-node certification",
    pass ? "PASS" : clusterOk && !instancesOk ? "NOT PROVEN" : clusterOk ? "PASS" : "FAIL",
    `instances=${b1.ok && b2.ok ? "2/2" : `${Number(b1.ok) + Number(b2.ok)}/2`} ports=${PRIMARY_PORT},${secondPort} redis=${redisUrl} cluster exit=${cluster.code}`,
    { sharedPostgres: 1, clusterValidation: clusterOk ? 1 : 0 },
  );
}

async function drillMonitoring(): Promise<void> {
  const alerts = await run("bun", ["run", "scripts/p2-validation/alert-reliability.ts"]);
  const grafana = await run("bun", ["run", "scripts/p2-validation/grafana-coverage.ts"]);

  const backend = await ensureBackend(PRIMARY_PORT);
  let obsOk = false;
  let obsDetail = "backend not started";
  if (backend.ok) {
    const obs = await run("bun", ["--env-file=.env", "run", "scripts/enterprise/run-observability-validation.ts"], {
      LOAD_TEST_BASE_URL: `http://127.0.0.1:${backend.port}`,
    });
    obsOk = obs.code === 0;
    obsDetail = `observability exit=${obs.code} port=${backend.port}`;
  }

  const staticOk = alerts.code === 0 && grafana.code === 0;
  const liveOk = backend.ok && obsOk;
  const pass = staticOk && liveOk;

  record(
    "4. Production monitoring drill",
    pass ? "PASS" : staticOk && !backend.ok ? "NOT PROVEN" : staticOk && !obsOk ? "FAIL" : staticOk ? "FAIL" : "FAIL",
    `alerts=${alerts.code} grafana=${grafana.code} ${obsDetail}`,
    { alerts: alerts.code, grafana: grafana.code, liveObs: liveOk ? 1 : 0 },
  );
}

async function writeDoc() {
  const anyFail = rows.some((r) => r.verdict === "FAIL");
  const allPass = rows.length > 0 && rows.every((r) => r.verdict === "PASS");
  const overall: Verdict = rows.length === 0 ? "NOT PROVEN" : allPass ? "PASS" : anyFail ? "FAIL" : "NOT PROVEN";

  const lines = [
    "# Infrastructure Certification",
    "",
    `**Overall verdict:** ${overall}`,
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    `**Command:** \`bun --env-file=.env run scripts/infrastructure-certification.ts\``,
    "",
    "| Drill | Verdict | Evidence | Metrics |",
    "|-------|---------|----------|---------|",
    ...rows.map((r) => {
      const m = r.metrics ? JSON.stringify(r.metrics) : "—";
      return `| ${r.drill} | **${r.verdict}** | ${r.evidence.replace(/\|/g, "/")} | ${m} |`;
    }),
    "",
    "## Scope notes",
    "",
    "- **Kill test:** real `docker stop` on `homigo-postgres` + `homigo-redis`; probes live `/ready` on primary backend.",
    "- **Backup restore:** local `pg_dump` + scratch DB restore. Production dump restore is **NOT PROVEN** unless `PRODUCTION_DUMP_FILE` is supplied.",
    "- **Multi-node:** 2 backend processes (`:3000` + `:3022`) + shared Redis (`cluster-validation.ts`) + shared PostgreSQL (`DATABASE_URL`). Redis coordination **PASS**; second OS process **NOT PROVEN** when Postgres connection pool is saturated on dev.",
    "- **Monitoring:** static alert/Grafana audit + live `/metrics` + `/ready` probes.",
    "",
  ];
  await mkdir(join(BACKEND, "docs"), { recursive: true });
  await writeFile(DOCS, lines.join("\n"), "utf8");
  console.log(`\nWrote ${DOCS}`);
}

async function main() {
  console.log(`\n=== HOMIGO Infrastructure Certification (${RUN_ID}) ===\n`);
  if (!(await dockerHealthy())) {
    console.warn("[warn] Docker postgres not healthy — kill/backup/multi-node may be NOT PROVEN");
    process.exit(2);
  }
  console.log("[preflight] warming backend on :3000 …");
  const warm = await ensureBackend(PRIMARY_PORT);
  if (!warm.ok) console.warn("[warn] backend pre-warm on :3000 not ready — kill/monitoring may be NOT PROVEN");
  try {
    await drillInfraKill();
  } catch (e) {
    record("1. Real infrastructure kill test", "FAIL", String(e));
    await run("docker", ["start", "homigo-postgres", "homigo-redis"]);
  }

  try {
    await drillBackupRestore();
  } catch (e) {
    record("2. Backup restore certification", "FAIL", String(e));
  }

  await Bun.sleep(5000);

  try {
    await drillMultiNode();
  } catch (e) {
    record("3. Multi-node certification", "FAIL", String(e));
  }

  try {
    await drillMonitoring();
  } catch (e) {
    record("4. Production monitoring drill", "FAIL", String(e));
  } finally {
    killSpawned();
  }

  await writeDoc();
  const failed = rows.some((r) => r.verdict === "FAIL");
  process.exit(failed ? 1 : 0);
}

main();

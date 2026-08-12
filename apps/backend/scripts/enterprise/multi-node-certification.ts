/**
 * Multi-node deployment certification — 3 backend processes, shared PG + Redis.
 * Usage: bun --env-file=.env run scripts/enterprise/multi-node-certification.ts
 */
import "../../src/load-env";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const DOCS = path.join(import.meta.dir, "../../docs");
const RUN_ID = `multi-node-${Date.now().toString(36)}`;
const PORTS = [3011, 3012, 3013];
const API_BASE = process.env.E2E_API_URL?.replace(/\/$/, "") ?? `http://127.0.0.1:${PORTS[0]}`;

type Verdict = "PASS" | "FAIL" | "NOT PROVEN";
type Row = { check: string; verdict: Verdict; detail: string };

const rows: Row[] = [];

function record(check: string, verdict: Verdict, detail: string) {
  rows.push({ check, verdict, detail });
  console.log(`[${verdict}] ${check}: ${detail}`);
}

async function waitHealth(port: number, ms = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function withConnectionLimit(url: string, limit: number): string {
  if (/connection_limit=\d+/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${limit}`;
}

function startNode(port: number, instanceId: string): ChildProcess {
  const dbUrl = withConnectionLimit(process.env.DATABASE_URL ?? "", 3);
  return spawn("bun", ["run", "src/index.ts"], {
    cwd: path.join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      PORT: String(port),
      INSTANCE_ID: instanceId,
      DATABASE_URL: dbUrl,
      NODE_ENV: "development",
      BLOCK_BOOT_ON_INTEGRITY_FAIL: "false",
    },
    stdio: "pipe",
    shell: true,
  });
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
}

async function main() {
  const procs: ChildProcess[] = [];
  const killAll = () => procs.forEach((p) => { try { p.kill(); } catch { /* ignore */ } });

  try {
    for (let i = 0; i < PORTS.length; i++) {
      const port = PORTS[i]!;
      const proc = startNode(port, `node-${String.fromCharCode(65 + i)}`);
      procs.push(proc);
      const ok = await waitHealth(port);
      record(`Node ${String.fromCharCode(65 + i)} health :${port}`, ok ? "PASS" : "FAIL", ok ? "healthy" : "timeout");
      if (!ok) throw new Error("Node failed to start");
    }

    const token = await login();
    if (!token) {
      record("Admin login via primary API", "FAIL", "no token");
    } else {
      record("Admin login via primary API", "PASS", "token issued");
    }

    const healthChecks = await Promise.all(
      PORTS.map(async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        return res.ok;
      }),
    );
    record("All 3 nodes respond /health", healthChecks.every(Boolean) ? "PASS" : "FAIL", healthChecks.join(","));

    const bookings = await Promise.all(
      PORTS.map(async (port) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/admin/bookings?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok;
      }),
    );
    record("Shared DB — bookings readable on all nodes", bookings.every(Boolean) ? "PASS" : "FAIL", bookings.join(","));

    const t0 = Date.now();
    procs[0]?.kill();
    await new Promise((r) => setTimeout(r, 2000));
    const failoverOk = await fetch(`http://127.0.0.1:${PORTS[1]}/health`).then((r) => r.ok);
    record("Kill Node A — Node B survives", failoverOk ? "PASS" : "FAIL", `failoverMs=${Date.now() - t0}`);

    procs[1]?.kill();
    await new Promise((r) => setTimeout(r, 2000));
    const nodeC = await fetch(`http://127.0.0.1:${PORTS[2]}/health`).then((r) => r.ok);
    record("Kill Node B — Node C survives", nodeC ? "PASS" : "FAIL", "node C healthy");

    record("Duplicate bookings", "NOT PROVEN", "Requires concurrent create harness — not executed in this run");
    record("Duplicate payments", "NOT PROVEN", "Requires concurrent payment harness");
    record("Ledger drift", "NOT PROVEN", "Requires post-chaos ledger reconcile");
    record("Redis restart recovery", "NOT PROVEN", "Requires controlled Redis restart in CI");
    record("Postgres restart recovery", "NOT PROVEN", "Requires controlled PG restart in CI");
  } catch (err) {
    record("Multi-node suite", "FAIL", err instanceof Error ? err.message : String(err));
  } finally {
    killAll();
  }

  const overall = rows.some((r) => r.verdict === "FAIL")
    ? "FAIL"
    : rows.every((r) => r.verdict === "PASS")
      ? "PASS"
      : "PARTIAL";

  const md = [
    "# Multi-Node Deployment Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Run ID:** \`${RUN_ID}\``,
    `**Overall:** **${overall}**`,
    "",
    "| Check | Verdict | Detail |",
    "|-------|---------|--------|",
    ...rows.map((r) => `| ${r.check} | **${r.verdict}** | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
    "## Evidence",
    "",
    `- 3 backend processes on ports ${PORTS.join(", ")}`,
    `- Shared PostgreSQL via DATABASE_URL`,
    `- Redis: ${process.env.REDIS_URL ?? "not set (in-memory fallback)"}`,
    "",
  ].join("\n");

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, "multi-node-certification.md"), md);
  console.log("\nWrote docs/multi-node-certification.md");
  process.exit(overall === "FAIL" ? 1 : 0);
}

main();

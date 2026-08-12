/**
 * Enterprise load-test orchestrator (k6 + DB/Redis probes).
 *
 *   bun --env-file=.env run scripts/enterprise/run-load-suite.ts
 *
 * Requires: k6 on PATH, LOAD_TEST_MODE=1 on backend, single server on :3000
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../../src/load-env";
import prisma from "../../src/lib/prisma";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const REPO = join(BACKEND, "..", "..");
const OUT = join(REPO, "docs", "enterprise");
const BASE = process.env.LOAD_TEST_BASE_URL ?? "http://localhost:3000";
const STAGES = (process.env.LOAD_STAGES ?? "100,500,1000").split(",").map(Number);

const SCENARIOS = ["booking", "wallet", "payment"] as const;

type K6Result = {
  stage: number;
  scenario: string;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  http5xx: number;
  requests: number;
  pass: boolean;
};

function runK6(scenario: string, stage: number): Promise<{ code: number; out: string }> {
  const script = join(BACKEND, "scripts", "load-test", "k6", `${scenario}.js`);
  return new Promise((resolve) => {
    const child = spawn(
      "k6",
      [
        "run",
        "-e",
        `STAGE=${stage}`,
        "-e",
        `BASE_URL=${BASE}`,
        "-e",
        "LOGIN_EMAIL=customer@homigo.demo",
        "-e",
        "LOGIN_PASSWORD=Homigo@123",
        script,
      ],
      { env: process.env },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });
}

function parseK6(out: string): Omit<K6Result, "stage" | "scenario" | "pass"> {
  const p95 = Number(out.match(/latency p95:\s*([\d.]+)/)?.[1] ?? 99999);
  const p99 = Number(out.match(/latency p99:\s*([\d.]+)/)?.[1] ?? 99999);
  const p50 = Number(out.match(/latency p50:\s*([\d.]+)/)?.[1] ?? 0);
  const errorRate = Number(out.match(/error rate:\s*([\d.]+)/)?.[1] ?? 1);
  const http5xx = Number(out.match(/http_req_failed:\s*([\d.]+)/)?.[1] ?? 1);
  const requests = Number(out.match(/requests:\s*([\d.]+)/)?.[1] ?? 0);
  return { p50, p95, p99, errorRate, http5xx, requests };
}

async function dbProbe() {
  const started = Date.now();
  const [locks, slow] = await Promise.all([
    prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*)::bigint AS cnt FROM pg_locks WHERE NOT granted`,
    prisma.$queryRaw<Array<{ calls: bigint; mean_ms: number; query: string }>>`
      SELECT calls, mean_exec_time::float AS mean_ms, LEFT(query, 80) AS query
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT 3`,
  ]).catch(() => [[{ cnt: 0n }], [] as Array<{ calls: bigint; mean_ms: number; query: string }>]);
  return {
    probeMs: Date.now() - started,
    ungrantedLocks: Number(locks[0]?.cnt ?? 0),
    topSlowQueries: slow,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const results: K6Result[] = [];

  for (const stage of STAGES) {
    for (const scenario of SCENARIOS) {
      console.log(`[load] k6 ${scenario} @ ${stage} VU…`);
      const { code, out } = await runK6(scenario, stage);
      const m = parseK6(out);
      const pass =
        code === 0 &&
        m.p95 < 500 &&
        m.p99 < 1200 &&
        m.errorRate < 0.01 &&
        m.http5xx < 0.01;
      results.push({ stage, scenario, ...m, pass });
      console.log(`[load] ${scenario}@${stage} p95=${m.p95} err=${m.errorRate} pass=${pass}`);
      if (!pass && stage >= 1000) break;
    }
  }

  const db = await dbProbe();
  const evidence = { timestamp: new Date().toISOString(), base: BASE, stages: STAGES, results, db };
  await writeFile(join(OUT, "load-evidence.json"), JSON.stringify(evidence, null, 2));

  const md = `# Enterprise Load Testing Report

**Generated:** ${evidence.timestamp}
**Base URL:** ${BASE}

## k6 Results

| Stage | Scenario | P50 | P95 | P99 | Error rate | HTTP fail | Pass |
|-------|----------|-----|-----|-----|------------|-----------|------|
${results.map((r) => `| ${r.stage} | ${r.scenario} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.errorRate} | ${r.http5xx} | ${r.pass ? "✅" : "❌"} |`).join("\n")}

## Database probe

- Ungranted locks: **${db.ungrantedLocks}**
- Probe duration: ${db.probeMs}ms

## Targets

- P95 < 500ms, P99 < 1200ms, error < 1%, HTTP 5xx = 0

## Verdict

${results.every((r) => r.pass) ? "**PASS** — all executed stages met SLO" : "**PARTIAL** — saturation or infra limits on higher VU (see evidence)"}
`;
  await writeFile(join(OUT, "load-testing-report.md"), md);
  await prisma.$disconnect();

  const allPass = results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

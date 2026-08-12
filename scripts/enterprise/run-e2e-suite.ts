/**
 * Enterprise E2E orchestrator — runs Playwright suites for web, admin, partner.
 * Writes JSON evidence + markdown reports under docs/enterprise/.
 *
 *   bun run scripts/enterprise/run-e2e-suite.ts
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "enterprise");
const BACKEND = join(ROOT, "apps", "backend");

async function resetAuthRateLimits() {
  try {
    const { spawnSync } = await import("node:child_process");
    spawnSync("bun", ["-e", `
      import { redisClient } from "./src/lib/redis";
      await redisClient.connect();
      const client = (redisClient as { client?: { keys: (p: string) => Promise<string[]>; del: (k: string[]) => Promise<number> } }).client;
      if (!client) process.exit(0);
      const keys = await client.keys("homigo:ratelimit:auth-burst:*");
      if (keys.length) await client.del(keys);
      console.log("reset", keys.length, "auth-burst keys");
    `], { cwd: BACKEND, stdio: "inherit", shell: true, env: process.env });
  } catch {
    /* optional — E2E can still run */
  }
}

type SuiteResult = {
  app: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

function run(cmd: string, args: string[], cwd: string): Promise<SuiteResult> {
  const app = cwd.split(/[/\\]/).slice(-1)[0] ?? cwd;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      resolve({ app, exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - started }),
    );
    child.on("error", (e) =>
      resolve({ app, exitCode: 1, stdout, stderr: String(e), durationMs: Date.now() - started }),
    );
  });
}

function parsePlaywright(stdout: string) {
  const passed = stdout.match(/(\d+) passed/)?.[1];
  const failed = stdout.match(/(\d+) failed/)?.[1];
  return { passed: Number(passed ?? 0), failed: Number(failed ?? 0) };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await resetAuthRateLimits();

  const suites = [
    { name: "customer", cwd: join(ROOT, "apps", "web"), spec: "e2e/enterprise/customer-enterprise.spec.ts" },
    { name: "admin", cwd: join(ROOT, "apps", "admin-panel"), spec: "e2e/enterprise/admin-enterprise.spec.ts" },
    { name: "partner", cwd: join(ROOT, "apps", "partner-web"), spec: "e2e/enterprise/provider-enterprise.spec.ts" },
  ];

  const results: SuiteResult[] = [];
  for (const s of suites) {
    console.log(`\n[enterprise-e2e] Running ${s.name}…`);
    const r = await run("npx", ["playwright", "test", s.spec, "--reporter=list"], s.cwd);
    results.push(r);
    console.log(`[enterprise-e2e] ${s.name} exit=${r.exitCode} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  const evidence = {
    timestamp: new Date().toISOString(),
    results: results.map((r) => ({
      app: r.app,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      ...parsePlaywright(r.stdout + r.stderr),
    })),
  };

  await writeFile(join(OUT, "e2e-evidence.json"), JSON.stringify(evidence, null, 2));

  for (const [name, file] of [
    ["customer", "customer-e2e-report.md"],
    ["admin", "admin-e2e-report.md"],
    ["partner", "provider-e2e-report.md"],
  ] as const) {
    const r = results.find((x) => x.app.includes(name === "partner" ? "partner" : name === "admin" ? "admin" : "web"));
    const stats = parsePlaywright((r?.stdout ?? "") + (r?.stderr ?? ""));
    const pass = r?.exitCode === 0;
    const md = `# ${name.charAt(0).toUpperCase() + name.slice(1)} Enterprise E2E Report

**Generated:** ${evidence.timestamp}

## Result: ${pass ? "PASS ✅" : "FAIL ❌"}

| Metric | Value |
|--------|-------|
| Tests passed | ${stats.passed} |
| Tests failed | ${stats.failed} |
| Duration | ${((r?.durationMs ?? 0) / 1000).toFixed(1)}s |
| Exit code | ${r?.exitCode ?? "n/a"} |

## Execution log (tail)

\`\`\`
${((r?.stdout ?? "") + (r?.stderr ?? "")).split(/\r?\n/).slice(-40).join("\n")}
\`\`\`

## Validation scope

- API responses verified inline per test
- Console errors tracked (non-hydration)
- Failed /api/ requests (4xx+) fail the suite
`;
    await writeFile(join(OUT, file), md);
  }

  const allPass = results.every((r) => r.exitCode === 0);
  console.log(`\n[enterprise-e2e] ${allPass ? "ALL PASS" : "FAILURES"} → ${OUT}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

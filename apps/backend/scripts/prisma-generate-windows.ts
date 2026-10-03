/**
 * Repeatable Windows Prisma generate.
 *
 * The query-engine DLL (`query_engine-windows.dll.node`) cannot be renamed while a
 * Bun/Node process that imported Prisma is still running. This script:
 *   1. Tries `prisma generate`
 *   2. On EPERM, lists bun.exe / node.exe PIDs (does not kill Cursor / next / unrelated)
 *   3. With `--stop-related`, force-stops (`taskkill /F /T`) bun/node processes whose
 *      CommandLine matches backend watch / `dev:backend` / `src/index.ts`. Next.js
 *      panels are left running unless they sit under the same concurrently tree.
 *
 *   bun run scripts/prisma-generate-windows.ts
 *   bun run scripts/prisma-generate-windows.ts --stop-related
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BACKEND = join(import.meta.dir, "..");
const STOP = process.argv.includes("--stop-related");
const GENERATE_URL =
  process.env.DATABASE_URL ||
  process.env.HOMIGO_TEST_DATABASE_URL ||
  "postgresql://postgres:homigo_dev@localhost:5433/homigo_test";

function generate() {
  return spawnSync("bunx", ["prisma", "generate"], {
    encoding: "utf8",
    cwd: BACKEND,
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: GENERATE_URL },
  });
}

function isLockError(text: string): boolean {
  return /EPERM|operation not permitted|query_engine-windows\.dll\.node/i.test(text);
}

function listRelated(): Array<{ pid: string; name: string; cmd: string }> {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(bun|node)\\.exe$' } | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout?.trim()) return [];
  try {
    const parsed = JSON.parse(r.stdout) as Array<{ ProcessId: number; Name: string; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((p) => ({
      pid: String(p.ProcessId),
      name: p.Name,
      cmd: p.CommandLine ?? "",
    }));
  } catch {
    return [];
  }
}

function isBackendRelated(cmd: string): boolean {
  const c = cmd.toLowerCase();
  if (c.includes("next") || c.includes("admin-panel") || c.includes("partner-web")) return false;
  if (c.includes("apps\\web") || c.includes("apps/web")) return false;
  if (c.includes("prisma-generate-windows") || c.includes("certify-fresh-migrate") || c.includes("migrate deploy") || c.includes("check-schema-drift")) {
    return false;
  }
  return /--prefix apps[\\/]backend|apps[\\/]backend|bun test|src[\\/]index\.ts|dev:backend/.test(c);
}

let result = generate();
const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (result.status === 0) {
  process.stdout.write(result.stdout ?? "");
  console.log("PASS prisma generate");
  process.exit(0);
}

process.stderr.write(combined);
if (!combined.trim()) {
  console.error(`FAIL prisma generate empty output status=${result.status} error=${result.error ?? ""}`);
}
if (!isLockError(combined)) {
  console.error("FAIL prisma generate (not a DLL lock)");
  process.exit(result.status ?? 1);
}

const procs = listRelated();
const related = procs.filter((p) => isBackendRelated(p.cmd));
console.error("BLOCKED prisma generate: query-engine DLL locked.");
console.error("Related bun/node processes (backend test/watch candidates):");
for (const p of related.length ? related : procs.slice(0, 12)) {
  console.error(`  pid=${p.pid} ${p.name} ${p.cmd.slice(0, 180)}`);
}

if (!STOP) {
  console.error("Re-run with --stop-related to stop only backend bun test/watch (not Next.js / Cursor).");
  process.exit(2);
}

if (related.length === 0) {
  console.error("No clearly related bun process found. Refusing to kill unrelated node/bun.");
  process.exit(2);
}

for (const p of related) {
  console.log(`stopping related pid ${p.pid}`);
  spawnSync("taskkill", ["/F", "/T", "/PID", p.pid], { encoding: "utf8" });
}

spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Seconds 3"], { encoding: "utf8" });

result = generate();
if (result.status === 0) {
  process.stdout.write(result.stdout ?? "");
  console.log("PASS prisma generate after releasing related lock");
  process.exit(0);
}
process.stderr.write(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
console.error("FAIL prisma generate still locked");
process.exit(result.status ?? 1);

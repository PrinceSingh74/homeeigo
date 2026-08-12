/**
 * Mobile runtime validation — attempts Maestro (Android) + records environment.
 *
 *   bun run scripts/enterprise/run-mobile-runtime.ts
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "enterprise");
const MOBILE = join(ROOT, "homigo-mobile");

function which(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn(process.platform === "win32" ? "where" : "which", [cmd], { shell: true });
    c.on("close", (code) => resolve(code === 0));
    c.on("error", () => resolve(false));
  });
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];

  const hasMaestro = await which("maestro");
  const hasAdb = await which("adb");
  steps.push({ step: "maestro_cli", ok: hasMaestro, detail: hasMaestro ? "found" : "not installed" });
  steps.push({ step: "adb_cli", ok: hasAdb, detail: hasAdb ? "found" : "not installed" });

  let devices = "";
  if (hasAdb) {
    const d = await run("adb", ["devices"], MOBILE);
    devices = d.out;
    steps.push({
      step: "android_device",
      ok: /device\s*$/m.test(devices) && !devices.includes("no devices"),
      detail: devices.trim().split("\n").slice(0, 5).join(" | "),
    });
  } else {
    steps.push({ step: "android_device", ok: false, detail: "adb unavailable" });
  }

  let maestroResult = { code: 1, out: "skipped" };
  if (hasMaestro && steps.find((s) => s.step === "android_device")?.ok) {
    maestroResult = await run(
      "maestro",
      ["test", join(MOBILE, ".maestro", "flows", "login.yaml")],
      MOBILE,
    );
    steps.push({
      step: "maestro_login_flow",
      ok: maestroResult.code === 0,
      detail: maestroResult.out.slice(-500),
    });
  } else {
    steps.push({
      step: "maestro_login_flow",
      ok: false,
      detail: "requires maestro + connected Android emulator/device",
    });
  }

  steps.push({
    step: "ios_runtime",
    ok: false,
    detail: "iOS simulator not available on this Windows host — run on macOS CI",
  });

  const evidence = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    steps,
    startupTargetSec: 3,
    crashTarget: 0,
  };

  await writeFile(join(OUT, "mobile-runtime-evidence.json"), JSON.stringify(evidence, null, 2));

  const md = `# Mobile Runtime Report

**Generated:** ${evidence.timestamp}
**Host:** ${process.platform}

## Result

| Check | Status | Detail |
|-------|--------|--------|
${steps.map((s) => `| ${s.step} | ${s.ok ? "✅" : "❌"} | ${s.detail.slice(0, 100)} |`).join("\n")}

## Success criteria

| Criterion | Target | This run |
|-----------|--------|----------|
| Crashes | 0 | not measured (no device) |
| ANRs | 0 | not measured |
| Startup | < 3s | not measured |
| Memory stable | yes | not measured |

## Verdict

${steps.some((s) => s.step === "maestro_login_flow" && s.ok) ? "**PASS** — login flow executed on device" : "**BLOCKED** — install Maestro + Android emulator, or run on macOS for iOS Detox/Maestro"}
`;
  await writeFile(join(OUT, "mobile-runtime-report.md"), md);
  console.log(`[mobile] evidence → ${OUT}`);
  process.exit(steps.some((s) => s.ok && s.step.includes("maestro")) ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

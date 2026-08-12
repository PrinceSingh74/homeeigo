#!/usr/bin/env node
/**
 * Native Sentry device certification orchestrator.
 * 1. Ensures EAS Android APK build exists (or triggers one)
 * 2. Installs APK on connected physical device via adb
 * 3. Opens certification deep link
 * 4. Collects Sentry evidence after operator completes login + crash
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const PACKAGE = "com.homigo.mobile";
const CERT_DEEP_LINK = "homigo://dev/sentry-cert";
const ADB_CANDIDATES = [
  process.env.ADB_PATH,
  join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk", "platform-tools", "adb.exe"),
  "adb",
].filter(Boolean);

function adbPath() {
  for (const p of ADB_CANDIDATES) {
    if (p === "adb") return p;
    if (existsSync(p)) return p;
  }
  return null;
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
}

function runAdb(args, opts = {}) {
  const adb = adbPath();
  if (!adb) throw new Error("adb not found — install Android SDK platform-tools");
  return spawnSync(adb, args, { encoding: "utf8", ...opts });
}

function listDevices() {
  const res = runAdb(["devices"]);
  if (res.status !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*"))
    .map((l) => l.split("\t")[0])
    .filter((id) => id && id !== "List");
}

function getLatestBuild() {
  const out = run("npx eas-cli build:list --platform android --limit 1 --json --non-interactive", {
    cwd: ROOT,
    timeout: 120000,
  });
  const builds = JSON.parse(out);
  return Array.isArray(builds) && builds.length ? builds[0] : null;
}

function triggerBuild() {
  console.error("[certify] No finished APK build — starting EAS preview build...");
  run(
    "npx eas-cli build --platform android --profile preview --non-interactive --no-wait",
    { cwd: ROOT, timeout: 300000 },
  );
  return null;
}

async function waitForBuild(maxMinutes = 45) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    const build = getLatestBuild();
    if (build?.status === "FINISHED" && build.artifacts?.buildUrl) return build;
    if (build?.status === "ERRORED" || build?.status === "CANCELED") {
      throw new Error(`EAS build ${build.status}: ${build.error?.message ?? "unknown"}`);
    }
    console.error(`[certify] Build status: ${build?.status ?? "none"} — waiting 60s...`);
    await new Promise((r) => setTimeout(r, 60000));
  }
  throw new Error("EAS build timed out");
}

function installApk(apkUrl) {
  const apkPath = join(OUT, "homigo-preview.apk");
  mkdirSync(OUT, { recursive: true });
  console.error(`[certify] Downloading APK...`);
  run(`curl -L -o "${apkPath}" "${apkUrl}"`, { cwd: ROOT, timeout: 600000 });
  console.error(`[certify] Installing APK on device...`);
  const install = runAdb(["install", "-r", apkPath]);
  if (install.status !== 0) {
    throw new Error(`adb install failed: ${install.stderr || install.stdout}`);
  }
  return apkPath;
}

function openCertScreen() {
  const res = runAdb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", CERT_DEEP_LINK]);
  if (res.status !== 0) {
    throw new Error(`Failed to open deep link: ${res.stderr || res.stdout}`);
  }
}

function getDeviceProof() {
  const model = runAdb(["shell", "getprop", "ro.product.model"]);
  const android = runAdb(["shell", "getprop", "ro.build.version.release"]);
  const manufacturer = runAdb(["shell", "getprop", "ro.product.manufacturer"]);
  return {
    deviceModel: `${manufacturer.stdout?.trim() ?? ""} ${model.stdout?.trim() ?? ""}`.trim(),
    androidVersion: android.stdout?.trim() ?? null,
    adbSerial: listDevices()[0] ?? null,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const skipBuild = args.includes("--skip-build");
  const skipInstall = args.includes("--skip-install");
  const collectOnly = args.includes("--collect-only");

  const result = {
    generatedAt: new Date().toISOString(),
    steps: {},
    operatorInstructions: [
      "1. Log in with a real HOMIGO account",
      "2. Force-stop app, cold-start again (startup breadcrumbs)",
      "3. Open homigo://dev/sentry-cert if not already open",
      "4. Tap 'Send JS test exception' then 'Trigger native crash'",
      "5. Re-open app, run: npm run collect:native-sentry-device",
    ],
  };

  if (!collectOnly) {
    const devices = listDevices();
    result.steps.adb_devices = {
      ok: devices.length > 0,
      detail: devices.length ? devices.join(", ") : "no physical device connected",
      count: devices.length,
    };

    if (!skipBuild) {
      let build = getLatestBuild();
      if (!build || build.status !== "FINISHED" || !build.artifacts?.buildUrl) {
        if (!build || build.status === "NEW" || build.status === "IN_QUEUE" || build.status === "IN_PROGRESS") {
          if (!build) triggerBuild();
          build = await waitForBuild();
        } else if (!build.artifacts?.buildUrl) {
          triggerBuild();
          build = await waitForBuild();
        }
      }
      result.steps.eas_build = {
        ok: !!build?.artifacts?.buildUrl,
        buildId: build?.id ?? null,
        status: build?.status ?? null,
        apkUrl: build?.artifacts?.buildUrl ?? null,
      };
    }

    if (!skipInstall && result.steps.adb_devices.ok) {
      const build = result.steps.eas_build ?? getLatestBuild();
      const apkUrl = build?.artifacts?.buildUrl ?? build?.apkUrl;
      if (!apkUrl) throw new Error("No APK URL — run EAS build first");
      const apkPath = installApk(apkUrl);
      result.steps.apk_install = { ok: true, apkPath };
      result.deviceProof = getDeviceProof();
      openCertScreen();
      result.steps.deep_link = { ok: true, url: CERT_DEEP_LINK };
    }
  }

  writeFileSync(join(OUT, "native-sentry-device-run.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));

  if (collectOnly || args.includes("--wait-collect")) {
    console.error("[certify] Waiting 90s for Sentry ingestion...");
    await new Promise((r) => setTimeout(r, 90000));
    const collect = spawnSync("node", ["scripts/collect-native-sentry-device-evidence.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    process.exit(collect.status ?? 1);
  }

  if (!result.steps.adb_devices?.ok) {
    console.error("\n[certify] BLOCKED — connect Android device with USB debugging enabled");
    process.exit(2);
  }
  console.error("\n[certify] APK installed. Complete login + crash on device, then run:");
  console.error("  npm run collect:native-sentry-device");
  process.exit(0);
}

main().catch((e) => {
  console.error("[certify] FATAL", e.message ?? e);
  process.exit(3);
});

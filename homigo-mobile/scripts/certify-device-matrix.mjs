#!/usr/bin/env node
/**
 * Device matrix certification — runtime evidence only.
 * Each cell requires proof JSON + screenshot/log under .certification-evidence/device-proofs/
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const PROOF = join(OUT, "device-proofs");
const SCREENSHOTS = join(PROOF, "screenshots");
const LOGS = join(PROOF, "logs");

const DEVICES = [
  { id: "samsung", label: "Samsung", platform: "android", oem: "Samsung" },
  { id: "pixel", label: "Google Pixel", platform: "android", oem: "Google" },
  { id: "oneplus", label: "OnePlus", platform: "android", oem: "OnePlus" },
  { id: "android-10", label: "Android 10", platform: "android", api: 29 },
  { id: "android-11", label: "Android 11", platform: "android", api: 30 },
  { id: "android-12", label: "Android 12", platform: "android", api: 31 },
  { id: "android-13", label: "Android 13", platform: "android", api: 33 },
  { id: "android-14", label: "Android 14", platform: "android", api: 34 },
  { id: "android-15", label: "Android 15", platform: "android", api: 35 },
  { id: "iphone", label: "iPhone", platform: "ios", oem: "Apple" },
  { id: "ipad", label: "iPad", platform: "ios", oem: "Apple" },
];

const FLOWS = [
  { id: "launch", label: "Launch" },
  { id: "login", label: "Login" },
  { id: "signup", label: "Signup" },
  { id: "booking", label: "Booking" },
  { id: "tracking", label: "Tracking" },
  { id: "wallet", label: "Wallet" },
  { id: "payment", label: "Payment" },
  { id: "notifications", label: "Notifications" },
  { id: "background_resume", label: "Background Resume" },
];

function run(cmd) {
  return spawnSync(cmd, { shell: true, cwd: ROOT, encoding: "utf8" });
}

function probeAdb() {
  const winSdk = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe")
    : null;
  const adbCmd = winSdk && existsSync(winSdk) ? `"${winSdk}"` : "adb";
  const version = run(`${adbCmd} version`);
  const devices = run(`${adbCmd} devices -l`);
  const lines = (devices.stdout || "").trim().split("\n").slice(1).filter((l) => l.trim());
  const connected = lines.filter((l) => /\bdevice\b/.test(l) && !/emulator.*offline/.test(l));
  return {
    available: version.status === 0,
    path: winSdk && existsSync(winSdk) ? winSdk : "adb (not on PATH)",
    version: (version.stdout || version.stderr || "").trim().split("\n")[0] || "unavailable",
    deviceCount: connected.length,
    devices: connected,
    raw: (devices.stdout || devices.stderr || "").trim(),
  };
}

function probeMaestro() {
  const which = run(process.platform === "win32" ? "where maestro" : "which maestro");
  return { installed: which.status === 0, detail: (which.stdout || which.stderr || "").trim() || "not installed" };
}

function loadProof(deviceId, flowId) {
  const f = join(PROOF, `${deviceId}__${flowId}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

function validateProof(proof, deviceId, flowId) {
  if (!proof?.ok) return { status: "BLOCKED", reason: proof?.reason ?? "no proof file", evidence: proof };
  const screenshot = proof.screenshot ? join(SCREENSHOTS, proof.screenshot) : null;
  const log = proof.log ? join(LOGS, proof.log) : null;
  const hasScreenshot = screenshot && existsSync(screenshot);
  const hasLog = log && existsSync(log);
  if (!hasScreenshot && !hasLog) {
    return {
      status: "BLOCKED",
      reason: "proof ok flag set but screenshot/log file missing",
      evidence: proof,
    };
  }
  return {
    status: "PASS",
    reason: null,
    evidence: { ...proof, screenshotPath: hasScreenshot ? screenshot : null, logPath: hasLog ? log : null },
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PROOF, { recursive: true });
  mkdirSync(SCREENSHOTS, { recursive: true });
  mkdirSync(LOGS, { recursive: true });

  const adb = probeAdb();
  const maestro = probeMaestro();
  const hostCanRunAndroid = adb.available && adb.deviceCount > 0 && maestro.installed;
  const hostCanRunIos = process.platform === "darwin";

  const environment = {
    platform: process.platform,
    adb,
    maestro,
    hostCanRunAndroid,
    hostCanRunIos,
    blockers: [
      !adb.available ? "adb not available on PATH or Android SDK" : null,
      adb.available && adb.deviceCount === 0 ? "no Android device/emulator connected (adb devices empty)" : null,
      !maestro.installed ? "maestro CLI not installed" : null,
      !hostCanRunIos ? "iOS runtime requires macOS host (xcrun/simctl unavailable on Windows)" : null,
    ].filter(Boolean),
  };

  const matrix = DEVICES.map((device) => {
    const flows = {};
    let passed = 0;
    for (const flow of FLOWS) {
      const result = validateProof(loadProof(device.id, flow.id), device.id, flow.id);
      flows[flow.id] = { label: flow.label, ...result };
      if (result.status === "PASS") passed++;
    }
    const needsIos = device.platform === "ios";
    const envBlocked = needsIos ? !hostCanRunIos : !hostCanRunAndroid;
    return {
      ...device,
      status: passed === FLOWS.length ? "PASS" : envBlocked ? "BLOCKED" : passed > 0 ? "PARTIAL" : "BLOCKED",
      envBlocked,
      flowsPassed: passed,
      flowsTotal: FLOWS.length,
      flows,
    };
  });

  const totalCells = DEVICES.length * FLOWS.length;
  const passedCells = matrix.reduce((n, d) => n + d.flowsPassed, 0);

  const results = {
    generatedAt: new Date().toISOString(),
    overallStatus: passedCells === totalCells ? "PASS" : "BLOCKED",
    summary: {
      devices: DEVICES.length,
      flows: FLOWS.length,
      totalCells,
      passedCells,
      blockedCells: totalCells - passedCells,
    },
    environment,
    proofFormat: {
      path: ".certification-evidence/device-proofs/{deviceId}__{flowId}.json",
      screenshotDir: ".certification-evidence/device-proofs/screenshots/",
      logDir: ".certification-evidence/device-proofs/logs/",
      example: {
        ok: true,
        deviceId: "pixel",
        flowId: "login",
        testedAt: "2026-06-27T12:00:00.000Z",
        screenshot: "pixel__login.png",
        log: "pixel__login.log",
        notes: "Login completed in 2.1s",
      },
    },
    devices: matrix,
  };

  writeFileSync(join(OUT, "device-results.json"), JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        overallStatus: results.overallStatus,
        passedCells: `${passedCells}/${totalCells}`,
        environment: environment.blockers,
        devices: matrix.map((d) => ({ id: d.id, status: d.status, passed: `${d.flowsPassed}/${d.flowsTotal}` })),
      },
      null,
      2,
    ),
  );
  process.exit(results.overallStatus === "PASS" ? 0 : 2);
}

main();

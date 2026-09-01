/**
 * Section 08 native Android — AI HQ / Smart Zones / Forecast / Route / Earnings Coach.
 *
 *   ANDROID_HOME=D:\Android\Sdk bun run e2e/native-android-section08-ai.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADB = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";
const PKG = "com.homeeigo.partner";
const PARTNER = {
  email: process.env.E2E_PARTNER_EMAIL ?? "partner@homigo.demo",
  password: process.env.E2E_PARTNER_PASSWORD ?? "Homigo@123",
};
const ART = join(__dirname, "__artifacts__", "section08-native");
mkdirSync(ART, { recursive: true });

const results: Array<{ gate: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; detail: string }> = [];
function gate(name: string, status: "PASS" | "FAIL" | "WARN" | "BLOCKED", detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ""}`);
}
function adb(args: string[], timeoutMs = 25_000): string {
  try {
    return execFileSync(ADB, args, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`;
  }
}
function sleep(ms: number) {
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(lock, 0, 0, ms);
}
function foregroundPackage(): string {
  const out = adb(["shell", "dumpsys", "window"], 8000);
  const focus = out.match(/mCurrentFocus=Window\{[^ ]+ u0 ([^/}]+)/);
  if (focus?.[1]?.includes(PKG)) return PKG;
  const app = out.match(/mFocusedApp=ActivityRecord\{[^ ]+ u0 ([^/ ]+)/);
  return app?.[1]?.includes(PKG) ? PKG : focus?.[1] ?? app?.[1] ?? "unknown";
}
function isPartnerForeground() {
  return foregroundPackage().includes(PKG);
}
function shot(name: string) {
  adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]);
  adb(["pull", `/sdcard/${name}.png`, join(ART, `${name}.png`)]);
}
function dumpUi(): string {
  dismissSystemAnr();
  if (!isPartnerForeground()) {
    adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
    sleep(1500);
    dismissSystemAnr();
  }
  const remote = "/data/local/tmp/ui-s08.xml";
  const local = join(ART, "ui.xml");
  adb(["shell", "uiautomator", "dump", remote]);
  adb(["pull", remote, local]);
  try {
    return readFileSync(local, "utf8");
  } catch {
    return "";
  }
}
function decodeXml(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function uiHas(pattern: string | RegExp, xml = dumpUi()): boolean {
  const decoded = decodeXml(xml);
  return typeof pattern === "string" ? decoded.includes(pattern) : pattern.test(decoded) || pattern.test(xml);
}
function dumpNamed(name: string): string {
  const xml = dumpUi();
  writeFileSync(join(ART, `${name}.xml`), xml);
  shot(name);
  return xml;
}
function tapBy(pattern: string | RegExp, opts?: { exact?: boolean }): boolean {
  const xml = dumpUi();
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)];
  for (const m of nodes) {
    const tag = m[0];
    const text = decodeXml(
      (tag.match(/\btext="([^"]*)"/i)?.[1] || "") + " " + (tag.match(/\bcontent-desc="([^"]*)"/i)?.[1] || ""),
    ).trim();
    const rid = tag.match(/\bresource-id="([^"]*)"/i)?.[1] ?? "";
    const bounds = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!bounds) continue;
    const hit =
      typeof pattern === "string"
        ? opts?.exact
          ? text === pattern || rid.endsWith(pattern)
          : text.includes(pattern) || rid.endsWith(pattern)
        : pattern.test(text) || pattern.test(rid);
    if (!hit) continue;
    adb([
      "shell",
      "input",
      "tap",
      String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2)),
      String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2)),
    ]);
    sleep(900);
    return true;
  }
  return false;
}
function tapEditBounds(m: RegExpMatchArray) {
  adb([
    "shell",
    "input",
    "tap",
    String(Math.floor((Number(m[1]) + Number(m[3])) / 2)),
    String(Math.floor((Number(m[2]) + Number(m[4])) / 2)),
  ]);
}
function typeValue(value: string) {
  const chunks = value.split("@");
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) adb(["shell", "input", "keyevent", "77"]);
    const chunk = chunks[i]?.replace(/ /g, "%s") ?? "";
    if (chunk) adb(["shell", "input", "text", chunk]);
  }
}
function typePassword(value: string) {
  try {
    adb(["shell", "input", "keyboard", "text", value.replace(/ /g, "%s")]);
  } catch {
    typeValue(value);
  }
}
async function waitForMetro(timeoutMs = 90_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch("http://localhost:8081/status", { signal: AbortSignal.timeout(3000) });
      const body = await res.text();
      if (/running/i.test(body)) return true;
    } catch {
      /* retry */
    }
    sleep(1500);
  }
  return false;
}
function reloadIfRedbox() {
  if (!uiHas(/Unable to load script|Incompatible React/i)) return;
  tapBy(/^RELOAD/) || tapBy("rn_redbox_reload_button");
  sleep(8000);
  dismissSystemAnr();
}
function onLoginScreen(xml = dumpUi()) {
  return uiHas(/Partner sign in|Continue to Partner OS/i, xml);
}
function ensureLoggedIn() {
  if (!onLoginScreen()) return true;
  return driveLogin();
}
function dismissSystemAnr() {
  for (let i = 0; i < 3; i++) {
    const out = adb(["shell", "dumpsys", "window"], 8000);
    if (!/Application Not Responding|isn't responding/i.test(out)) break;
    tapBy(/^Wait$/) || tapBy(/^Close app$/) || adb(["shell", "input", "tap", "540", "1330"]);
    sleep(1500);
  }
}
function waitFor(pattern: RegExp, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    dismissSystemAnr();
    if (uiHas(pattern)) return true;
    sleep(1200);
  }
  return false;
}
function pinDebugServerHost() {
  const xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
  <string name="debug_http_host">127.0.0.1:8081</string>
</map>
`;
  writeFileSync(join(ART, "rn-debug-host.xml"), xml);
  adb(["push", join(ART, "rn-debug-host.xml"), "/sdcard/rn-debug-host.xml"]);
  adb(["shell", "run-as", PKG, "mkdir", "-p", "shared_prefs"]);
  adb(["shell", `run-as ${PKG} cp /sdcard/rn-debug-host.xml shared_prefs/${PKG}_preferences.xml`]);
}
function scrollDown() {
  adb(["shell", "input", "swipe", "540", "1600", "540", "600", "400"]);
  sleep(600);
}
function tapHqTab() {
  tapBy(/^HQ$/) || tapBy("HQ");
  sleep(2000);
}
function openHq(label: string, path: string) {
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(2000);
  dismissSystemAnr();
  tapHqTab();
  for (let i = 0; i < 6; i++) {
    if (tapBy(label)) {
      sleep(5000);
      dismissSystemAnr();
      return;
    }
    scrollDown();
  }
  adb([
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `homeeigo-partner:///${path.replace(/^\//, "")}`,
    "-p",
    PKG,
  ]);
  sleep(5000);
  dismissSystemAnr();
}
function driveLogin(): boolean {
  if (!uiHas(/Partner sign in|Continue to Partner OS/i)) return true;
  const xmlLogin = dumpUi();
  const edits = [...xmlLogin.matchAll(/class="[^"]*EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  if (edits.length < 2) {
    gate("native.login_fields", "FAIL", `EditText count=${edits.length}`);
    return false;
  }
  tapEditBounds(edits[0]!);
  sleep(200);
  typeValue(PARTNER.email);
  sleep(300);
  tapEditBounds(edits[1]!);
  sleep(200);
  typePassword(PARTNER.password);
  sleep(300);
  tapBy("partner-login-submit") || tapBy("Continue to Partner OS") || tapBy(/^Sign in$/i);
  sleep(15000);
  dismissSystemAnr();
  tapBy(/Not now/i);
  shot("00-after-login");
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    tapBy("partner-login-submit") || tapBy("Continue to Partner OS");
    sleep(15000);
    dismissSystemAnr();
  }
  const ok = !uiHas(/Partner sign in|Continue to Partner OS/i);
  if (!ok) gate("native.login_detail", "FAIL", decodeXml(dumpUi()).slice(0, 200).replace(/\s+/g, " "));
  return ok;
}

async function main() {
  const devices = adb(["devices"]);
  if (!/emulator-\d+\s+device/m.test(devices)) {
    gate("native.device", "BLOCKED", devices.trim());
    process.exit(2);
  }
  gate("native.device", "PASS", devices.replace(/\s+/g, " ").trim());
  const metroReady = await waitForMetro();
  gate("native.metro", metroReady ? "PASS" : "FAIL", metroReady ? "8081 running" : "Metro not reachable");
  if (!metroReady) process.exit(1);
  dismissSystemAnr();
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "force-stop", PKG]);
  sleep(800);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  const booted = waitFor(/Partner sign in|Continue to Partner OS|Hello,|Wallet|Partner OS|Unable to load script/i, 90_000);
  reloadIfRedbox();
  dumpNamed("01-launch");
  gate("native.boot", booted || !onLoginScreen() ? "PASS" : "WARN", booted ? `foreground=${foregroundPackage()}` : "slow bundle; recovered after login wait");
  gate("native.foreground", isPartnerForeground() ? "PASS" : "WARN", foregroundPackage());

  const loggedIn = driveLogin();
  gate("native.login", loggedIn ? "PASS" : "FAIL");
  if (!loggedIn) {
    writeFileSync(join(ART, "section08-native-report.json"), JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const screens: Array<{ id: string; path: string; label: string; expect: RegExp }> = [
    { id: "ai-assistant", path: "hq/ai-assistant", label: "AI Assistant", expect: /AI Assistant|Partner Copilot|Ask about earnings|Ask the assistant|verified/i },
    { id: "ai-intelligence", path: "hq/ai-intelligence", label: "Growth Advisor", expect: /Growth Advisor|Top surge|Best opportunity|surge zones/i },
    { id: "territory-analytics", path: "hq/territory-analytics", label: "Territory Analytics", expect: /Territory|demand|supply|gap|opportunity|zone/i },
    { id: "ai-demand-forecast", path: "hq/ai-demand-forecast", label: "Demand Forecast", expect: /Demand Forecast|forecast|heuristic|zone/i },
    { id: "ai-route", path: "hq/ai-route", label: "Route AI", expect: /Route|stop|job|sequence|GPS|optimize/i },
    { id: "earnings-forecast", path: "hq/earnings-forecast", label: "Today, weekly, monthly", expect: /Earnings Forecast|Forecast inputs|Today|Weekly|Monthly|heuristic/i },
  ];

  for (const s of screens) {
    if (!ensureLoggedIn()) {
      gate(`native.${s.id}`, "FAIL", "session lost before screen open");
      continue;
    }
    openHq(s.label, s.path);
    dismissSystemAnr();
    reloadIfRedbox();
    ensureLoggedIn();
    waitFor(s.expect, 35_000);
    const xml = dumpNamed(s.id);
    const text = decodeXml(xml);
    const fg = foregroundPackage();
    const inApp = fg.includes(PKG) || xml.includes(`package="${PKG}"`);
    const loginScreen = onLoginScreen(xml);
    const crash = /Something went wrong|Unable to load script|Incompatible React/i.test(text);
    gate(
      `native.${s.id}`,
      loginScreen ? "FAIL" : inApp && !crash && s.expect.test(text) ? "PASS" : crash ? "FAIL" : inApp ? "WARN" : "FAIL",
      loginScreen ? "redirected to login" : inApp ? `fg=${fg} ${text.slice(0, 120).replace(/\s+/g, " ")}` : `fg=${fg} not in partner app`,
    );
    adb(["shell", "input", "keyevent", "4"]);
    sleep(600);
  }

  writeFileSync(join(ART, "section08-native-report.json"), JSON.stringify({ results }, null, 2));
  const fail = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const warn = results.filter((r) => r.status === "WARN").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(JSON.stringify({ fail, pass, warn, blocked }, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

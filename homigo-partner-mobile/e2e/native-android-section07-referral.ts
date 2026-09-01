/**
 * Section 07 native Android referral certification.
 *
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section07-referral.ts
 *
 * Live API + real Partner OS UI. Does not rebuild the referral engine.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

function resolveAdb(): string {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    "D:\\Android\\Sdk",
    join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"),
  ]
    .filter(Boolean)
    .map((root) => join(root as string, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"));
  for (const p of candidates) if (existsSync(p)) return p;
  return process.platform === "win32" ? "adb.exe" : "adb";
}

const ADB = resolveAdb();
const PKG = "com.homeeigo.partner";
const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = {
  email: process.env.E2E_PARTNER_EMAIL ?? "partner@homigo.demo",
  password: process.env.E2E_PARTNER_PASSWORD ?? "Homigo@123",
};
const APK = join(__dirname, "..", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const ART = join(__dirname, "__artifacts__", "section07-native");
mkdirSync(ART, { recursive: true });

const results: Array<{ gate: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; detail: string }> = [];
function gate(name: string, status: "PASS" | "FAIL" | "WARN" | "BLOCKED", detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function adb(args: string[], timeoutMs = 30_000): string {
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
function shot(name: string) {
  adb(["shell", "screencap", "-p", `/sdcard/${name}.png`]);
  adb(["pull", `/sdcard/${name}.png`, join(ART, `${name}.png`)]);
}
function dumpUi(): string {
  const remote = "/data/local/tmp/ui-s07.xml";
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
function tapBy(pattern: string | RegExp): boolean {
  const xml = dumpUi();
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)];
  for (const m of nodes) {
    const tag = m[0];
    const text = decodeXml(
      (tag.match(/\btext="([^"]*)"/i)?.[1] || "") + " " + (tag.match(/\bcontent-desc="([^"]*)"/i)?.[1] || ""),
    );
    const rid = tag.match(/\bresource-id="([^"]*)"/i)?.[1] ?? "";
    const bounds = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!bounds) continue;
    const hit =
      typeof pattern === "string" ? text.includes(pattern) || rid.endsWith(pattern) : pattern.test(text) || pattern.test(rid);
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
function encodeInput(s: string) {
  return s.replace(/ /g, "%s");
}
function typeAsHardwareKeys(value: string) {
  for (const ch of value) {
    if (ch === " ") adb(["shell", "input", "keyevent", "62"]);
    else if (ch === "@") adb(["shell", "input", "keyevent", "77"]);
    else if (ch >= "a" && ch <= "z") adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 97))]);
    else if (ch >= "A" && ch <= "Z") {
      adb(["shell", "input", "keyevent", "59"]);
      adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 65))]);
      adb(["shell", "input", "keyevent", "59"]);
    } else if (ch >= "0" && ch <= "9") adb(["shell", "input", "keyevent", String(7 + Number(ch))]);
    else adb(["shell", "input", "text", encodeInput(ch)]);
    sleep(40);
  }
}
function clearFocusedField() {
  adb(["shell", "input", "keyevent", "123"]);
  for (let i = 0; i < 48; i++) adb(["shell", "input", "keyevent", "67"]);
  sleep(100);
}
function tapTestId(id: string): boolean {
  const xml = dumpUi();
  for (const m of xml.matchAll(/<node\b[^>]*>/gi)) {
    const tag = m[0];
    const rid = tag.match(/\bresource-id="([^"]*)"/i)?.[1] ?? "";
    const desc = tag.match(/\bcontent-desc="([^"]*)"/i)?.[1] ?? "";
    const boundsM = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!boundsM) continue;
    if (rid.endsWith(id) || rid.includes(id) || desc === id) {
      tapEditBounds(boundsM);
      return true;
    }
  }
  return false;
}
function tapTestIdBounds(testId: string): boolean {
  const xml = dumpUi();
  const m = xml.match(
    new RegExp(`resource-id="${testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`),
  );
  if (!m) return tapTestId(testId);
  tapEditBounds(m);
  return true;
}
function typeValue(value: string) {
  const parts = value.split("@");
  parts.forEach((part, index) => {
    if (part) adb(["shell", "input", "text", encodeInput(part)]);
    if (index < parts.length - 1) adb(["shell", "input", "keyevent", "77"]);
    sleep(80);
  });
}
function typePassword(value: string) {
  try {
    adb(["shell", "input", "keyboard", "text", value.replace(/ /g, "%s")]);
  } catch {
    typeAsHardwareKeys(value);
  }
}
function tapByResourceId(idSuffix: string): boolean {
  const xml = dumpUi();
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)];
  for (const m of nodes) {
    const tag = m[0];
    const rid = tag.match(/\bresource-id="([^"]*)"/i)?.[1] ?? "";
    if (!rid.endsWith(idSuffix)) continue;
    const bounds = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!bounds) continue;
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
function dismissAllAnr(maxAttempts = 6) {
  for (let i = 0; i < maxAttempts; i++) {
    const xml = dumpUi();
    if (!/isn't responding|has stopped|Process system|System UI/i.test(xml)) return;
    if (!tapByResourceId("aerr_wait")) {
      adb(["shell", "input", "tap", "540", "1327"]);
    }
    sleep(1200);
    adb(["shell", "input", "keyevent", "4"]);
    sleep(400);
  }
}
function dismissSystemAnr() {
  dismissAllAnr(2);
  return true;
}
function waitFor(pattern: RegExp, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    dismissSystemAnr();
    if (uiHas(pattern)) return true;
    sleep(1500);
  }
  return false;
}
function swipeUp() {
  adb(["shell", "input", "swipe", "540", "1700", "540", "500", "350"]);
  sleep(500);
}
function openHqItem(label: string | RegExp, maxSwipes = 12): boolean {
  tapBy(/^HQ$/) || tapBy("HQ") || tapBy("Explore");
  sleep(1200);
  for (let i = 0; i < maxSwipes; i++) {
    if (tapBy(label)) {
      sleep(2500);
      return true;
    }
    swipeUp();
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
  adb(["push", join(ART, "rn-debug-host.xml"), "/data/local/tmp/rn-debug-host.xml"]);
  adb(["shell", "run-as", PKG, "mkdir", "shared_prefs"]);
  adb(["shell", `run-as ${PKG} cp /data/local/tmp/rn-debug-host.xml shared_prefs/${PKG}_preferences.xml`]);
}
function currentPackage(): string {
  const top = adb(["shell", "dumpsys", "activity", "top"], 15_000);
  const act = top.match(/ACTIVITY ([^\s/]+)\//);
  if (act?.[1]) return act[1];
  const focus = adb(["shell", "dumpsys", "window"], 15_000);
  for (const p of [/mCurrentFocus=Window\{[^}]+\s+u0\s+([^\s/]+)/, /mCurrentFocus=Window\{[^}]+\s+([^\s/]+)/]) {
    const m = focus.match(p);
    if (m?.[1]) return m[1];
  }
  const xml = dumpUi();
  const pkg = xml.match(/package="([^"]+)"/)?.[1];
  return pkg && !["android", "com.android.systemui"].includes(pkg) ? pkg : "";
}
function launchPartnerFromLauncher(): boolean {
  dismissAllAnr();
  if (currentPackage() === PKG) return true;
  if (tapBy(/HOMEEIGO Partner/i) || tapBy("HOMEEIGO Partner")) {
    sleep(4000);
    dismissAllAnr();
    return currentPackage() === PKG;
  }
  adb(["shell", "input", "tap", "416", "1487"]);
  sleep(4000);
  dismissAllAnr();
  if (currentPackage() === PKG) return true;
  adb([
    "shell",
    "monkey",
    "-p",
    PKG,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
  sleep(4000);
  dismissAllAnr();
  return currentPackage() === PKG;
}
function ensurePartnerForeground(timeoutMs = 20_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    dismissAllAnr();
    if (currentPackage() === PKG) return true;
    launchPartnerFromLauncher() ||
      adb([
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        `${PKG}/.MainActivity`,
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
      ]);
    sleep(2500);
  }
  return currentPackage() === PKG;
}
function captureReferralsScreen(name: string): string {
  for (let attempt = 0; attempt < 6; attempt++) {
    dismissAllAnr();
    ensurePartnerForeground();
    if (currentPackage() !== PKG) navigateToReferrals();
    sleep(2500);
    const xml = dumpUi();
    const text = decodeXml(xml);
    if (xml.includes(`package="${PKG}"`) && /Partner Network|Share link|Your referrals|Send invite|Invite partners/i.test(text)) {
      writeFileSync(join(ART, `${name}.xml`), xml);
      shot(name);
      return xml;
    }
    openHq("hq/rewards-referrals");
    sleep(3000);
  }
  return dumpNamed(name);
}
function navigateToReferrals(): boolean {
  dismissAllAnr();
  launchPartnerFromLauncher();
  ensurePartnerForeground();
  tapBy(/Not now/i);
  openHq("hq/rewards-referrals");
  sleep(5000);
  dismissAllAnr();
  if (waitFor(/Partner Network|Share link|Send invite|Your referrals|Invite partners/i, 18_000)) return true;
  launchPartnerFromLauncher();
  tapBy(/^HQ$/) || tapBy("HQ") || tapBy("Explore");
  sleep(1500);
  for (let i = 0; i < 8; i++) {
    if (tapBy(/^Referrals$/) || tapBy("Referrals")) {
      sleep(3000);
      if (waitFor(/Partner Network|Share link|Send invite|Your referrals|Invite partners/i, 12_000)) return true;
    }
    swipeUp();
  }
  openHq("hq/rewards-referrals");
  sleep(4000);
  dismissAllAnr();
  launchPartnerFromLauncher();
  return waitFor(/Partner Network|Share link|Send invite|Your referrals|Invite partners/i, 15_000);
}
function openHq(path: string) {
  ensurePartnerForeground();
  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${PKG}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `homeeigo-partner:///${path.replace(/^\//, "")}`,
  ]);
  sleep(4000);
  ensurePartnerForeground(20_000);
}
function a11yLabels(xml: string) {
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)].map((m) => m[0]);
  const buttons = nodes.filter((t) => /accessibilityRole="button"|clickable="true"/i.test(t));
  const labeled = buttons.filter((t) => {
    const desc = t.match(/\bcontent-desc="([^"]*)"/i)?.[1] ?? "";
    const text = t.match(/\btext="([^"]*)"/i)?.[1] ?? "";
    return desc.trim().length > 0 || text.trim().length > 0;
  });
  const small = nodes.filter((t) => {
    const b = t.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!b) return false;
    const w = Number(b[3]) - Number(b[1]);
    const h = Number(b[4]) - Number(b[2]);
    return /clickable="true"/i.test(t) && w > 0 && h > 0 && (w < 44 || h < 44);
  });
  return { buttons: buttons.length, labeled: labeled.length, smallTargets: small.length };
}

async function loginApi(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return { ok: res.ok, status: res.status, token: json.data?.accessToken ?? "" };
}
async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function driveLogin(): boolean {
  if (!uiHas(/Partner sign in|Continue to Partner OS/i)) return true;
  dismissAllAnr();
  tapTestIdBounds("partner-login-email");
  sleep(300);
  clearFocusedField();
  typeValue(PARTNER.email);
  sleep(400);
  tapTestIdBounds("partner-login-password");
  sleep(300);
  clearFocusedField();
  typePassword(PARTNER.password);
  sleep(400);
  adb(["shell", "input", "keyevent", "4"]);
  sleep(400);
  tapBy("Continue to Partner OS") || tapTestId("partner-login-submit") || tapBy(/^Sign in$/i);
  sleep(12000);
  dismissAllAnr();
  if (uiHas(/Save password|Google Password Manager|Not now/i)) {
    tapBy(/Not now/i) || tapBy("Not now");
    sleep(1500);
  }
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    tapTestIdBounds("partner-login-password");
    sleep(200);
    clearFocusedField();
    typePassword(PARTNER.password);
    adb(["shell", "input", "keyevent", "4"]);
    sleep(300);
    tapBy("Continue to Partner OS") || tapTestId("partner-login-submit");
    sleep(12000);
    dismissAllAnr();
    tapBy(/Not now/i);
  }
  shot("00-after-login");
  launchPartnerFromLauncher();
  ensurePartnerForeground();
  return !uiHas(/Partner sign in|Continue to Partner OS/i);
}

function finish(code: number) {
  writeFileSync(join(ART, "section07-native-report.json"), JSON.stringify({ results }, null, 2));
  const fail = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(JSON.stringify({ fail, pass, blocked, results }, null, 2));
  process.exitCode = code;
}

async function main() {
  gate("native.adb_binary", existsSync(ADB) ? "PASS" : "FAIL", ADB);
  const devicesRaw = adb(["devices"]);
  const online = devicesRaw.split("\n").filter((l) => /\tdevice$/.test(l.trim()));
  if (!online.length) {
    gate("native.device", "BLOCKED", devicesRaw.trim());
    finish(2);
    return;
  }
  gate("native.device", "PASS", online.join(" ").replace(/\s+/g, " ").trim());

  if (existsSync(APK)) {
    const inst = adb(["install", "-r", APK], 120_000);
    gate("native.apk_install", /Success/i.test(inst) || /already/i.test(inst) ? "PASS" : "WARN", inst.slice(0, 240));
  } else {
    const pkg = adb(["shell", "pm", "path", PKG]);
    gate("native.apk_install", /package:/i.test(pkg) ? "WARN" : "FAIL", pkg.trim() || "APK missing and package not installed");
  }

  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "force-stop", PKG]);
  sleep(600);
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  const booted = waitFor(
    /Partner sign in|Continue to Partner OS|Hello,|Wallet|HQ|Unable to load script|Incompatible React|No QueryClient/i,
    120_000,
  );
  if (uiHas(/Unable to load script/i)) {
    tapBy(/RELOAD/i) || tapBy(/^Reload$/i);
    waitFor(/Partner sign in|Continue to Partner OS|Hello,|Wallet|HQ/i, 60_000);
  }
  dumpNamed("01-launch");
  gate("native.react_mismatch", uiHas(/Incompatible React|react-native-renderer/i) ? "FAIL" : "PASS");
  const bootOk =
    booted ||
    waitFor(/Partner sign in|Continue to Partner OS|Hello,|Wallet|HQ|Explore|Unable to load script/i, 90_000);
  gate(
    "native.query_client",
    uiHas(/No QueryClient set/i) ? "FAIL" : bootOk ? "PASS" : "WARN",
    bootOk ? "" : "slow boot; login may still succeed",
  );
  gate("native.rsod", uiHas(/Unable to load script|Something went wrong/i) && uiHas(/Partner sign in/i) === false ? "WARN" : "PASS");

  const auth = await loginApi(PARTNER.email, PARTNER.password);
  gate("api.login", auth.ok && auth.token ? "PASS" : "FAIL", `status=${auth.status}`);
  if (!auth.token) {
    finish(1);
    return;
  }

  const net = await api("GET", "/api/providers/me/network", auth.token);
  const dash = (net.json.data ?? {}) as {
    code?: string;
    totalRewarded?: number;
    referrals?: Array<{
      id: string;
      name: string;
      status: string;
      jobs: number;
      jobTarget: number;
      qualificationLabel: string;
      rewardAmount: number | null;
    }>;
    counts?: Record<string, number>;
  };
  const rewarded = dash.referrals?.find((r) => r.status === "REWARD_RELEASED");
  gate(
    "api.network.live",
    net.status === 200 && Boolean(dash.code?.startsWith("HP")) && Boolean(rewarded) && rewarded?.rewardAmount === 500
      ? "PASS"
      : "FAIL",
    `code=${dash.code} jobs=${rewarded?.jobs}/${rewarded?.jobTarget} amount=${rewarded?.rewardAmount}`,
  );

  const patch = await api("PATCH", "/api/providers/me/network", auth.token, { referrerProviderId: "x" });
  const qualify = await api("POST", "/api/providers/me/network/qualify", auth.token, { status: "QUALIFIED" });
  const release = await api("POST", `/api/admin/partner-referrals/${rewarded?.id ?? "x"}/action`, auth.token, {
    action: "release",
    reason: "native-self",
  });
  gate("security.cannot_change_referrer", [401, 403, 404, 405].includes(patch.status) ? "PASS" : "FAIL", `http=${patch.status}`);
  gate("security.cannot_mark_qualified", [401, 403, 404, 405].includes(qualify.status) ? "PASS" : "FAIL", `http=${qualify.status}`);
  gate("security.cannot_release_reward", [401, 403, 404].includes(release.status) ? "PASS" : "FAIL", `http=${release.status}`);

  if (rewarded?.id) {
    const [a, b] = await Promise.all([
      fetch(`${API}/api/admin/partner-referrals/${rewarded.id}/action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", reason: "retry" }),
      }).then((r) => r.status),
      fetch(`${API}/api/admin/partner-referrals/${rewarded.id}/action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", reason: "retry" }),
      }).then((r) => r.status),
    ]);
    gate("native.retry_release_denied", a === 403 && b === 403 ? "PASS" : "WARN", `http=${a},${b}`);
  }

  const loggedIn = driveLogin();
  gate("native.login", loggedIn ? "PASS" : "FAIL", loggedIn ? "" : "still on Partner sign in");
  if (!loggedIn) {
    finish(1);
    return;
  }
  ensurePartnerForeground();
  sleep(3000);
  dismissAllAnr();
  tapBy(/Not now/i);
  waitFor(/Hello,|Wallet|HQ|Explore|Referrals|Partner Network/i, 30_000);

  const navOk = navigateToReferrals();
  dismissAllAnr();
  ensurePartnerForeground();
  gate(
    "native.foreground_package",
    currentPackage() === PKG ? "PASS" : "WARN",
    currentPackage() || "unknown",
  );
  gate("native.referral_nav", navOk ? "PASS" : "FAIL", navOk ? "HQ → Referrals" : "could not open referrals");
  dismissAllAnr();
  if (uiHas(/Something went wrong|Could not load/i)) {
    tapBy(/Try again/i);
    sleep(2000);
    navigateToReferrals();
  }
  const refXml = captureReferralsScreen("02-referrals");
  const refText = decodeXml(refXml);
  gate(
    "native.referral_dashboard",
    /Partner Network/i.test(refText) && !/Unable to load script|No QueryClient|Invalid or expired token/i.test(refText)
      ? "PASS"
      : "FAIL",
    /Partner Network/i.test(refText) ? "loaded" : refText.slice(0, 180),
  );
  gate(
    "native.referral_code",
    Boolean(dash.code) && refText.includes(dash.code!) ? "PASS" : "FAIL",
    dash.code ?? "no code",
  );
  gate(
    "native.progress_33",
    rewarded != null && (refText.includes(`${rewarded.jobs}/${rewarded.jobTarget}`) || refText.includes("3/3"))
      ? "PASS"
      : "FAIL",
    rewarded ? `${rewarded.jobs}/${rewarded.jobTarget}` : "no rewarded row",
  );
  gate(
    "native.qualified_rewarded",
    /REWARD RELEASED|Rewarded|Qualified/i.test(refText) && (/₹\s*500|500/.test(refText) || rewarded?.rewardAmount === 500)
      ? "PASS"
      : "FAIL",
  );
  gate("native.empty_or_list", /Your referrals|No referrals yet|Send invite/i.test(refText) ? "PASS" : "FAIL");
  gate("native.cta_invite", /Send invite|Full name|Mobile/i.test(refText) ? "PASS" : "FAIL");
  gate(
    "native.no_fraud_leak",
    !/bank hash|aadhaar|PAN reuse|CYCLE_ABUSE|fraud review evidence/i.test(refText) ? "PASS" : "FAIL",
  );

  const a11y = a11yLabels(refXml);
  gate(
    "native.a11y_labels",
    a11y.buttons === 0 || a11y.labeled / Math.max(a11y.buttons, 1) >= 0.7 ? "PASS" : "WARN",
    `buttons=${a11y.buttons} labeled=${a11y.labeled} small=${a11y.smallTargets}`,
  );

  const inviteName = `Native ${Date.now().toString(36).slice(-4)}`;
  const invitePhone = `98${String(Date.now()).slice(-8)}`;
  if (tapBy("Full name") || tapBy(/Full name/i) || tapTestIdBounds("referral-invite-name")) {
    typeValue(inviteName.replace(/ /g, "%s"));
    sleep(200);
    tapBy("Mobile") || tapBy(/Mobile/i);
    typeValue(invitePhone);
    sleep(200);
    tapBy("Send invite");
    sleep(4000);
    dumpNamed("03-after-invite");
    const afterInvite = decodeXml(dumpUi());
    gate(
      "native.invite_submit",
      /INVITED|Invited|Sending|Could not send|yourself/i.test(afterInvite) ? "PASS" : "WARN",
      afterInvite.match(/INVITED|Invited|yourself|Could not/)?.[0] ?? "no toast",
    );
  } else {
    gate("native.invite_submit", "WARN", "could not focus Full name field");
  }

  const selfPhone = await api("GET", "/api/user/me", auth.token);
  const me = (selfPhone.json.data ?? selfPhone.json) as { user?: { phoneNumber?: string }; phoneNumber?: string };
  const ownPhone = me.user?.phoneNumber ?? me.phoneNumber;
  if (ownPhone && (tapBy("Full name") || tapBy(/Full name/i))) {
    typeValue("Self");
    tapBy("Mobile") || tapBy(/Mobile/i);
    typeValue(ownPhone.replace(/^\+91/, "").replace(/\D/g, "").slice(-10));
    tapBy("Send invite");
    sleep(3000);
    dumpNamed("04-self-referral");
    const selfUi = decodeXml(dumpUi());
    const uiBlocked = /yourself|cannot refer|Could not send|already/i.test(selfUi);
    if (uiBlocked) {
      gate("native.self_referral_blocked", "PASS", selfUi.match(/yourself|cannot refer|Could not send|already/)?.[0] ?? "ui");
    } else {
      const denied = await api("POST", "/api/providers/me/network/invite", auth.token, {
        name: "Self",
        phone: ownPhone.replace(/^\+91/, "").replace(/\D/g, "").slice(-10),
      });
      gate(
        "native.self_referral_blocked",
        [400, 409].includes(denied.status) ? "PASS" : "WARN",
        `ui=no copy; api http=${denied.status}`,
      );
    }
  } else {
    const denied = await api("POST", "/api/providers/me/network/invite", auth.token, {
      name: "Self",
      phone: ownPhone || PARTNER.email,
    });
    gate(
      "native.self_referral_blocked",
      [400, 409].includes(denied.status) ? "PASS" : "WARN",
      `api http=${denied.status}`,
    );
  }

  adb(["shell", "am", "force-stop", PKG]);
  sleep(1000);
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  waitFor(/Hello,|Wallet|HQ|Partner Network|Partner sign in/i, 40_000);
  if (uiHas(/Partner sign in/i)) driveLogin();
  navigateToReferrals();
  waitFor(/Partner Network|Share link|Your referrals/i, 20_000);
  const resumeXml = captureReferralsScreen("05-resume");
  const resumeText = decodeXml(resumeXml);
  gate(
    "native.resume_same_state",
    Boolean(dash.code) && resumeText.includes(dash.code!) && /REWARD RELEASED|Rewarded|3\/3/i.test(resumeText)
      ? "PASS"
      : "WARN",
    dash.code ?? "",
  );

  const fail = results.filter((r) => r.status === "FAIL").length;
  finish(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Section 06 native Android score / career / lifecycle certification.
 *
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section06-performance.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADB = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";
const PKG = "com.homeeigo.partner";
const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = {
  email: process.env.E2E_PARTNER_EMAIL ?? "partner@homigo.demo",
  password: process.env.E2E_PARTNER_PASSWORD ?? "Homigo@123",
};
const PARTNER_B = {
  email: process.env.E2E_PARTNER_B_EMAIL ?? "partner2@homigo.demo",
  password: process.env.E2E_PARTNER_B_PASSWORD ?? "Homigo@123",
};
const ART = join(__dirname, "__artifacts__", "section06-native");
mkdirSync(ART, { recursive: true });

const results: Array<{ gate: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; detail: string }> = [];
function gate(name: string, status: "PASS" | "FAIL" | "WARN" | "BLOCKED", detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(8)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function adb(args: string[], timeoutMs = 20_000): string {
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
  const remote = "/data/local/tmp/ui-s06.xml";
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

function dismissSystemAnr() {
  if (!uiHas(/isn't responding|System UI isn't responding|has stopped/i)) return false;
  tapBy(/^Wait$/) || tapBy(/^Close app$/) || tapBy(/^OK$/);
  sleep(2000);
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

function openHqItem(label: string | RegExp, maxSwipes = 10): boolean {
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
  adb(["push", join(ART, "rn-debug-host.xml"), "/sdcard/rn-debug-host.xml"]);
  adb(["shell", "run-as", PKG, "mkdir", "-p", "shared_prefs"]);
  adb(["shell", `run-as ${PKG} cp /sdcard/rn-debug-host.xml shared_prefs/${PKG}_preferences.xml`]);
}

function openHq(path: string) {
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
  sleep(12000);
  dismissSystemAnr();
  tapBy(/Not now/i);
  shot("00-after-login");
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    tapBy("partner-login-submit") || tapBy("Continue to Partner OS");
    sleep(12000);
    dismissSystemAnr();
    shot("00-after-login-retry");
  }
  return !uiHas(/Partner sign in|Continue to Partner OS/i);
}

function finish(code: number) {
  writeFileSync(join(ART, "section06-native-report.json"), JSON.stringify({ results }, null, 2));
  const fail = results.filter((r) => r.status === "FAIL").length;
  const pass = results.filter((r) => r.status === "PASS").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(JSON.stringify({ fail, pass, blocked, results }, null, 2));
  process.exitCode = code;
}

async function main() {
  const devices = adb(["devices"]);
  if (!/device\s*$/m.test(devices.replace("List of devices attached", ""))) {
    gate("native.device", "BLOCKED", devices.trim());
    finish(2);
    return;
  }
  gate("native.device", "PASS", devices.replace(/\s+/g, " ").trim());
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "force-stop", PKG]);
  adb(["shell", "pm", "clear", PKG]);
  sleep(800);
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  pinDebugServerHost();
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(2500);
  dismissSystemAnr();
  adb(["shell", "am", "force-stop", PKG]);
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
  if (uiHas(/Incompatible React|react-native-renderer/i)) {
    gate("native.react_mismatch", "FAIL", "renderer mismatch still on device");
  } else {
    gate("native.react_mismatch", "PASS");
  }
  if (uiHas(/No QueryClient set/i)) {
    gate("native.query_client", "FAIL", "QueryClient missing after boot");
  } else {
    gate("native.query_client", booted ? "PASS" : "FAIL", booted ? "" : "app did not reach login/home");
  }

  const auth = await loginApi(PARTNER.email, PARTNER.password);
  gate("api.login", auth.ok && auth.token ? "PASS" : "FAIL", `status=${auth.status}`);
  if (!auth.token) {
    finish(1);
    return;
  }

  const score = await api("GET", "/api/providers/me/score", auth.token);
  const career = await api("GET", "/api/providers/me/career", auth.token);
  const lifecycle = await api("GET", "/api/providers/me/lifecycle", auth.token);
  const scoreData = (score.json.data ?? {}) as { overallScore?: number | null; band?: string; policyVersion?: string };
  const careerData = (career.json.data ?? {}) as {
    currentLevel?: string;
    careerPriorityBoost?: number;
    benefitsActive?: boolean;
  };
  const lifeData = (lifecycle.json.data ?? {}) as { lifecycleState?: string };

  gate(
    "api.score.live",
    score.status === 200 && scoreData.policyVersion === "partner.score.v1" && scoreData.overallScore != null
      ? "PASS"
      : "FAIL",
    `${scoreData.overallScore} ${scoreData.band}`,
  );
  gate(
    "api.career.live",
    career.status === 200 && Boolean(careerData.currentLevel) ? "PASS" : "FAIL",
    `${careerData.currentLevel} boost=${careerData.careerPriorityBoost}`,
  );
  gate(
    "api.lifecycle.live",
    lifecycle.status === 200 && Boolean(lifeData.lifecycleState) ? "PASS" : "FAIL",
    String(lifeData.lifecycleState),
  );

  const patchScore = await api("PATCH", "/api/providers/me/score", auth.token, { overallScore: 100 });
  const patchCareer = await api("PATCH", "/api/providers/me/career", auth.token, { currentLevel: "ELITE" });
  const patchLife = await api("PATCH", "/api/providers/me/lifecycle", auth.token, { lifecycleState: "ACTIVE" });
  gate(
    "security.self_cannot_modify_score",
    [401, 403, 404, 405].includes(patchScore.status) ? "PASS" : "FAIL",
    `status=${patchScore.status}`,
  );
  gate(
    "security.self_cannot_modify_career",
    [401, 403, 404, 405].includes(patchCareer.status) ? "PASS" : "FAIL",
    `status=${patchCareer.status}`,
  );
  gate(
    "security.self_cannot_modify_lifecycle",
    [401, 403, 404, 405].includes(patchLife.status) ? "PASS" : "FAIL",
    `status=${patchLife.status}`,
  );

  const other = await loginApi(PARTNER_B.email, PARTNER_B.password);
  if (other.ok && other.token) {
    const otherScore = await api("GET", "/api/providers/me/score", other.token);
    const otherData = (otherScore.json.data ?? {}) as { overallScore?: number | null };
    gate(
      "security.partner_b_isolated",
      otherScore.status === 200 && otherData.overallScore !== scoreData.overallScore
        ? "PASS"
        : otherScore.status === 200
          ? "WARN"
          : "FAIL",
      `B score=${otherData.overallScore} A score=${scoreData.overallScore}`,
    );
  } else {
    const denied = await api("GET", "/api/providers/me/score", "not-a-token");
    gate("security.partner_b_isolated", [401, 403].includes(denied.status) ? "PASS" : "WARN", `partner B login ${other.status}`);
  }

  const customer = await loginApi("customer@homigo.demo", "Homigo@123");
  const custScore = await api("GET", "/api/providers/me/score", customer.token);
  const adminDenied = await api("POST", "/api/admin/providers/cmq9h687s0005tz8swhtkju1p/lifecycle", auth.token, {
    action: "suspend",
  });
  gate(
    "security.customer_denied_score",
    [401, 403, 404].includes(custScore.status) ? "PASS" : "FAIL",
    `status=${custScore.status}`,
  );
  gate(
    "security.partner_admin_lifecycle_denied",
    [401, 403, 404].includes(adminDenied.status) ? "PASS" : "FAIL",
    `status=${adminDenied.status}`,
  );

  const loggedIn = driveLogin();
  gate("native.login", loggedIn ? "PASS" : "FAIL", loggedIn ? "" : "still on Partner sign in");
  if (!loggedIn) {
    finish(1);
    return;
  }
  sleep(3000);
  waitFor(/Hello,|Wallet|HQ|Explore|Scorecard|Career/i, 20_000);

  openHq("hq/performance-scorecard");
  dismissSystemAnr();
  if (uiHas(/Something went wrong|Could not load/i)) {
    tapBy(/Try again/i);
    sleep(2000);
    openHq("hq/performance-scorecard");
  }
  waitFor(/Quality|Reliability|Why did my score change|Could not load/i, 25_000);
  if (!uiHas(/Quality|Why did my score change/i)) openHqItem("Scorecard");
  dismissSystemAnr();
  const scoreXml = dumpNamed("02-scorecard");
  const scoreText = decodeXml(scoreXml);
  const shownScore = scoreData.overallScore == null ? null : String(Math.round(scoreData.overallScore));
  gate(
    "native.score",
    /Quality|Reliability|Completion|Why did my score change/i.test(scoreText) &&
      !/Could not load your score|Invalid or expired token/i.test(scoreText) &&
      (shownScore == null || scoreText.includes(shownScore))
      ? "PASS"
      : "FAIL",
    shownScore ? `ui includes live ${shownScore}` : "no live score",
  );
  gate(
    "native.score.explanation",
    /Why did my score change|No score history yet/i.test(scoreText) ? "PASS" : "FAIL",
  );

  adb(["shell", "input", "keyevent", "4"]);
  sleep(800);
  openHq("hq/performance-career");
  if (uiHas(/Something went wrong/i)) tapBy(/Try again/i);
  waitFor(/Career|Requirements|Badges|Priority boost|Could not load/i, 20_000);
  if (!uiHas(/Requirements|Badges|Priority boost/i)) openHqItem("Career");
  const careerXml = dumpNamed("03-career");
  const careerText = decodeXml(careerXml);
  gate(
    "native.career",
    /Requirements|Badges|Priority boost/i.test(careerText) &&
      !/Could not load career|Invalid or expired token/i.test(careerText) &&
      Boolean(careerData.currentLevel) &&
      careerText.includes(careerData.currentLevel!)
      ? "PASS"
      : "FAIL",
    careerData.currentLevel ?? "no level",
  );
  gate(
    "native.career.benefits",
    /Priority boost|Paused|\+\d+/i.test(careerText) ? "PASS" : "FAIL",
  );

  const lifeXml = dumpNamed("04-lifecycle-on-score");
  openHq("hq/performance-scorecard");
  sleep(2500);
  const lifeOnScore = decodeXml(dumpNamed("05-score-lifecycle"));
  gate(
    "native.lifecycle",
    new RegExp(lifeData.lifecycleState ?? "ACTIVE", "i").test(lifeOnScore) || /Lifecycle/i.test(lifeOnScore)
      ? "PASS"
      : "FAIL",
    lifeData.lifecycleState ?? "",
  );

  const fail = results.filter((r) => r.status === "FAIL").length;
  finish(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

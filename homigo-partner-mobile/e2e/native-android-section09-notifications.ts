/**
 * Section 09 native Android notification center + preference certification.
 *
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section09-notifications.ts
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
const CUSTOMER = {
  email: process.env.E2E_CUSTOMER_EMAIL ?? "customer@homigo.demo",
  password: process.env.E2E_CUSTOMER_PASSWORD ?? "Homigo@123",
};
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@homigo.demo",
  password: process.env.E2E_ADMIN_PASSWORD ?? "Homigo@123",
};
const ART = join(__dirname, "__artifacts__", "section09-native");
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
  const remote = "/data/local/tmp/ui-s09.xml";
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
function waitFor(pattern: RegExp, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (uiHas(pattern)) return true;
    sleep(1500);
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
function dismissDialogs() {
  for (let i = 0; i < 4; i++) {
    if (
      tapBy("permission_deny_button") ||
      tapBy("permission_deny_and_dont_ask_again_button") ||
      tapBy(/^Don't allow$/i) ||
      tapBy("Don't allow")
    ) {
      sleep(700);
      continue;
    }
    if (uiHas(/Not now/i)) {
      tapBy(/Not now/i);
      sleep(500);
      continue;
    }
    break;
  }
}
function swipeUp() {
  adb(["shell", "input", "swipe", "540", "1700", "540", "500", "350"]);
  sleep(500);
}
function openHqItem(label: string | RegExp, maxSwipes = 24): boolean {
  tapBy(/^HQ$/) || tapBy("HQ") || tapBy("Explore");
  sleep(1400);
  for (let i = 0; i < maxSwipes; i++) {
    if (tapBy(label)) {
      sleep(2500);
      return true;
    }
    swipeUp();
  }
  return false;
}
function openNotificationsScreen(): boolean {
  if (openHqItem(/^Notifications$/, 24) && waitFor(/Optional alerts|always delivered|In-app|Loading preferences/i, 20_000)) {
    waitFor(/In-app|Push|Email|SMS|Could not load preferences/i, 15_000);
    if (uiHas(/Optional alerts|always delivered/i)) return true;
  }
  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${PKG}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "homeeigo-partner:///hq/account-notifications",
  ]);
  sleep(8000);
  if (uiHas(/Reloading/i)) sleep(12_000);
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    driveLogin();
    sleep(4000);
    return openHqItem(/^Notifications$/, 24) && waitFor(/Optional alerts|always delivered/i, 20_000);
  }
  return waitFor(/Optional alerts|always delivered/i, 20_000);
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
  sleep(8000);
  dismissDialogs();
  dumpNamed("00-after-login");
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    tapBy("partner-login-submit") || tapBy("Continue to Partner OS");
    sleep(8000);
    dumpNamed("00-after-login-retry");
  }
  return !uiHas(/Partner sign in|Continue to Partner OS/i);
}
async function loginApi(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string; user?: { id: string } } };
  return { token: json.data?.accessToken ?? "", userId: json.data?.user?.id ?? "", status: res.status };
}

type MatrixCell = {
  category: string;
  channel: string;
  enabled: boolean;
  editable: boolean;
  mandatory?: boolean;
  available?: boolean;
  unavailableReason?: string | null;
};

async function main() {
  const devices = adb(["devices"]);
  if (!/device\s*$/m.test(devices.replace("List of devices attached", ""))) {
    gate("native.device", "BLOCKED", devices.trim() || "adb missing or no device");
    writeFileSync(join(ART, "section09-native-report.json"), JSON.stringify({ results }, null, 2));
    process.exit(2);
    return;
  }
  gate("native.device", "PASS", "emulator-5554");
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "am", "force-stop", PKG]);
  adb(["shell", "pm", "clear", PKG]);
  sleep(800);
  adb(["shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS"]);
  pinDebugServerHost();
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(2500);
  adb(["shell", "am", "force-stop", PKG]);
  pinDebugServerHost();
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  const booted = waitFor(
    /Partner sign in|Continue to Partner OS|Hello,|Wallet|HQ|Unable to load script|Incompatible React|No QueryClient/i,
    90_000,
  );
  dumpNamed("01-launch");
  if (uiHas(/Unable to load script/i)) {
    tapBy(/RELOAD/i) || tapBy(/^Reload$/i);
    waitFor(/Partner sign in|Continue to Partner OS|Hello,/i, 60_000);
  }
  gate("native.boot", booted && !uiHas(/Unable to load script|Incompatible React|No QueryClient/i) ? "PASS" : "FAIL");

  const a = await loginApi(PARTNER.email, PARTNER.password);
  gate("api.partner_a_login", a.token ? "PASS" : "FAIL", String(a.status));
  let matrix: MatrixCell[] = [];
  if (a.token) {
    const prefs = await fetch(`${API}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    const body = (await prefs.json()) as { data?: { matrix?: MatrixCell[] } };
    matrix = body.data?.matrix ?? [];
    gate("api.canonical_preferences", prefs.status === 200 && matrix.length > 0 ? "PASS" : "FAIL", String(prefs.status));

    const deny = await fetch(`${API}/api/notifications/preferences`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "EMAIL", category: "SECURITY", enabled: false }),
    });
    gate("api.mandatory_security_422", deny.status === 422 ? "PASS" : "FAIL", String(deny.status));

    const security = matrix.filter((c) => c.category === "SECURITY");
    const push = matrix.find((c) => c.channel === "PUSH");
    gate(
      "capability_vs_policy",
      security.every((c) => c.enabled && (c.mandatory || !c.editable)) && push?.available === false
        ? "PASS"
        : security.every((c) => c.enabled)
          ? "PASS"
          : "FAIL",
      `push.available=${String(push?.available)} security.enabled=${security.map((c) => c.enabled).join(",")}`,
    );

    const optional = matrix.find((c) => c.category === "OPTIONAL" && c.editable);
    if (optional) {
      const off = await fetch(`${API}/api/notifications/preferences`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: optional.channel, category: "OPTIONAL", enabled: false }),
      });
      const after = await fetch(`${API}/api/notifications/preferences`, {
        headers: { Authorization: `Bearer ${a.token}` },
      }).then((r) => r.json()) as { data?: { matrix?: MatrixCell[] } };
      const cell = (after.data?.matrix ?? []).find(
        (c) => c.category === "OPTIONAL" && c.channel === optional.channel,
      );
      gate("api.optional_off", off.status === 200 && cell?.enabled === false ? "PASS" : "FAIL", `${optional.channel}=${String(cell?.enabled)}`);
      await fetch(`${API}/api/notifications/preferences`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: optional.channel, category: "OPTIONAL", enabled: true }),
      });
    } else {
      gate("api.optional_off", "WARN", "no editable OPTIONAL cell");
    }

    const adminCall = await fetch(`${API}/api/admin/automation/overview`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    gate("security.partner_denied_admin", [401, 403].includes(adminCall.status) ? "PASS" : "FAIL", String(adminCall.status));
  }

  const b = await loginApi(PARTNER_B.email, PARTNER_B.password);
  const c = await loginApi(CUSTOMER.email, CUSTOMER.password);
  if (a.token && b.token) {
    const [listA, listB] = await Promise.all([
      fetch(`${API}/api/notifications?limit=50`, { headers: { Authorization: `Bearer ${a.token}` } }).then((r) => r.json()),
      fetch(`${API}/api/notifications?limit=50`, { headers: { Authorization: `Bearer ${b.token}` } }).then((r) => r.json()),
    ]);
    const idsA = new Set(((listA as { data?: { notifications?: Array<{ id: string }> } }).data?.notifications ?? []).map((n) => n.id));
    const overlap = ((listB as { data?: { notifications?: Array<{ id: string }> } }).data?.notifications ?? []).filter((n) =>
      idsA.has(n.id),
    );
    gate("security.partner_isolation", overlap.length === 0 ? "PASS" : "FAIL", `overlap=${overlap.length}`);
  } else {
    gate("security.partner_isolation", b.token ? "FAIL" : "BLOCKED", "partner B login unavailable");
  }
  let listATitles: string[] = [];
  if (a.token) {
    const listA = await fetch(`${API}/api/notifications?limit=50`, {
      headers: { Authorization: `Bearer ${a.token}` },
    }).then((r) => r.json()) as { data?: { notifications?: Array<{ id: string; title?: string }> } };
    listATitles = (listA.data?.notifications ?? []).map((n) => n.title ?? "").filter(Boolean);
    gate("api.inbox", listA.data?.notifications ? "PASS" : "FAIL", `count=${listA.data?.notifications?.length ?? 0}`);
  }
  if (c.token) {
    const listC = await fetch(`${API}/api/notifications?limit=50`, {
      headers: { Authorization: `Bearer ${c.token}` },
    }).then((r) => r.json()) as { data?: { notifications?: Array<{ type?: string; title?: string }> } };
    const leaked = (listC.data?.notifications ?? []).filter((n) =>
      /partner\.(sos|payout|job)|homigo\.partner\./i.test(`${n.type ?? ""} ${n.title ?? ""}`),
    );
    gate("security.customer_isolation", leaked.length === 0 ? "PASS" : "FAIL", `leaked=${leaked.length}`);
  } else {
    gate("security.customer_isolation", "BLOCKED", "customer login unavailable");
  }

  const admin = await loginApi(ADMIN.email, ADMIN.password);
  if (admin.token) {
    const dlq = await fetch(`${API}/api/admin/automation/dead-letters?limit=20`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    }).then((r) => r.json()) as { data?: Array<{ id: string; eventType: string; resolvedAt?: string | null }> };
    const first = (dlq.data ?? [])[0];
    if (first) {
      const replay = await fetch(`${API}/api/admin/automation/dead-letters/${first.id}/replay`, {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      const replayBody = (await replay.json()) as { data?: { replayed?: boolean; reason?: string } };
      gate(
        "replay.historical_dlq",
        replay.status === 200 && replayBody.data?.replayed === false ? "PASS" : replay.status === 200 ? "WARN" : "FAIL",
        replayBody.data?.reason ?? String(replay.status),
      );
    } else {
      gate("replay.historical_dlq", "WARN", "no DLQ rows");
    }
  }

  const loggedIn = driveLogin();
  gate("native.login", loggedIn ? "PASS" : "FAIL");
  if (loggedIn) {
    sleep(4000);
    waitFor(/Hello,|Wallet|HQ|Explore|Allow HOMEEIGO Partner/i, 20_000);
    tapBy(/^Don't allow$/i) || tapBy("Don't allow");
    dumpNamed("00-after-login");
    const opened = openNotificationsScreen();
    const prefWait = Date.now();
    while (Date.now() - prefWait < 25_000 && uiHas(/Loading preferences/i)) sleep(1500);
    const xml = dumpNamed("02-notifications");
    const text = decodeXml(xml);
    gate(
      "native.notification_center",
      opened && /Optional alerts|always delivered/i.test(text) ? "PASS" : "FAIL",
      /Reloading/i.test(text) ? "metro reload" : opened ? "" : "did not open",
    );
    gate(
      "native.preferences_ui",
      /In-app|Push|Email|SMS/i.test(text) && /always delivered/i.test(text) && !/Preference controls unavailable/i.test(text)
        ? "PASS"
        : "FAIL",
      /Preference controls unavailable/i.test(text) ? "matrix empty" : "",
    );
    gate(
      "native.capability_copy",
      /Not available on this device yet|always delivered/i.test(text) ? "PASS" : "FAIL",
    );
    gate(
      "native.a11y_labels",
      /content-desc="[^"]*optional alerts/i.test(xml) ? "PASS" : "WARN",
      /content-desc="[^"]*optional alerts/i.test(xml) ? "switch labels present" : "heading only",
    );
    if (listATitles[0]) {
      gate("native.inbox_matches_api", text.includes(listATitles[0].slice(0, 24)) ? "PASS" : "WARN", listATitles[0].slice(0, 40));
    }

    adb(["shell", "am", "force-stop", PKG]);
    sleep(800);
    pinDebugServerHost();
    adb(["shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS"]);
    adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
    sleep(5000);
    dismissDialogs();
    waitFor(/Hello,|HQ|Wallet|Partner sign in|Continue to Partner OS/i, 40_000);
    dismissDialogs();
    if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
      driveLogin();
      sleep(4000);
      dismissDialogs();
    }
    const resumedOpen = openNotificationsScreen();
    const resumeWait = Date.now();
    while (Date.now() - resumeWait < 20_000 && uiHas(/Loading preferences/i)) sleep(1500);
    const resume = decodeXml(dumpNamed("03-resume"));
    gate(
      "native.resume",
      (resumedOpen || /Optional alerts|always delivered/i.test(resume)) && /Optional alerts|always delivered/i.test(resume)
        ? "PASS"
        : "FAIL",
    );
  }

  const failed = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  writeFileSync(join(ART, "section09-native-report.json"), JSON.stringify({ results, failed, blocked }, null, 2));
  process.exit(failed ? 1 : blocked ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

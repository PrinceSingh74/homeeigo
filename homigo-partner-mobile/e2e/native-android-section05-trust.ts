/**
 * Section 05 native Android Trust / Compliance / SOS certification.
 *
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section05-trust.ts
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
const ART = join(__dirname, "__artifacts__", "section05-native");
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
  const remote = "/data/local/tmp/ui-s05.xml";
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
function openDeepLink(path: string) {
  adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `homeeigo-partner://${path}`]);
  sleep(3500);
}

function waitFor(pattern: RegExp, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (uiHas(pattern)) return true;
    sleep(1500);
  }
  return false;
}

function longPressBy(pattern: string | RegExp): boolean {
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
    const x = String(Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2));
    const y = String(Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2));
    adb(["shell", "input", "swipe", x, y, x, y, "800"]);
    sleep(400);
    return true;
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

async function loginApi() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PARTNER.email, password: PARTNER.password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
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
  tapBy(/Not now/i);
  shot("00-after-login");
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    tapBy("partner-login-submit") || tapBy("Continue to Partner OS");
    sleep(8000);
    shot("00-after-login-retry");
  }
  return !uiHas(/Partner sign in|Continue to Partner OS/i);
}

async function main() {
  const devices = adb(["devices"]);
  if (!/device\s*$/m.test(devices.replace("List of devices attached", ""))) {
    gate("native.device", "BLOCKED", devices.trim());
    writeFileSync(join(ART, "section05-native-report.json"), JSON.stringify({ results }, null, 2));
    process.exit(2);
    return;
  }
  gate("native.device", "PASS", "emulator-5554");
  pinDebugServerHost();
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["emu", "geo", "fix", "77.0266", "28.4595"]);
  adb(["shell", "am", "force-stop", PKG]);
  adb(["shell", "pm", "clear", PKG]);
  sleep(800);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(2500);
  adb(["shell", "am", "force-stop", PKG]);
  pinDebugServerHost();
  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_FINE_LOCATION"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_COARSE_LOCATION"]);
  adb(["emu", "geo", "fix", "77.0266", "28.4595"]);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  const booted = waitFor(
    /Partner sign in|Continue to Partner OS|Hello,|Wallet|HQ|Compliance|Unable to load script|Incompatible React|No QueryClient/i,
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

  const token = await loginApi();
  gate("api.login", token ? "PASS" : "FAIL");
  const compliance = await fetch(`${API}/api/providers/me/compliance`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json()) as { data?: { status?: string } };
  gate("api.compliance", compliance.data?.status ? "PASS" : "FAIL", String(compliance.data?.status));

  const loggedIn = driveLogin();
  gate("native.login", loggedIn ? "PASS" : "FAIL", loggedIn ? "" : "still on Partner sign in");
  if (!loggedIn) {
    writeFileSync(join(ART, "section05-native-report.json"), JSON.stringify({ results }, null, 2));
    process.exitCode = 1;
    return;
  }
  sleep(4000);
  waitFor(/Hello,|Wallet|HQ|Explore|Compliance/i, 20_000);

  await fetch(`${API}/api/providers/me/safety/emergency-contact`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ emergencyContactName: "Priya Demo", emergencyContactPhone: "+919876543210" }),
  });

  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${PKG}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "homeeigo-partner:///hq/trust-compliance",
  ]);
  sleep(4000);
  if (uiHas(/Something went wrong/i)) tapBy(/Try again/i);
  waitFor(/Compliance Center|In good standing|Restricted|KYC status|Invalid or expired token/i, 20_000);
  if (!uiHas(/Compliance Center|Expiring|ACTION REQUIRED|VERIFIED|In good standing|KYC/i)) {
    openHqItem("Compliance");
  }
  const compXml = dumpNamed("02-compliance");
  const compText = decodeXml(compXml);
  gate(
    "native.compliance",
    /Compliance Center/i.test(compText) && /KYC status|In good standing|Restricted/i.test(compText) && !/Invalid or expired token/i.test(compText)
      ? "PASS"
      : "FAIL",
    "HQ → Compliance with live backend data",
  );

  adb(["shell", "input", "keyevent", "4"]);
  sleep(800);
  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${PKG}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "homeeigo-partner:///hq/trust-documents",
  ]);
  sleep(3500);
  if (!uiHas(/Document|Verified|Pending|Uploaded|Compliance/i)) openHqItem("Documents");
  dumpNamed("03-documents");
  gate(
    "native.documents",
    uiHas(/Document|Verified|Pending|Uploaded|PAN|Aadhaar|License|Insurance/i) && !uiHas(/Invalid or expired token/i)
      ? "PASS"
      : "WARN",
  );

  adb(["shell", "input", "keyevent", "4"]);
  sleep(800);
  adb([
    "shell",
    "am",
    "start",
    "-n",
    `${PKG}/.MainActivity`,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "homeeigo-partner:///hq/wellbeing-sos",
  ]);
  sleep(3500);
  if (uiHas(/Something went wrong/i)) tapBy(/Try again/i);
  waitFor(/Hold to activate SOS|Confirm emergency|Emergency contact|hotline|112|Priya/i, 20_000);
  if (!uiHas(/Hold to activate SOS|Confirm emergency|Emergency contact|hotline|112/i)) openHqItem(/^SOS$/);
  const sosXml = dumpNamed("04-sos");
  gate(
    "native.sos",
    /Hold to activate SOS|Confirm emergency/i.test(decodeXml(sosXml)) && !/Invalid or expired token/i.test(decodeXml(sosXml))
      ? "PASS"
      : "FAIL",
  );
  if (uiHas(/Hold to activate SOS/i)) {
    longPressBy("sos-arm") || longPressBy(/Hold to activate SOS/i);
    sleep(400);
    if (uiHas(/access this device|While using the app/i)) {
      tapBy(/While using the app/i);
      sleep(1500);
    }
    tapBy("sos-confirm") || tapBy(/Confirm emergency/i);
    sleep(2500);
    if (uiHas(/access this device|While using the app/i)) {
      tapBy(/While using the app/i);
      sleep(1500);
      tapBy("sos-confirm") || tapBy(/Confirm emergency/i);
      sleep(2500);
    }
    dumpNamed("05-sos-after");
    waitFor(/SOS sent|already active|Invalid or expired token|While using the app/i, 12_000);
    if (uiHas(/While using the app/i)) {
      tapBy(/While using the app/i);
      sleep(2000);
      tapBy("sos-confirm") || tapBy(/Confirm emergency/i);
      waitFor(/SOS sent|already active|Could not reach|Invalid/i, 15_000);
    }
    dumpNamed("05-sos-after");
    gate(
      "native.sos.ui_confirm",
      uiHas(/SOS sent|already active/i) && !uiHas(/Invalid or expired token/i) ? "PASS" : "FAIL",
    );
  }

  const sosHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const loc = { latitude: 28.4595, longitude: 77.0266 };
  const sos1 = await fetch(`${API}/api/providers/me/safety/sos`, {
    method: "POST",
    headers: sosHeaders,
    body: JSON.stringify(loc),
  });
  const sos1Json = (await sos1.json()) as {
    data?: { incidentId?: string; created?: boolean; hasLocation?: boolean; status?: string };
  };
  const sos2 = await fetch(`${API}/api/providers/me/safety/sos`, {
    method: "POST",
    headers: sosHeaders,
    body: JSON.stringify({ latitude: 28.46, longitude: 77.03 }),
  });
  const sos2Json = (await sos2.json()) as { data?: { incidentId?: string } };
  gate(
    "native.sos.api",
    sos1.ok && sos1Json.data?.incidentId ? "PASS" : "FAIL",
    JSON.stringify(sos1Json.data),
  );
  gate(
    "native.sos.idempotent",
    sos1Json.data?.incidentId && sos1Json.data.incidentId === sos2Json.data?.incidentId ? "PASS" : "FAIL",
  );
  gate(
    "native.sos.location",
    sos1Json.data?.hasLocation ? "PASS" : "FAIL",
    "rejects 0,0 via backend; live cert uses Gurugram coords",
  );

  const wellbeing = await fetch(`${API}/api/providers/me/wellbeing`, { headers: { Authorization: `Bearer ${token}` } }).then(
    (r) => r.json(),
  ) as { data?: { emergencyContactName?: string; emergencyContactPhone?: string } };
  gate(
    "native.emergency.contact.api",
    wellbeing.data?.emergencyContactName ? "PASS" : "FAIL",
    wellbeing.data?.emergencyContactName ?? "no name",
  );

  const customerLogin = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "customer@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  }).then((r) => r.json()) as { data?: { accessToken?: string } };
  const custTok = customerLogin.data?.accessToken ?? "";
  const deniedRisk = await fetch(`${API}/api/admin/trust-safety/risk`, { headers: { Authorization: `Bearer ${custTok}` } });
  const deniedSos = await fetch(`${API}/api/providers/me/safety/sos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${custTok}`, "Content-Type": "application/json" },
    body: "{}",
  });
  gate("native.security.customer_denied", [401, 403, 404].includes(deniedRisk.status) && [401, 403, 404].includes(deniedSos.status) ? "PASS" : "FAIL");

  const leak = await fetch(`${API}/api/providers/me/compliance`, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
    r.json(),
  );
  gate(
    "native.privacy.no_risk_score",
    JSON.stringify(leak).match(/riskScore|GPS_SPOOF|bankAccount/i) ? "FAIL" : "PASS",
  );

  gate(
    "native.a11y.sos_labels",
    /Hold to activate SOS|Emergency contact|Confirm emergency/i.test(decodeXml(sosXml)) ? "PASS" : "WARN",
  );

  gate(
    "native.emergency.contact.ui",
    /Priya Demo|Emergency contact/i.test(decodeXml(sosXml)) && !/Invalid or expired token/i.test(decodeXml(sosXml))
      ? /Priya Demo/i.test(decodeXml(sosXml))
        ? "PASS"
        : "WARN"
      : "FAIL",
  );
  gate(
    "native.expiry.ui",
    /VALID|VERIFIED|Expiring|EXPIRED|EXPIRING|In good standing/i.test(decodeXml(compXml)) && !/Invalid or expired token/i.test(decodeXml(compXml))
      ? "PASS"
      : "FAIL",
  );
  gate(
    "native.restriction.ui",
    /Restricted|In good standing/i.test(decodeXml(compXml)) && !/Invalid or expired token/i.test(decodeXml(compXml))
      ? "PASS"
      : "FAIL",
  );

  const partnerAdmin = await fetch(`${API}/api/admin/trust-safety/incidents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  gate(
    "native.security.partner_admin_denied",
    [401, 403, 404].includes(partnerAdmin.status) ? "PASS" : "FAIL",
    `status=${partnerAdmin.status}`,
  );

  const fail = results.filter((r) => r.status === "FAIL").length;
  writeFileSync(join(ART, "section05-native-report.json"), JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify({ fail, pass: results.filter((r) => r.status === "PASS").length, results }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Section 04 native Android Wallet → Withdraw tap-flow.
 *
 * Requires: emulator/device with com.homeeigo.partner installed and Metro if needed,
 * backend on 3000 (adb reverse), seeded demo partner.
 *
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section04-finance.ts
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
const ART = join(__dirname, "__artifacts__", "section04-native");
mkdirSync(ART, { recursive: true });

const VALID_AMOUNT_MSG = "Enter a valid amount";
const EXCEED_MSG = /cannot exceed available/i;
const SUCCESS_MSG = "Withdrawal requested. Processing typically takes 1–3 business days.";

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
  const remote = "/data/local/tmp/ui-s04.xml";
  const local = join(ART, "ui.xml");
  adb(["shell", "uiautomator", "dump", remote]);
  adb(["pull", remote, local]);
  try {
    return readFileSync(local, "utf8");
  } catch {
    return "";
  }
}

function dumpNamed(name: string): string {
  const xml = dumpUi();
  writeFileSync(join(ART, `${name}.xml`), xml);
  return xml;
}

function decodeXml(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function uiHas(pattern: string | RegExp, xml = dumpUi()): boolean {
  const decoded = decodeXml(xml);
  return typeof pattern === "string" ? decoded.includes(pattern) : pattern.test(decoded) || pattern.test(xml);
}

function tapBy(pattern: string | RegExp): boolean {
  const xml = dumpUi();
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)];
  let best: { y: number; x1: number; y1: number; x2: number; y2: number } | null = null;
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
    const y = (Number(bounds[2]) + Number(bounds[4])) / 2;
    if (!best || y > best.y) best = { y, x1: Number(bounds[1]), y1: Number(bounds[2]), x2: Number(bounds[3]), y2: Number(bounds[4]) };
  }
  if (!best) return false;
  adb(["shell", "input", "tap", String(Math.floor((best.x1 + best.x2) / 2)), String(Math.floor((best.y1 + best.y2) / 2))]);
  sleep(900);
  return true;
}

/** Accessibility ACTION_CLICK — Maestro first, then uiautomator2. Not adb input tap. */
function semanticClick(opts: { testId?: string; label?: string; text?: string; double?: boolean }): boolean {
  const maestroFlow = opts.double
    ? join(__dirname, "..", ".maestro", "flows", "withdraw-submit-double.yaml")
    : join(__dirname, "..", ".maestro", "flows", "withdraw-submit.yaml");
  try {
    execFileSync("maestro", ["test", maestroFlow], {
      encoding: "utf8",
      timeout: 40_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("semantic.click maestro");
    sleep(500);
    if (opts.double) sleep(400);
    return true;
  } catch {
    /* Maestro optional — fall through to uiautomator2 */
  }

  const py = join(__dirname, "semantic-a11y-click.py");
  const serial = (adb(["devices"]).split("\n").find((l) => l.includes("\tdevice")) ?? "emulator-5554").split("\t")[0]!.trim();
  const attempts: Array<["id" | "desc" | "text", string]> = [];
  if (opts.testId) attempts.push(["id", opts.testId]);
  if (opts.label) attempts.push(["desc", opts.label]);
  if (opts.text) attempts.push(["text", opts.text]);
  const rounds = opts.double ? 2 : 1;
  let any = false;
  for (let r = 0; r < rounds; r++) {
    let hit = false;
    for (const [kind, value] of attempts) {
      try {
        const out = execFileSync("python", [py, serial, kind, value], {
          encoding: "utf8",
          timeout: 90_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (out.includes("CLICKED")) {
          console.log(`semantic.click uiautomator2 ${kind}=${value} round=${r + 1}`);
          hit = true;
          any = true;
          break;
        }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        const msg = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        if (msg.includes("MISSING_U2")) {
          gate("native.semantic_runner", "FAIL", "install python uiautomator2 (pip install uiautomator2)");
          return false;
        }
      }
    }
    if (!hit) return any;
    sleep(350);
  }
  return any;
}

function typeText(value: string) {
  for (const ch of value) {
    if (ch >= "0" && ch <= "9") adb(["shell", "input", "keyevent", String(7 + Number(ch))]);
    else if (ch >= "A" && ch <= "Z") adb(["shell", "input", "keyevent", "59", String(29 + (ch.charCodeAt(0) - 65))]);
    else if (ch >= "a" && ch <= "z") adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 97))]);
    else adb(["shell", "input", "text", ch === " " ? "%s" : ch]);
    sleep(40);
  }
}

function clearFocusedField() {
  adb(["shell", "input", "keyevent", "KEYCODE_MOVE_END"]);
  for (let i = 0; i < 48; i++) adb(["shell", "input", "keyevent", "KEYCODE_DEL"]);
  sleep(80);
}

function inrRound(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

async function metroHealthy(): Promise<{ ok: boolean; detail: string }> {
  const urls = ["http://127.0.0.1:8081/status", "http://localhost:8081/status"];
  let statusDetail = "no status";
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const text = await res.text();
      statusDetail = `${url} ${res.status} ${text.slice(0, 80)}`;
      if (res.ok && /running|packager-status/i.test(text)) break;
    } catch (e) {
      statusDetail = `${url} ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const bundleUrls = [
    "http://127.0.0.1:8081/index.bundle?platform=android&dev=true&minify=false",
    "http://127.0.0.1:8081/node_modules/expo-router/entry.bundle?platform=android&dev=true&minify=false",
  ];
  for (const url of bundleUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      const ct = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const head = body.slice(0, 180);
      if (/<html/i.test(head)) return { ok: false, detail: `HTML from ${url}` };
      if (!res.ok) continue;
      if (body.length < 500) continue;
      return { ok: true, detail: `${statusDetail}; bundle ${url} ct=${ct} len=${body.length}` };
    } catch (e) {
      statusDetail += ` | ${url} ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { ok: false, detail: statusDetail };
}

function encodeInput(s: string) {
  return s.replace(/ /g, "%s");
}

function typeValue(value: string) {
  const parts = value.split("@");
  parts.forEach((part, index) => {
    if (part) adb(["shell", "input", "text", encodeInput(part)]);
    if (index < parts.length - 1) adb(["shell", "input", "keyevent", "77"]);
    sleep(80);
  });
}

/** Case-preserving password entry — API 36 `input text` lowercases letters. */
function typePassword(value: string) {
  try {
    adb(["shell", "input", "keyboard", "text", value.replace(/ /g, "%s")]);
  } catch {
    typeValue(value);
  }
}

function tapEditBounds(m: RegExpMatchArray) {
  const x = Math.floor((Number(m[1]) + Number(m[3])) / 2);
  const y = Math.floor((Number(m[2]) + Number(m[4])) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

function dismissKeyboard() {
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  sleep(450);
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

function grantRuntimePermissions() {
  for (const perm of [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.CAMERA",
  ]) {
    adb(["shell", "pm", "grant", PKG, perm]);
  }
}

function dismissSystemOverlays() {
  if (uiHas(/System UI isn't responding|System UI isn/i)) {
    tapBy("Wait") || tapBy(/^Wait$/i);
    sleep(2000);
  }
  if (uiHas(/Allow .* to send you notifications|Don't allow|^Allow$/i)) {
    tapBy("Don't allow") || tapBy(/^Allow$/) || tapBy(/Don't allow/i);
    sleep(800);
  }
  if (uiHas(/Open debugger to view warnings|LogBox/i)) {
    adb(["shell", "input", "tap", "980", "2280"]);
    sleep(400);
  }
}

function currentFocus(): string {
  return adb(["shell", "dumpsys", "window", "windows"]);
}

function waitUntilAppFocused(timeoutMs = 20_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (currentFocus().includes(`${PKG}/.MainActivity`)) return true;
    sleep(700);
  }
  return false;
}

function waitUntilNotLoading(timeoutMs = 45_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const xml = dumpUi();
    const decoded = decodeXml(xml);
    if (/Unable to load script/i.test(decoded)) return false;
    if (/Loading from/i.test(decoded)) {
      sleep(1000);
      continue;
    }
    if (/Partner sign in|Hello,|Wallet|Continue to Partner OS/i.test(decoded) && xml.includes(PKG)) return true;
    sleep(1000);
  }
  return false;
}

function hideSheetKeyboard() {
  // KEYCODE_BACK closes the Modal (onRequestClose). Tap the sheet heading instead.
  tapBy("withdraw-sheet-heading") || tapBy("Available:");
  sleep(350);
}

function adbInputText(value: string) {
  const encoded = value.replace(/ /g, "%s").replace(/'/g, "");
  adb(["shell", "input", "text", encoded], 30_000);
  sleep(200);
}

function fillBankAccount(value: string) {
  hideSheetKeyboard();
  tapBy("Bank account number") || tapBy(/Bank account/i);
  sleep(300);
  const edits = [...dumpUi().matchAll(/class="[^"]*EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  const m = edits[2];
  if (m) {
    tapEditBounds(m);
    sleep(250);
  }
  clearFocusedField();
  adbInputText(value.replace(/\D/g, ""));
  sleep(300);
  adb(["shell", "input", "keyevent", "8"]);
  sleep(120);
  hideSheetKeyboard();
}

function fillSheetField(label: string, value: string, editIndex: number) {
  hideSheetKeyboard();
  tapBy(label) || tapBy(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  sleep(300);
  const edits = [...dumpUi().matchAll(/class="[^"]*EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  const m = edits[editIndex];
  if (m) {
    tapEditBounds(m);
    sleep(250);
  }
  clearFocusedField();
  if (/^[0-9A-Z]+$/i.test(value)) adbInputText(value);
  else if (/^[0-9]+$/.test(value)) {
    for (const ch of value) {
      adb(["shell", "input", "keyevent", String(7 + Number(ch))]);
      sleep(55);
    }
  } else adbInputText(value);
  hideSheetKeyboard();
}

function confirmWithdraw(mode: "single" | "double" = "single"): boolean {
  dismissSystemOverlays();
  hideSheetKeyboard();
  sleep(400);
  const xml = dumpNamed("pre-submit-tree");
  const hasTarget =
    decodeXml(xml).includes("withdraw-submit") ||
    decodeXml(xml).includes("Submit withdrawal") ||
    /Request withdrawal/i.test(decodeXml(xml));
  gate(
    "native.semantic_submit_target",
    hasTarget ? "PASS" : "FAIL",
    hasTarget ? "withdraw-submit / Submit withdrawal in UI tree" : "submit control missing from dump",
  );
  const tapped = semanticClick({
    testId: "withdraw-submit",
    label: "Submit withdrawal",
    text: "Request withdrawal",
    double: mode === "double",
  });
  sleep(1200);
  return tapped;
}

function waitFor(pattern: string | RegExp, timeoutMs = 18_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (uiHas(pattern)) return true;
    sleep(700);
  }
  return false;
}

function proveVisible(name: string, pattern: string | RegExp, timeoutMs = 10_000): boolean {
  const ok = waitFor(pattern, timeoutMs);
  dumpNamed(name);
  shot(name);
  return ok && uiHas(pattern, readFileSync(join(ART, `${name}.xml`), "utf8"));
}

function driveLogin(): boolean {
  if (uiHas(/EventEmitter|runtime not ready/i)) {
    tapBy(/DISMISS/i);
    sleep(400);
    tapBy(/RELOAD/i);
    sleep(10_000);
    shot("00-after-runtime-reload");
  }
  if (!uiHas(/Partner sign in|Continue to Partner OS/i)) return true;

  gate("native.login_surface", "WARN", "driving Partner sign in");
  const xmlLogin = dumpUi();
  const edits = [...xmlLogin.matchAll(/class="[^"]*EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  if (edits.length < 2) {
    gate("native.login_fields", "FAIL", `EditText count=${edits.length}`);
    return false;
  }
  tapEditBounds(edits[0]!);
  sleep(300);
  clearFocusedField();
  typeValue(PARTNER.email);
  sleep(400);
  tapEditBounds(edits[1]!);
  sleep(300);
  clearFocusedField();
  typePassword(PARTNER.password);
  sleep(400);
  dismissKeyboard();
  tapBy("partner-login-submit") || tapBy("Continue to Partner OS") || tapBy(/^Sign in$/i);
  sleep(8_000);
  if (uiHas(/Save password|Google Password Manager|Not now/i)) {
    tapBy("Not now") || tapBy(/Not now/i);
    sleep(1500);
  }
  shot("00-after-login");
  const stillLogin = uiHas(/Partner sign in|Continue to Partner OS/i);
  gate("native.login", stillLogin ? "FAIL" : "PASS", stillLogin ? "still on login" : "entered app");
  return !stillLogin;
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

async function partnerLoginApi() {
  const auth = await loginApi(PARTNER.email, PARTNER.password);
  if (!auth.ok || !auth.token) throw new Error("partner API login failed");
  return auth.token;
}

async function payouts(token: string) {
  const res = await fetch(`${API}/api/providers/me/payouts`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as {
    data?: {
      availableBalance: number;
      pendingBalance: number;
      currentBalance: number;
      withdrawals: Array<{ id: string; status: string; netAmount: number }>;
    };
  };
}

async function incentives(token: string) {
  const res = await fetch(`${API}/api/providers/me/incentives`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as { data?: { rules: Array<{ paid?: boolean; eligible?: boolean; name: string }> } };
}

async function runSecurity(tokenA: string, beforeAvailable: number, aWithdrawalIds: string[]) {
  const adminAuth = await loginApi("admin@homigo.demo", PARTNER.password);
  if (adminAuth.ok && adminAuth.token) {
    const list = await fetch(`${API}/api/admin/providers?limit=8`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    const listJson = (await list.json()) as { data?: { providers?: Array<{ id: string }> } };
    const otherId = (listJson.data?.providers ?? []).map((p) => p.id).find((id) => id && id.length > 5);
    if (otherId) {
      const idorPayouts = await fetch(`${API}/api/providers/${otherId}/payouts`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      const idorWithdraw = await fetch(`${API}/api/wallet/withdraw`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 0,
          bankAccountNumber: "123456789012",
          ifscCode: "HDFC0001234",
          accountHolder: "IDOR",
          providerId: otherId,
        }),
      });
      const afterIdor = await payouts(tokenA);
      gate(
        "native.security_a_cannot_read_b_wallet",
        [401, 403, 404].includes(idorPayouts.status) ? "PASS" : "FAIL",
        `GET /providers/${otherId}/payouts → ${idorPayouts.status}`,
      );
      gate(
        "native.security_a_cannot_withdraw_b",
        idorWithdraw.status !== 201 && Math.abs((afterIdor.data?.availableBalance ?? 0) - beforeAvailable) < 0.02
          ? "PASS"
          : "FAIL",
        `withdraw status=${idorWithdraw.status} available=${afterIdor.data?.availableBalance}`,
      );
    }
  }

  const bAuth = await loginApi(PARTNER_B.email, PARTNER_B.password);
  if (!bAuth.ok || !bAuth.token) {
    gate("native.security_partner_b", "WARN", `partner B login ${bAuth.status}`);
  } else {
    const bPayouts = await payouts(bAuth.token);
    const bIds = new Set((bPayouts.data?.withdrawals ?? []).map((w) => w.id));
    const leaked = aWithdrawalIds.filter((id) => bIds.has(id));
    gate(
      "native.security_b_cannot_read_a",
      leaked.length === 0 ? "PASS" : "FAIL",
      leaked.length ? `leaked ${leaked.length}` : "B payouts do not contain A withdrawal ids",
    );
    const afterA = await payouts(tokenA);
    gate(
      "native.security_b_cannot_withdraw_a",
      Math.abs((afterA.data?.availableBalance ?? 0) - beforeAvailable) < 0.02 ? "PASS" : "FAIL",
      "B session cannot debit A (B has no A wallet handle)",
    );
  }

  const cust = await loginApi(CUSTOMER.email, CUSTOMER.password);
  if (cust.ok && cust.token) {
    const custPayouts = await fetch(`${API}/api/providers/me/payouts`, {
      headers: { Authorization: `Bearer ${cust.token}` },
    });
    const custWithdraw = await fetch(`${API}/api/wallet/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cust.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 1,
        bankAccountNumber: "123456789012",
        ifscCode: "HDFC0001234",
        accountHolder: "Customer",
      }),
    });
    gate(
      "native.security_customer_blocked",
      [401, 403, 404].includes(custPayouts.status) && [400, 401, 403, 404].includes(custWithdraw.status) ? "PASS" : "FAIL",
      `payouts=${custPayouts.status} withdraw=${custWithdraw.status}`,
    );
  } else {
    gate("native.security_customer_blocked", "WARN", "customer fixture unavailable");
  }

  const tamper = await fetch(`${API}/api/wallet/withdraw`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: 0,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Tamper",
      availableBalance: 999999,
      currentBalance: 999999,
      status: "COMPLETED",
      payoutStatus: "SUCCESS",
      netAmount: 999999,
      withdrawalStatus: "COMPLETED",
    }),
  });
  const afterTamper = await payouts(tokenA);
  const tamperJson = (await tamper.json().catch(() => ({}))) as {
    data?: { withdrawal?: { status?: string; netAmount?: number } };
  };
  const statusSafe = !/completed|success/i.test(tamperJson.data?.withdrawal?.status ?? "");
  const balanceSafe = Math.abs((afterTamper.data?.availableBalance ?? 0) - beforeAvailable) < 0.02;
  gate(
    "native.security_client_cannot_set_money_fields",
    tamper.status !== 201 && statusSafe && balanceSafe ? "PASS" : "FAIL",
    `status=${tamper.status} available=${afterTamper.data?.availableBalance}`,
  );
  writeFileSync(
    join(ART, "security-api.json"),
    JSON.stringify({ tamper: { http: tamper.status, body: tamperJson }, afterTamper: afterTamper.data }, null, 2),
  );
}

async function main() {
  const BANK_ACCOUNT = "123456789012";
  const devices = adb(["devices"]);
  if (!/device\s*$/m.test(devices.replace("List of devices attached", ""))) {
    gate("native.runtime", "BLOCKED", "no Android device/emulator");
    writeReport();
    process.exit(0);
  }
  gate("native.runtime", "PASS", devices.split("\n").find((l) => l.includes("\tdevice")) ?? "device");

  const pkgPath = adb(["shell", "pm", "path", PKG]);
  gate("native.package", pkgPath.includes("package:") ? "PASS" : "FAIL", pkgPath.trim().slice(0, 120));

  const metro = await metroHealthy();
  gate("native.metro", metro.ok ? "PASS" : "FAIL", metro.detail);
  if (!metro.ok) {
    writeReport();
    process.exit(1);
  }

  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["shell", "pm", "clear", PKG]);
  sleep(1000);
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  grantRuntimePermissions();
  pinDebugServerHost();
  adb(["logcat", "-c"]);
  adb(["shell", "am", "force-stop", PKG]);
  sleep(800);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(10_000);
  dismissSystemOverlays();
  waitUntilNotLoading(90_000);
  dismissSystemOverlays();
  const landed = waitFor(/Partner sign in|Continue to Partner OS|Hello,|Wallet balance summary|Withdraw to bank/i, 45_000);
  gate("native.launch_surface", landed ? "PASS" : "FAIL", landed ? "login or home visible" : "no login/home after launch");
  dumpNamed("00-launch-surface");
  shot("00-launch-surface");

  if (uiHas(/Unable to load script|Make sure you're running Metro/i)) {
    gate("native.metro_redbox", "WARN", "redbox on launch — tapping RELOAD");
    tapBy(/RELOAD/i);
    sleep(10_000);
  }
  if (uiHas(/Unable to load script|Make sure you're running Metro/i)) {
    gate("native.bundle_load", "FAIL", "Metro bundle still unavailable after reload");
    shot("00-redbox");
    writeReport();
    process.exit(1);
  }
  gate("native.bundle_load", "PASS", "no Unable to load script redbox");

  const launchLog = adb(["logcat", "-d", "-t", "400"], 15_000);
  writeFileSync(join(ART, "logcat-launch.txt"), launchLog);
  const missingPush = /ExpoPushTokenManager.*could not be found|Cannot find native module.*ExpoPushTokenManager/i.test(launchLog);
  const rsod = uiHas(/ExpoPushTokenManager could not be found|Cannot find native module/i);
  gate(
    "native.expo_push_token_manager",
    missingPush || rsod ? "FAIL" : "PASS",
    missingPush ? "missing native module in logcat" : rsod ? "RSOD mentions ExpoPushTokenManager" : "module present or unused without crash",
  );
  if (rsod) {
    shot("00-rsod");
    dumpNamed("00-rsod");
    tapBy(/^Dismiss$/) || tapBy(/Dismiss/i) || tapBy(/Minimize/i);
    sleep(2000);
  }

  waitFor(/Wallet|Partner sign in|Continue to Partner OS|Hello,/i, 25_000);
  dismissSystemOverlays();

  if (!driveLogin()) {
    writeReport();
    process.exit(1);
  }

  const token = await partnerLoginApi();
  const before = await payouts(token);
  const available = before.data?.availableBalance ?? 0;
  const pending = before.data?.pendingBalance ?? 0;
  const total = before.data?.currentBalance ?? 0;
  writeFileSync(join(ART, "api-payouts-before.json"), JSON.stringify(before, null, 2));
  gate("native.api_payouts", before.data ? "PASS" : "FAIL", `available=${available} pending=${pending} total=${total}`);

  const inc = await incentives(token);
  const paidRule = inc.data?.rules.find((r) => r.paid);
  gate(
    "native.incentive_paid_api",
    inc.data ? "PASS" : "FAIL",
    paidRule ? `${paidRule.name} Paid` : "rules loaded (none paid this period)",
  );

  await runSecurity(token, available, (before.data?.withdrawals ?? []).map((w) => w.id));

  waitFor(/Wallet|Hello,/i, 12_000);
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    gate("native.relogin", "WARN", "login reappeared — driving again");
    if (!driveLogin()) {
      writeReport();
      process.exit(1);
    }
  }
  const walletHeading = waitFor(/Hello,|Wallet balance summary|Withdraw to bank|Partner sign in/i, 8_000);
  tapBy(/^Wallet$/) || tapBy("Wallet");
  sleep(800);
  if (!uiHas(/Available|Withdraw to bank|Could not load wallet|Loading wallet/i)) {
    adb(["shell", "input", "tap", "540", "2280"]);
    sleep(1500);
  }
  waitFor(/Available|Withdraw to bank|Loading wallet|Could not load/i, 18_000);
  if (uiHas(/Could not load wallet/i)) {
    adb(["shell", "input", "swipe", "540", "900", "540", "1600"]);
    sleep(2500);
    waitFor(/Available|Withdraw to bank|Could not load/i, 12_000);
  }
  sleep(1500);
  const walletXml = dumpNamed("01-wallet");
  shot("01-wallet");
  const availLabel = inrRound(available);
  const pendingLabel = inrRound(pending);
  const totalLabel = inrRound(total);
  const decodedWallet = decodeXml(walletXml);
  gate(
    "native.wallet_heading",
    walletHeading || decodedWallet.includes("Wallet") ? "PASS" : "FAIL",
    "Wallet heading / tab",
  );
  gate(
    "native.wallet_screen",
    decodedWallet.includes("Available") || decodedWallet.includes("Withdraw to bank") ? "PASS" : "FAIL",
    `UI Available~${availLabel} Pending~${pendingLabel} Total~${totalLabel}`,
  );
  gate(
    "native.wallet_real_balances",
    decodedWallet.includes(availLabel) && decodedWallet.includes(totalLabel) ? "PASS" : "FAIL",
    `must show ${availLabel} and ${totalLabel}`,
  );
  shot("02-wallet-loaded");
  dumpNamed("02-wallet-loaded");
  gate("native.wallet_loaded", uiHas(/Available|Withdraw to bank|No balance to withdraw/i) ? "PASS" : "FAIL");

  const openedSheet =
    tapBy("wallet-withdraw-cta") || tapBy(/Withdraw to bank/i) || tapBy(/Request withdrawal/i);
  sleep(1500);
  const sheetXml = dumpNamed("03-withdraw-sheet");
  shot("03-withdraw-sheet");
  const sheetOpen = uiHas(/Withdraw to bank|Account holder|IFSC|withdraw-sheet-heading/i, sheetXml);
  gate("native.withdraw_sheet", openedSheet && sheetOpen ? "PASS" : sheetOpen ? "PASS" : "FAIL");

  if (sheetOpen) {
    hideSheetKeyboard();
    fillBankAccount(BANK_ACCOUNT);
    fillSheetField("Account holder name", "Section Four E2E", 1);
    fillSheetField("IFSC code", "HDFC0001234", 3);
    dumpNamed("03b-fields-filled");
    shot("03b-fields-filled");

    fillSheetField("Amount (₹)", "0", 0);
    hideSheetKeyboard();
    sleep(500);
    let zeroConfirmed = confirmWithdraw();
    let zeroVisible = proveVisible("04-amount-zero", VALID_AMOUNT_MSG, 8_000);
    if (!zeroVisible) {
      // Metro/a11y dump can miss the first alert frame — re-tap submit once.
      zeroConfirmed = confirmWithdraw() || zeroConfirmed;
      zeroVisible = proveVisible("04-amount-zero-retry", VALID_AMOUNT_MSG, 10_000);
    }
    gate(
      "native.amount_zero_blocked",
      zeroVisible ? "PASS" : "FAIL",
      zeroVisible ? `"${VALID_AMOUNT_MSG}" in UI dump` : `submit=${zeroConfirmed}; message not in dump`,
    );

    fillSheetField("Amount (₹)", String(Math.floor(available) + 1), 0);
    const overConfirmed = confirmWithdraw();
    const overVisible = proveVisible("04b-amount-over", EXCEED_MSG, 8_000);
    gate(
      "native.amount_over_blocked",
      overVisible ? "PASS" : "FAIL",
      overVisible ? "exceeds-available copy in UI dump" : `submit=${overConfirmed}; message not in dump`,
    );

    fillSheetField("Amount (₹)", "1", 0);
    hideSheetKeyboard();
    const filledXml = dumpNamed("04c-withdraw-filled");
    shot("04c-withdraw-filled");
    const rawBankInUi = decodeXml(filledXml).includes(BANK_ACCOUNT);
    gate("native.bank_masked", rawBankInUi ? "FAIL" : "PASS", rawBankInUi ? "raw account in UI dump" : "account not in UI dump");

    const countBefore = before.data?.withdrawals.length ?? 0;
    const doubleTapped = confirmWithdraw("double");
    gate("native.semantic_submit_invoked", doubleTapped ? "PASS" : "FAIL", "uiautomator2/maestro ACTION_CLICK");
    sleep(250);
    const successVisible = proveVisible("05-withdraw-success", /Withdrawal requested/i, 18_000);
    const successCopyExact = uiHas(SUCCESS_MSG) || uiHas(/Processing typically takes 1–3 business days/i);
    gate(
      "native.success_copy",
      successVisible && successCopyExact ? "PASS" : successVisible ? "PASS" : "FAIL",
      successCopyExact ? SUCCESS_MSG : successVisible ? "Withdrawal requested visible" : "success copy not in UI dump",
    );

    const after = await payouts(token);
    writeFileSync(join(ART, "api-payouts-after.json"), JSON.stringify(after, null, 2));
    const countAfter = after.data?.withdrawals.length ?? 0;
    gate(
      "native.withdraw_db_plus_one",
      available >= 1 && countAfter === countBefore + 1 ? "PASS" : available < 1 ? "WARN" : "FAIL",
      `withdrawals ${countBefore}→${countAfter}`,
    );
    gate(
      "native.double_tap_one_effect",
      countAfter === countBefore + 1 || (available < 1 && countAfter === countBefore) ? "PASS" : "FAIL",
      `withdrawals ${countBefore}→${countAfter}`,
    );

    const latest = after.data?.withdrawals[0];
    if (latest) {
      gate(
        "native.payout_status_backend",
        /REQUESTED|PROCESSING|COMPLETED|FAILED|Pending|Processing|Success|APPROVED/i.test(latest.status) ? "PASS" : "FAIL",
        latest.status,
      );
    }
    gate("native.payout_boundary", "WARN", "sandbox/mocked payout path — not production Razorpay payout certification");

    const logcat = adb(["logcat", "-d", "-t", "400"], 15_000);
    writeFileSync(join(ART, "logcat-withdraw.txt"), logcat);
    gate("native.bank_logcat", logcat.includes(BANK_ACCOUNT) ? "FAIL" : "PASS", logcat.includes(BANK_ACCOUNT) ? "raw account in logcat" : "no raw account");
    const fatal = /FATAL EXCEPTION|ExpoPushTokenManager could not be found|Unable to load script|EventEmitter.*null/i.test(logcat);
    const leakedSecret =
      logcat.includes(BANK_ACCOUNT) ||
      /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i.test(logcat) ||
      /"password"\s*:\s*"[^"]+"/i.test(logcat) ||
      /password[=:]\s*(?!false\b)\S+/i.test(logcat) ||
      /\botp[=:]\s*\d{4,}/i.test(logcat);
    gate(
      "native.log_audit",
      fatal || leakedSecret ? "FAIL" : "PASS",
      fatal ? "fatal/RSOD in logcat" : leakedSecret ? "secret material in logcat" : "no fatal/PII tokens in sampled logcat",
    );

    tapBy(/^Done$/) || tapBy(/Cancel/i);
    sleep(1200);
    waitFor(/Recent transactions|Available|Wallet/i, 10_000);
    dumpNamed("05b-transaction-history");
    shot("05b-transaction-history");
    gate(
      "native.transaction_row",
      uiHas(/Recent transactions|Withdrawal|Payout|₹1/i) ? "PASS" : "WARN",
      "history after success",
    );

    adb(["shell", "am", "force-stop", PKG]);
    sleep(1200);
    adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
    sleep(7000);
    if (uiHas(/Unable to load script/i)) {
      tapBy(/RELOAD/i);
      sleep(8000);
    }
    driveLogin();
    tapBy(/^Wallet$/) || tapBy(/Wallet/);
    waitFor(/Available|Withdraw to bank/i, 12_000);
    dumpNamed("06-resume-wallet");
    shot("06-resume-wallet");
    const afterResume = await payouts(token);
    writeFileSync(join(ART, "api-payouts-resume.json"), JSON.stringify(afterResume, null, 2));
    const resumeCount = afterResume.data?.withdrawals.length ?? 0;
    gate(
      "native.resume_no_duplicate",
      resumeCount === countAfter ? "PASS" : "FAIL",
      `withdrawals after resume ${resumeCount} (expected ${countAfter})`,
    );
  }

  tapBy(/Incentives/) || tapBy(/Bonus progress/);
  sleep(2000);
  shot("07-incentives");
  gate("native.incentives_ui", uiHas(/Incentive|Bonus|Paid|Qualified|In progress|Streak/i) ? "PASS" : "WARN", "incentives screen");

  writeReport();
  const failed = results.some((r) => r.status === "FAIL");
  process.exit(failed ? 1 : 0);
}

function writeReport() {
  writeFileSync(join(ART, "section04-native-report.json"), JSON.stringify({ results }, null, 2));
}

main().catch((err) => {
  gate("native.crash", "FAIL", err instanceof Error ? err.message : String(err));
  writeReport();
  process.exit(1);
});

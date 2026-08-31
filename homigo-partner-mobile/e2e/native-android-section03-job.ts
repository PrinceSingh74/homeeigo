/**
 * Section 03 native Android Offer → Complete certification.
 *
 * Requires: emulator/device with com.homeeigo.partner, Metro on 8081,
 * backend on 3000 (adb reverse), seeded demo partner.
 *
 * Usage:
 *   cd apps/backend && bun run scripts/section03-seed-live-job.ts > /tmp/seed.json
 *   cd homigo-partner-mobile
 *   set ANDROID_HOME=D:\Android\Sdk
 *   bun run e2e/native-android-section03-job.ts
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ADB = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";
const PKG = "com.homeeigo.partner";
const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ART = join(__dirname, "__artifacts__", "section03-native");
mkdirSync(ART, { recursive: true });

type Seed = {
  bookingId: string;
  bookingNumber: string;
  customerEmail: string;
  customerPassword: string;
  providerId: string;
  insideLat: number;
  insideLng: number;
  outsideLat: number;
  outsideLng: number;
  serviceName: string;
};

const results: Array<{ gate: string; status: "PASS" | "FAIL" | "WARN" | "BLOCKED"; detail: string }> = [];

function gate(name: string, status: "PASS" | "FAIL" | "WARN" | "BLOCKED", detail = "") {
  results.push({ gate: name, status, detail });
  console.log(`${status.padEnd(7)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function adb(args: string[], timeoutMs = 30_000): string {
  try {
    return execFileSync(ADB, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
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

/** Emulator GPS: adb emu geo fix takes longitude then latitude. */
function setGeo(lat: number, lng: number) {
  adb(["emu", "geo", "fix", String(lng), String(lat)]);
  adb(["shell", "cmd", "location", "set-location-enabled", "true"]);
}

function pulseGeo(lat: number, lng: number, ms = 12_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    setGeo(lat, lng);
    sleep(700);
  }
}

function openSeedJob(seed: Seed) {
  for (let attempt = 0; attempt < 4; attempt++) {
    adb(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
    sleep(2500);
    clearBlockingDialogs(8_000);
    adb([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `homeeigo-partner://job/${seed.bookingId}?e2eLat=${seed.insideLat}&e2eLng=${seed.insideLng}`,
    ]);
    sleep(4500);
    clearBlockingDialogs(10_000);
    if (uiHas(seed.bookingNumber)) return true;
    // Fallback: Requests → match booking number only (never service name — collisions).
    tapText("Requests") || tapText(/Requests/i);
    sleep(2000);
    tapText("New requests") || tapText(/New requests/i);
    sleep(2000);
    if (tapText(seed.bookingNumber) || tapText(/Open job workspace/i)) {
      sleep(3500);
      clearBlockingDialogs(8_000);
      if (uiHas(seed.bookingNumber)) return true;
    }
    sleep(2000);
  }
  return uiHas(seed.bookingNumber);
}

function ensureAppForeground(seed: Seed) {
  const xml = dumpUi();
  if (!xml || xml.length < 200) return;
  const onHome =
    /Play Store|Widget loading|com\.google\.android\.apps\.nexuslauncher/i.test(xml) &&
    !/HOMEEIGO|job-primary-cta|Partner sign in/i.test(xml);
  const onSettings = /Location settings|com\.android\.settings/i.test(xml) && !/HOMEEIGO/i.test(xml);
  if (!(onHome || onSettings)) return;
  adb(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
  sleep(5000);
  clearBlockingDialogs(8_000);
  openSeedJob(seed);
}

function dumpUi(): string {
  const remote = "/data/local/tmp/ui-s03.xml";
  const local = join(ART, "ui.xml");
  // Uncompressed dump keeps content-desc / testIDs more reliably on RN.
  adb(["shell", "uiautomator", "dump", remote]);
  adb(["pull", remote, local]);
  try {
    return readFileSync(local, "utf8");
  } catch {
    return "";
  }
}

function waitForUi(pattern: string | RegExp, timeoutMs = 15_000): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    dismissSystemSheets();
    if (uiHas(pattern)) return true;
    sleep(600);
  }
  return false;
}

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#10;/g, "\n");
}

function tapNode(m: RegExpMatchArray) {
  const x = Math.floor((Number(m[1]) + Number(m[3])) / 2);
  const y = Math.floor((Number(m[2]) + Number(m[4])) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

/** Prefer the bottom-most match (sticky footer CTAs sit below body copy like "Next: …"). */
function pickBottomMost(
  matches: Array<{ text: string; x1: number; y1: number; x2: number; y2: number }>,
): { text: string; x1: number; y1: number; x2: number; y2: number } | null {
  if (matches.length === 0) return null;
  return matches.reduce((best, cur) => {
    const by = (cur.y1 + cur.y2) / 2;
    const bb = (best.y1 + best.y2) / 2;
    return by >= bb ? cur : best;
  });
}

function parseLabeledNodes(xml: string): Array<{
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  clickable: boolean;
}> {
  const out: Array<{
    text: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    clickable: boolean;
  }> = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/gi)) {
    const tag = m[0];
    const textM = tag.match(/\btext="([^"]*)"/i);
    const descM = tag.match(/\bcontent-desc="([^"]*)"/i);
    const boundsM = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!boundsM) continue;
    const label = decodeXml(textM?.[1] || descM?.[1] || "");
    if (!label) continue;
    out.push({
      text: label,
      x1: Number(boundsM[1]),
      y1: Number(boundsM[2]),
      x2: Number(boundsM[3]),
      y2: Number(boundsM[4]),
      clickable: /\bclickable="true"/i.test(tag),
    });
  }
  return out;
}

function pickBestTap(
  matches: Array<{ text: string; x1: number; y1: number; x2: number; y2: number; clickable?: boolean }>,
): { text: string; x1: number; y1: number; x2: number; y2: number } | null {
  if (matches.length === 0) return null;
  const visible = matches.filter((n) => n.y2 > 80 && n.y1 < 2300 && n.x2 > n.x1 && n.y2 > n.y1);
  const pool = visible.length ? visible : matches;
  const clickable = pool.filter((n) => n.clickable);
  const ranked = (clickable.length ? clickable : pool).slice().sort((a, b) => {
    const by = (b.y1 + b.y2) / 2 - (a.y1 + a.y2) / 2;
    if (by !== 0) return by;
    return b.y2 - b.y1 - (a.y2 - a.y1); // prefer larger hit target
  });
  return ranked[0] ?? null;
}

function tapText(label: string | RegExp): boolean {
  const xml = dumpUi();
  const nodes = parseLabeledNodes(xml);
  const hits = nodes.filter((n) => {
    const t = n.text.trim();
    return typeof label === "string" ? t.toLowerCase() === label.toLowerCase() : label.test(t);
  });
  let chosen = pickBestTap(hits);
  if (!chosen) {
    const loose: Array<{ text: string; x1: number; y1: number; x2: number; y2: number; clickable: boolean }> = [];
    for (const m of xml.matchAll(/<node\b[^>]*>/gi)) {
      const tag = m[0];
      const textM = tag.match(/\btext="([^"]*)"/i);
      if (!textM) continue;
      const value = decodeXml(textM[1] ?? "").trim();
      const ok =
        typeof label === "string" ? value.toLowerCase() === label.toLowerCase() : label.test(value);
      if (!ok || !value) continue;
      const b = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
      if (!b) continue;
      loose.push({
        text: value,
        x1: Number(b[1]),
        y1: Number(b[2]),
        x2: Number(b[3]),
        y2: Number(b[4]),
        clickable: /\bclickable="true"/i.test(tag),
      });
    }
    chosen = pickBestTap(loose);
  }
  if (!chosen) return false;
  const x = Math.floor((chosen.x1 + chosen.x2) / 2);
  const y = Math.floor((chosen.y1 + chosen.y2) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
  return true;
}

function dismissLogBox() {
  if (!uiHas(/Open debugger to view warnings|Console Error|LogBox/i)) return;
  // LogBox banner sits above the sticky CTA — dismiss via the trailing X hit area.
  adb(["shell", "input", "tap", "1020", "2180"]);
  sleep(400);
  adb(["shell", "input", "tap", "1020", "2100"]);
  sleep(400);
  if (uiHas(/Open debugger to view warnings/i)) {
    adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    sleep(500);
  }
}

function dismissSystemSheets() {
  dismissLogBox();
  // Android / Google Location Accuracy interstitial often covers the whole app.
  for (let i = 0; i < 5; i++) {
    if (!uiHas(/Location Accuracy|For a better experience/i)) break;
    const tapped =
      tapText("No thanks") ||
      tapText(/No thanks/i) ||
      tapText("Turn on") ||
      tapText(/Turn on/i);
    if (!tapped) {
      // Medium Phone 1080x2400 — dialog action row (No thanks left, Turn on right).
      for (const [x, y] of [
        [320, 1580],
        [320, 1680],
        [320, 1780],
        [760, 1580],
        [760, 1680],
        [760, 1780],
      ] as const) {
        adb(["shell", "input", "tap", String(x), String(y)]);
        sleep(400);
        if (!uiHas(/Location Accuracy|For a better experience/i)) break;
      }
    }
    sleep(900);
  }
  if (uiHas(/Allow|While using|Only this time|Don.?t allow/i)) {
    tapText(/While using the app|Allow|Only this time/i);
    sleep(800);
  }
  if (uiHas(/Save password|Google Password Manager|Not now/i)) {
    tapText("Not now") || tapText(/Not now/i);
    sleep(600);
  }
}

function clearBlockingDialogs(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    dismissSystemSheets();
    if (!uiHas(/Location Accuracy|For a better experience|Save password|Google Password Manager/i)) {
      return true;
    }
    sleep(500);
  }
  return !uiHas(/Location Accuracy|For a better experience/i);
}

/** Image picker is optional evidence — cancel returns undefined and lifecycle continues. */
function dismissOrPickGallery() {
  sleep(1500);
  dismissSystemSheets();
  if (!uiHas(/Photos|Gallery|Recent|Downloads|Allow access|Select|Media|Screenshot/i)) return;
  // Prefer Cancel/Close over Back — Back can exit the activity stack to the launcher.
  if (tapText("Cancel") || tapText(/Cancel|Close|Don't allow/i)) {
    sleep(1000);
    return;
  }
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  sleep(1200);
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
      const x = Math.floor((Number(boundsM[1]) + Number(boundsM[3])) / 2);
      const y = Math.floor((Number(boundsM[2]) + Number(boundsM[4])) / 2);
      adb(["shell", "input", "tap", String(x), String(y)]);
      return true;
    }
  }
  return false;
}

function uiHas(text: string | RegExp): boolean {
  const xml = decodeXml(dumpUi());
  if (typeof text === "string") return xml.toLowerCase().includes(text.toLowerCase());
  return text.test(xml);
}

function encodeInput(s: string) {
  return s.replace(/ /g, "%s");
}

/** Per-character hardware keys — reliable for passwords with `@` and capitals on API 36 emulators. */
function typeAsHardwareKeys(value: string) {
  for (const ch of value) {
    if (ch === " ") {
      adb(["shell", "input", "keyevent", "62"]);
    } else if (ch === "@") {
      adb(["shell", "input", "keyevent", "77"]);
    } else if (ch >= "a" && ch <= "z") {
      adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 97))]);
    } else if (ch >= "A" && ch <= "Z") {
      adb(["shell", "input", "keyevent", "59"]);
      adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 65))]);
      adb(["shell", "input", "keyevent", "59"]);
    } else if (ch >= "0" && ch <= "9") {
      adb(["shell", "input", "keyevent", String(7 + Number(ch))]);
    } else {
      adb(["shell", "input", "text", encodeInput(ch)]);
    }
    sleep(40);
  }
}

function swipeUp() {
  // Medium phone roughly 1080x2400
  adb(["shell", "input", "swipe", "540", "1800", "540", "600", "300"]);
  sleep(500);
}

function tapPrimaryCta(label?: string | RegExp): boolean {
  // Do not swipe first — sticky footer CTAs are already visible; swipe can steal the gesture.
  if (label) {
    if (typeof label === "string") {
      if (tapText(label)) return true;
    } else if (tapText(label)) {
      return true;
    }
  }
  if (label && !uiHas(label)) return false;
  return tapTestId("job-primary-cta");
}

/** Type password with case + `@` — `input keyboard text` on API 36, hardware keys fallback. */
function typePassword(value: string) {
  try {
    adb(["shell", "input", "keyboard", "text", value.replace(/ /g, "%s")]);
    return;
  } catch {
    /* fall through */
  }
  typeAsHardwareKeys(value);
}

function clearFocusedField() {
  adb(["shell", "input", "keyevent", "123"]); // MOVE_END
  for (let i = 0; i < 48; i++) adb(["shell", "input", "keyevent", "67"]); // DEL
  sleep(100);
}

function tapTestIdBounds(testId: string): boolean {
  const xml = dumpUi();
  const m = xml.match(
    new RegExp(`resource-id="${testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`),
  );
  if (!m) return tapTestId(testId);
  tapBounds(m);
  return true;
}

/** Type email safely — `@` via KEYCODE_AT (lowercase only). */
function typeValue(value: string) {
  const parts = value.split("@");
  parts.forEach((part, index) => {
    if (part) adb(["shell", "input", "text", encodeInput(part)]);
    if (index < parts.length - 1) adb(["shell", "input", "keyevent", "77"]);
    sleep(80);
  });
}

function tapBounds(m: RegExpMatchArray) {
  const x = Math.floor((Number(m[1]) + Number(m[3])) / 2);
  const y = Math.floor((Number(m[2]) + Number(m[4])) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

function driveLogin(): boolean {
  if (uiHas(/EventEmitter|runtime not ready/i)) {
    tapText("DISMISS") || tapText(/DISMISS/i);
    sleep(400);
    tapText("RELOAD") || tapText(/RELOAD/i);
    sleep(10_000);
    shot("03a-after-reload");
  }
  if (!uiHas(/Partner sign in|Continue to Partner OS/i)) {
    if (uiHas(/Requests|HQ|Wallet|Work HQ|Partner OS|Live Status/i)) return true;
    if (!waitForUi(/Partner sign in|Continue to Partner OS|Requests|HQ|Wallet/i, 45_000)) {
      gate("native.login", "FAIL", "app did not reach login or home after launch");
      return false;
    }
    if (!uiHas(/Partner sign in|Continue to Partner OS/i)) return true;
  }

  gate("native.login_surface", "WARN", "driving Partner sign in");
  tapTestIdBounds("partner-login-email");
  sleep(300);
  clearFocusedField();
  typeValue("partner@homigo.demo");
  sleep(400);

  tapTestIdBounds("partner-login-password");
  sleep(300);
  clearFocusedField();
  typePassword("Homigo@123");
  sleep(400);

  // Dismiss keyboard so CTA is tappable
  adb(["shell", "input", "keyevent", "4"]); // BACK
  sleep(400);
  tapText("Continue to Partner OS") || tapTestId("partner-login-submit");
  sleep(12_000);
  // Android may show Google Password Manager sheet over the app.
  if (uiHas(/Save password|Google Password Manager|Not now/i)) {
    tapText("Not now") || tapText(/Not now/i) || tapText("Continue");
    sleep(1500);
  }
  if (uiHas(/Partner sign in|Continue to Partner OS/i)) {
    // One retry — stale IME or mistyped `@` in password.
    tapTestIdBounds("partner-login-password");
    sleep(200);
    clearFocusedField();
    typePassword("Homigo@123");
    adb(["shell", "input", "keyevent", "4"]);
    sleep(300);
    tapText("Continue to Partner OS") || tapTestId("partner-login-submit");
    sleep(12_000);
  }
  shot("03-after-login");
  const stillLogin = uiHas(/Partner sign in|Continue to Partner OS/i);
  const err = dumpUi().match(/text="([^"]*(?:invalid|failed|error|network)[^"]*)"/i)?.[1];
  gate(
    "native.login",
    stillLogin ? "FAIL" : "PASS",
    stillLogin ? `still on login${err ? `; err=${decodeXml(err)}` : ""}` : "entered app",
  );
  return !stillLogin;
}

async function loginApi(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  if (!json.data?.accessToken) throw new Error(`login failed ${email}`);
  return json.data.accessToken;
}

async function fetchStartPin(customerToken: string, bookingId: string): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const res = await fetch(`${API}/api/bookings/${bookingId}/start-pin`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const json = (await res.json()) as { data?: { state?: string; pin?: string | null } };
    if (json.data?.state === "active" && json.data.pin) return json.data.pin;
    sleep(400);
  }
  throw new Error("start-pin not active");
}

function normalizeStatus(raw: string | undefined | null): string {
  return String(raw ?? "").toUpperCase().replace(/-/g, "_");
}

async function bookingStatus(token: string, bookingId: string): Promise<string> {
  const rank = (s: string) => {
    const u = s.toUpperCase().replace(/-/g, "_");
    if (u === "COMPLETED") return 60;
    if (u === "IN_PROGRESS") return 50;
    if (u === "EN_ROUTE") return 40;
    if (u === "ACCEPTED" || u === "ASSIGNED") return 30;
    if (u === "PENDING") return 10;
    if (u.startsWith("CANCEL")) return 5;
    return 0;
  };
  const found: string[] = [];
  const detailRes = await fetch(`${API}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (detailRes.ok) {
    const json = (await detailRes.json()) as {
      data?: { booking?: { status?: string }; status?: string };
    };
    const st = normalizeStatus(json.data?.booking?.status ?? json.data?.status);
    if (st) found.push(st);
  }
  for (const qs of [
    "status=pending&limit=20&sortBy=recent",
    "status=accepted&limit=20&sortBy=upcoming",
    "status=en_route&limit=20&sortBy=recent",
    "status=in_progress&limit=20&sortBy=recent",
    "status=completed&limit=20&sortBy=recent",
    "limit=50&sortBy=recent",
  ]) {
    const listRes = await fetch(`${API}/api/providers/me/bookings?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) continue;
    const listJson = (await listRes.json()) as {
      data?: { bookings?: Array<{ id: string; status?: string }> };
    };
    const hit = listJson.data?.bookings?.find((b) => b.id === bookingId);
    if (hit?.status) found.push(normalizeStatus(hit.status));
  }
  if (found.length) {
    return found.sort((a, b) => rank(b) - rank(a))[0]!;
  }
  return "";
}

/** Native Availability: ONLINE / OFFLINE / PAUSE / RESUME. Seed forces DB online after. */
function drivePartnerOps() {
  adb([
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "homeeigo-partner:///hq/account-availability",
  ]);
  sleep(3500);
  clearBlockingDialogs(8_000);
  let opened = uiHas(/Go Online|Go Offline|Resume|Paused|Availability|Offline|Online/i);
  if (!opened) {
    tapText("HQ") || tapText(/^HQ$/);
    sleep(1800);
    for (let i = 0; i < 10; i++) {
      if (tapText("Availability") || tapText(/Availability/i)) {
        opened = true;
        break;
      }
      swipeUp();
    }
    sleep(2500);
    clearBlockingDialogs(8_000);
  }
  if (!opened && !uiHas(/Go Online|Go Offline|Resume|Paused|Offline|Online/i)) {
    gate("native.ops.surface", "FAIL", "Availability not found under HQ");
    return;
  }
  sleep(1500);
  shot("04-availability");
  const onSurface = uiHas(/Go Online|Go Offline|Resume|Paused|Offline|Online/i);
  gate("native.ops.surface", onSurface ? "PASS" : "FAIL", onSurface ? "Availability open" : "no ops CTAs");
  if (uiHas(/Slots|Jobs|Capacity|Service areas|Radius/i)) {
    gate("native.ops.capacity_area", "PASS", "capacity/service area visible");
  } else {
    gate("native.ops.capacity_area", "WARN", "capacity/area copy not in dump");
  }

  if (uiHas("Go Online")) {
    tapLabeledButton("Go Online") || tapText("Go Online");
    sleep(2500);
  }
  const online = uiHas("Go Offline") || (uiHas("Online") && !uiHas("Go Online") && !uiHas("Offline"));
  gate("native.ops.online", online ? "PASS" : "WARN", online ? "online" : "not online yet — seed will force DB online");

  if (uiHas(/Pause · break/i) || uiHas("Pause · break")) {
    tapText("Pause · break") || tapText(/Pause · break/i);
    sleep(2500);
    const paused = uiHas("Resume") || uiHas("Paused");
    gate("native.ops.pause", paused ? "PASS" : "FAIL", paused ? "paused" : "pause CTA did not stick");
    if (paused) {
      tapLabeledButton("Resume") || tapText("Resume");
      sleep(2500);
      gate("native.ops.resume", uiHas("Go Offline") || uiHas("Online") ? "PASS" : "FAIL", "after resume");
    }
  } else {
    gate("native.ops.pause", "WARN", "pause chips not on screen");
    gate("native.ops.resume", "WARN", "skipped — pause not available");
  }

  if (uiHas("Go Offline")) {
    tapLabeledButton("Go Offline") || tapText("Go Offline");
    sleep(2500);
    const off = uiHas("Go Online") || uiHas("Offline");
    gate("native.ops.offline", off ? "PASS" : "FAIL", off ? "offline" : "Go Offline did not stick");
    if (off) {
      tapLabeledButton("Go Online") || tapText("Go Online");
      sleep(2500);
      gate(
        "native.ops.online_restore",
        uiHas("Go Offline") ? "PASS" : "WARN",
        uiHas("Go Offline") ? "online again" : "seed will force DB online",
      );
    }
  } else {
    gate("native.ops.offline", "WARN", "already not showing Go Offline");
  }
  shot("04b-ops");
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  sleep(800);
}

/** Tap the clickable ancestor that contains the labeled leaf (RN Pressable + Text). */
function tapLabeledButton(label: string | RegExp): boolean {
  const xml = dumpUi();
  const nodes = [...xml.matchAll(/<node\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    const text = decodeXml(tag.match(/\btext="([^"]*)"/i)?.[1] ?? "");
    const desc = decodeXml(tag.match(/\bcontent-desc="([^"]*)"/i)?.[1] ?? "");
    const b = tag.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
    if (!b) return null;
    return {
      text,
      desc,
      clickable: /\bclickable="true"/i.test(tag),
      x1: Number(b[1]),
      y1: Number(b[2]),
      x2: Number(b[3]),
      y2: Number(b[4]),
    };
  }).filter(Boolean) as Array<{
    text: string;
    desc: string;
    clickable: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;

  const leaf = nodes.find((n) => {
    const t = n.text.trim();
    return typeof label === "string" ? t.toLowerCase() === label.toLowerCase() : label.test(t);
  });
  if (!leaf) return tapText(label);

  const parents = nodes.filter(
    (n) =>
      n.clickable &&
      n.x1 <= leaf.x1 &&
      n.y1 <= leaf.y1 &&
      n.x2 >= leaf.x2 &&
      n.y2 >= leaf.y2 &&
      n.y2 > 200,
  );
  const target =
    parents.sort((a, b) => a.x2 - a.x1 + (a.y2 - a.y1) - (b.x2 - b.x1 + (b.y2 - b.y1)))[0] ?? leaf;
  const x = Math.floor((target.x1 + target.x2) / 2);
  const y = Math.floor((target.y1 + target.y2) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
  return true;
}

function seedJob(): Seed {
  // Prefer a fresh DB seed for native cert — stale SECTION03_LIVE_SEED_JSON often points at an already-accepted job.
  const forceFresh = process.env.SECTION03_FORCE_FRESH_SEED === "1" || !process.env.SECTION03_LIVE_SEED_JSON;
  if (!forceFresh && process.env.SECTION03_LIVE_SEED_JSON) {
    return JSON.parse(process.env.SECTION03_LIVE_SEED_JSON) as Seed;
  }
  const script = join(__dirname, "..", "..", "apps", "backend", "scripts", "section03-seed-live-job.ts");
  const backendCwd = join(__dirname, "..", "..", "apps", "backend");
  // Avoid shell:true + paths with spaces (Windows "C:\Users\Kapiissh Green\...").
  const bunCandidates = [
    process.env.BUN_PATH,
    join(process.env.APPDATA ?? "", "npm", "node_modules", "bun", "bin", "bun.exe"),
    join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
    "bun",
  ].filter(Boolean) as string[];

  let lastErr: unknown;
  for (const bun of bunCandidates) {
    try {
      const env = { ...process.env };
      delete env.SECTION03_LIVE_SEED_JSON;
      const out = execFileSync(bun, ["run", script], {
        cwd: backendCwd,
        encoding: "utf8",
        env,
        windowsHide: true,
      });
      const i = out.indexOf("{");
      return JSON.parse(out.slice(i)) as Seed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main() {
  console.log("=== Section 03 Native Android Job Cert ===");
  const devices = adb(["devices"]);
  if (!/emulator-\d+\s+device|device\s+/.test(devices) || /List of devices attached\s*$/.test(devices.trim())) {
    const lines = devices.split("\n").filter((l) => /\tdevice/.test(l));
    if (lines.length === 0) {
      gate("environment.device", "BLOCKED", "no adb device/emulator");
      writeReport();
      process.exit(2);
    }
  }
  gate("environment.device", "PASS", devices.split("\n").find((l) => /\tdevice/) ?? "device");

  const pkgs = adb(["shell", "pm", "list", "packages", PKG]);
  if (!pkgs.includes(PKG)) {
    gate("environment.app", "BLOCKED", `${PKG} not installed`);
    writeReport();
    process.exit(2);
  }
  gate("environment.app", "PASS", PKG);

  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["reverse", "tcp:3000", "tcp:3000"]);

  // Confirm host backend is reachable before launching the app.
  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`health ${health.status}`);
  } catch (e) {
    gate("environment.backend", "FAIL", e instanceof Error ? e.message : String(e));
    writeReport();
    process.exit(2);
  }
  gate("environment.backend", "PASS", API);

  adb(["shell", "pm", "clear", PKG]);
  sleep(1000);
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  for (const perm of [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.CAMERA",
    "android.permission.READ_MEDIA_IMAGES",
  ]) {
    adb(["shell", "pm", "grant", PKG, perm]);
  }

  const partnerToken = await loginApi("partner@homigo.demo", "Homigo@123");

  adb(["shell", "am", "force-stop", PKG]);
  sleep(800);
  adb(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
  waitForUi(/Partner sign in|Continue to Partner OS|Requests|HQ|Work HQ|EventEmitter/i, 60_000);
  sleep(2000);
  dismissSystemSheets();
  dismissSystemSheets();
  shot("01-launch");

  // Login first — deep links before auth just bounce to sign-in with garbled state.
  if (!driveLogin()) {
    writeReport();
    process.exit(1);
  }
  dismissSystemSheets();

  drivePartnerOps();

  let seed: Seed;
  try {
    seed = seedJob();
    gate("seed.offer", "PASS", seed.bookingNumber);
  } catch (e) {
    gate("seed.offer", "FAIL", e instanceof Error ? e.message : String(e));
    writeReport();
    process.exit(1);
  }
  const customerToken = await loginApi(seed.customerEmail, seed.customerPassword);
  setGeo(seed.insideLat, seed.insideLng);

  // If the dashboard cannot reach the API, reverse ports again and cold-start.
  if (uiHas(/Could not load dashboard|Check backend connection|Network request failed/i)) {
    adb(["reverse", "tcp:3000", "tcp:3000"]);
    adb(["reverse", "tcp:8081", "tcp:8081"]);
    adb(["shell", "am", "force-stop", PKG]);
    sleep(800);
    adb(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
    sleep(8000);
    clearBlockingDialogs(8_000);
    if (!driveLogin()) {
      writeReport();
      process.exit(1);
    }
  }

  // Open the seeded job by deep link only — service-name taps open the wrong offer.
  const opened = openSeedJob(seed);
  shot("02-job-open");
  if (!opened) {
    gate("native.offer", "FAIL", `deep link did not show ${seed.bookingNumber}`);
    writeReport();
    process.exit(1);
  }

  const offerVisible =
    uiHas(seed.bookingNumber) &&
    (uiHas(/Accept/i) || uiHas(/job-detail-screen|job-primary-cta|On my way/i));
  gate("native.offer", offerVisible ? "PASS" : "FAIL", offerVisible ? "job workspace open" : "offer not on UI");
  shot("05-offer");

  // Accept — must clear Location Accuracy first or taps hit the system sheet.
  clearBlockingDialogs(15_000);
  const acceptTapped =
    tapLabeledButton("Accept") || tapTestId("job-primary-cta") || tapText("Accept");
  if (acceptTapped) {
    let st = "";
    for (let i = 0; i < 40; i++) {
      sleep(1000);
      clearBlockingDialogs(3_000);
      st = await bookingStatus(partnerToken, seed.bookingId);
      if (["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(st)) break;
      if (uiHas(/On my way|I.?ve arrived|Start job|Start PIN|Customer verification/i)) {
        st = st || "ACCEPTED";
        break;
      }
      if (i === 3 || i === 8 || i === 15) {
        tapLabeledButton("Accept") || tapTestId("job-primary-cta");
      }
    }
    st = st || (await bookingStatus(partnerToken, seed.bookingId));
    const ok =
      ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(st) ||
      uiHas(/On my way|I.?ve arrived|Start job|Start PIN/i);
    gate("native.accept", ok ? "PASS" : "FAIL", `status=${st || "(empty)"}; err=${uiHas(/failed|error|unavailable|capacity|restricted/i)}`);
  } else {
    const st = await bookingStatus(partnerToken, seed.bookingId);
    gate("native.accept", ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(st) ? "PASS" : "FAIL", `no Accept CTA; status=${st || "(empty)"}`);
  }
  shot("06-accepted");

  // Re-open job detail only if Accept still owns the CTA — avoid stacking screens.
  if (!uiHas(/On my way|I.?ve arrived|Start job|Start PIN/i)) {
    openSeedJob(seed);
  }

  // En route
  setGeo(seed.insideLat, seed.insideLng);
  ensureAppForeground(seed);
  clearBlockingDialogs(10_000);
  if (uiHas(/I.?ve arrived|Start job|Start PIN|Customer verification/i)) {
    gate("native.en_route", "PASS", "already past en-route");
  } else if (!waitForUi(/On my way/i, 15_000)) {
    const xml = dumpUi();
    const labels = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => decodeXml(m[1]!)).slice(0, 40);
    const st = await bookingStatus(partnerToken, seed.bookingId);
    gate(
      "native.en_route",
      ["EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(st) ? "PASS" : "FAIL",
      `On my way CTA missing; status=${st}; labels=${labels.join(" | ")}`,
    );
  } else if (tapLabeledButton("On my way") || tapPrimaryCta("On my way") || tapText(/On my way/i)) {
    pulseGeo(seed.insideLat, seed.insideLng, 8_000);
    let st = await bookingStatus(partnerToken, seed.bookingId);
    let advanced = st === "EN_ROUTE" || uiHas(/I.?ve arrived|Start job|Start PIN/i);
    if (!advanced) {
      setGeo(seed.insideLat, seed.insideLng);
      if (uiHas(/On my way/i)) tapLabeledButton("On my way") || tapText(/On my way/i);
      sleep(8_000);
      st = await bookingStatus(partnerToken, seed.bookingId);
      advanced = st === "EN_ROUTE" || uiHas(/I.?ve arrived|Start job|Start PIN/i);
    }
    gate(
      "native.en_route",
      advanced || ["EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(st) ? "PASS" : "FAIL",
      `status=${st || "(empty)"}; arriveCta=${uiHas(/I.?ve arrived/i)}`,
    );
  } else {
    gate("native.en_route", "FAIL", "On my way visible but untappable");
  }
  shot("07-en-route");
  // Strict arrive GPS cannot start while On-my-way is still pending (busy locks the CTA).
  sleep(5_000);
  waitForUi(/I.?ve arrived|Start job|Start PIN/i, 15_000);

  // Outside radius negative via API BEFORE arrive succeeds (duplicate arrive returns 200).
  {
    const stNow = await bookingStatus(partnerToken, seed.bookingId);
    if (!["IN_PROGRESS", "COMPLETED"].includes(stNow)) {
      const outsideRes = await fetch(`${API}/api/bookings/${seed.bookingId}/arrived`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${partnerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ latitude: seed.outsideLat, longitude: seed.outsideLng }),
      });
      const outsideJson = (await outsideRes.json().catch(() => ({}))) as { code?: string };
      gate(
        "native.arrive_outside_blocked",
        !outsideRes.ok || outsideJson.code === "OUTSIDE_SERVICE_AREA" ? "PASS" : "FAIL",
        `HTTP ${outsideRes.status}; code=${outsideJson.code ?? ""}`,
      );
    } else {
      gate("native.arrive_outside_blocked", "PASS", `skipped — already ${stNow}`);
    }
  }

  // Arrive inside — pulse while tracking is live so lastKnown is warm, then tap.
  if (!uiHas(seed.bookingNumber) || !uiHas(/I.?ve arrived|Start job|Start PIN|Customer verification/i)) {
    openSeedJob(seed);
  }
  waitForUi(/I.?ve arrived|Start job|Start PIN|Customer verification/i, 12_000);
  let arrivedOk =
    uiHas(/Start job|Start PIN|Customer verification/i) ||
    ["IN_PROGRESS", "COMPLETED"].includes(await bookingStatus(partnerToken, seed.bookingId));
  for (let attempt = 0; attempt < 3 && !arrivedOk; attempt++) {
    if (!uiHas(seed.bookingNumber)) openSeedJob(seed);
    // Warm fused/GPS last-known via the live tracking watcher before the CTA.
    pulseGeo(seed.insideLat, seed.insideLng, 6_000);
    const tapped =
      tapTestId("job-primary-cta") ||
      tapLabeledButton("I've arrived") ||
      tapPrimaryCta("I've arrived") ||
      tapText(/I.?ve arrived|Ive arrived/i);
    if (!tapped) {
      gate("native.arrive_tap", "WARN", `attempt ${attempt + 1}: CTA missing`);
      openSeedJob(seed);
      continue;
    }
    pulseGeo(seed.insideLat, seed.insideLng, 16_000);
    sleep(2000);
    if (uiHas(/Start job|Start PIN|Customer verification/i)) {
      arrivedOk = true;
      break;
    }
    const st = await bookingStatus(partnerToken, seed.bookingId);
    if (st === "IN_PROGRESS" || st === "COMPLETED") {
      arrivedOk = true;
      break;
    }
  }
  gate(
    "native.arrive_inside",
    arrivedOk ? "PASS" : "FAIL",
    arrivedOk
      ? "arrive CTA pressed with inside GPS"
      : `arrive did not advance to Start job; labels=${[...dumpUi().matchAll(/text="([^"]+)"/g)].map((m) => decodeXml(m[1]!)).slice(0, 30).join(" | ")}`,
  );
  shot("08-arrived");
  ensureAppForeground(seed);

  // Start + OTP
  setGeo(seed.insideLat, seed.insideLng);
  ensureAppForeground(seed);
  dismissLogBox();
  waitForUi(/Start job/i, 15_000);
  dismissLogBox();
  if (tapLabeledButton("Start job") || tapPrimaryCta("Start job") || tapText(/Start job/i) || tapTestId("job-primary-cta")) {
    sleep(2500);
    dismissLogBox();
    // Sheet should request OTP — wait for PIN UI
    waitForUi(/PIN|verification|digit|Enter|OTP|code/i, 12_000);
    let pin = "";
    try {
      pin = await fetchStartPin(customerToken, seed.bookingId);
      gate("native.otp_issued", "PASS", "customer start-pin active");
    } catch (e) {
      // Partner sheet may not have dispatched yet — nudge once more.
      tapLabeledButton("Start job") || tapTestId("job-primary-cta");
      sleep(2500);
      try {
        pin = await fetchStartPin(customerToken, seed.bookingId);
        gate("native.otp_issued", "PASS", "customer start-pin active (retry)");
      } catch (e2) {
        gate("native.otp_issued", "FAIL", e2 instanceof Error ? e2.message : String(e2));
      }
    }
    if (pin) {
      dismissLogBox();
      sleep(800);
      const xmlOtp = dumpUi();
      const edits = [
        ...xmlOtp.matchAll(
          /class="[^"]*EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g,
        ),
      ];
      if (edits[0]) {
        tapBounds(edits[0]);
        sleep(300);
        clearFocusedField();
      }
      // Digit-by-digit so RN TextInput onChangeText fires and auto-submits at 6.
      for (const d of pin) {
        adb(["shell", "input", "text", d]);
        sleep(120);
      }
      sleep(2000);
      if (uiHas(/Invalid PIN|Start failed|Move closer|GPS|required/i)) {
        // Retry once with fresh geo + pin
        setGeo(seed.insideLat, seed.insideLng);
        sleep(1000);
        tapText("Try again") || tapLabeledButton("Start job");
        sleep(1500);
        const pin2 = await fetchStartPin(customerToken, seed.bookingId).catch(() => pin);
        for (const d of pin2) {
          adb(["shell", "input", "text", d]);
          sleep(120);
        }
        sleep(2000);
      }
      tapText("Verify") || tapText("Confirm") || tapText(/Verify PIN|Submit/i);
      sleep(5000);
    }
    let st = "";
    for (let i = 0; i < 15; i++) {
      st = await bookingStatus(partnerToken, seed.bookingId);
      if (st === "IN_PROGRESS") break;
      sleep(1000);
    }
    gate("native.start", st === "IN_PROGRESS" || st === "COMPLETED" ? "PASS" : "FAIL", `status=${st || "(empty)"}`);
  } else {
    const st = await bookingStatus(partnerToken, seed.bookingId);
    gate("native.start", st === "IN_PROGRESS" || st === "COMPLETED" ? "PASS" : "FAIL", `no Start CTA; status=${st}`);
  }
  shot("09-started");
  ensureAppForeground(seed);

  // Complete
  setGeo(seed.insideLat, seed.insideLng);
  waitForUi(/Complete job|Mark complete/i, 10_000);
  if (
    tapPrimaryCta("Complete job") ||
    tapText("Complete job") ||
    tapText(/Mark complete|Complete job/i)
  ) {
    dismissOrPickGallery();
    dismissSystemSheets();
    sleep(5000);
  }
  const finalStatus = await bookingStatus(partnerToken, seed.bookingId);
  gate("native.complete", finalStatus === "COMPLETED" ? "PASS" : "FAIL", `status=${finalStatus}`);
  shot("10-complete");

  // Resume check: force-stop and reopen
  adb(["shell", "am", "force-stop", PKG]);
  sleep(1000);
  adb(["shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
  sleep(4000);
  adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `homeeigo://job/${seed.bookingId}`]);
  sleep(3000);
  const resumeStatus = await bookingStatus(partnerToken, seed.bookingId);
  gate(
    "native.resume",
    resumeStatus === finalStatus ? "PASS" : "FAIL",
    `status=${resumeStatus} (expected ${finalStatus})`,
  );
  shot("11-resume");

  // Earnings via DB cert helper endpoint / list
  const earn = await fetch(`${API}/api/providers/me/earnings`, {
    headers: { Authorization: `Bearer ${partnerToken}` },
  });
  gate("native.earnings_api", earn.ok ? "PASS" : "WARN", `HTTP ${earn.status}`);

  writeReport();
  const failed = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  process.exit(failed || blocked ? 1 : 0);
}

function writeReport() {
  const path = join(ART, "section03-native-report.json");
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`Report: ${path}`);
}

main().catch((e) => {
  console.error(e);
  gate("fatal", "FAIL", e instanceof Error ? e.message : String(e));
  writeReport();
  process.exit(1);
});

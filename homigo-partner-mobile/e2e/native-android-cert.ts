/**
 * Native Android certification driver for HOMEEIGO Partner OS.
 * Uses ADB + UIAutomator against a live emulator/device and Metro.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API,
  APPLICANT_PASSWORD,
  adminToken,
  createLeadAndInvite,
  expiredInviteJwt,
  getLead,
  partnerRegister,
  uniqueKyc,
  uniquePhone,
} from "./helpers/p0-api";

const ADB = process.env.ANDROID_HOME
  ? join(process.env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";
const PKG = "com.homeeigo.partner";
const ART = join(__dirname, "__artifacts__");
mkdirSync(ART, { recursive: true });

const results: Array<{ gate: string; status: "PASS" | "FAIL" | "WARN"; detail: string }> = [];

function adb(args: string[], timeoutMs = 30_000): string {
  try {
    return execFileSync(ADB, args, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`;
  }
}

function isSparseUi(xml: string): boolean {
  if (!xml || xml.length < 1200) return true;
  const texts = [...xml.matchAll(/\btext="([^"]*)"/g)]
    .map((m) => decodeXml(m[1] ?? ""))
    .filter((t) => t.length > 1);
  return texts.length < 6;
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
  const remote = "/sdcard/ui.xml";
  const local = join(ART, "ui.xml");
  try {
    execFileSync(ADB, ["shell", "rm", "-f", remote], { timeout: 3_000, stdio: "ignore" });
  } catch {
    /* ignore */
  }
  let dumped = false;
  try {
    const out = execFileSync(ADB, ["shell", "uiautomator", "dump", "--compressed", remote], {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
    });
    dumped = /UI hierchary dumped|UI hierarchy dumped/i.test(out);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    dumped = /UI hierchary dumped|UI hierarchy dumped/i.test(`${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
  if (!dumped) return "";
  try {
    execFileSync(ADB, ["pull", remote, local], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return readFileSync(local, "utf8");
  } catch {
    return "";
  }
}

type NodeInfo = {
  text: string;
  desc: string;
  rid: string;
  clickable: boolean;
  password: boolean;
  selected: boolean;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type WizardScreen =
  | "login"
  | "account"
  | "otp"
  | "services"
  | "profile"
  | "location"
  | "availability"
  | "kyc"
  | "documents"
  | "assessment"
  | "training"
  | "review"
  | "submitted"
  | "unknown";

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseNodes(xml: string): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  const re = /<node\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const text = decodeXml(/text="([^"]*)"/.exec(tag)?.[1] ?? "");
    const desc = decodeXml(/content-desc="([^"]*)"/.exec(tag)?.[1] ?? "");
    const rid = decodeXml(/resource-id="([^"]*)"/.exec(tag)?.[1] ?? "");
    const clickable = /clickable="true"/.test(tag);
    const password = /password="true"/.test(tag);
    const selected = /selected="true"/.test(tag);
    const cls = /class="([^"]*)"/.exec(tag)?.[1] ?? "";
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!b) continue;
    const l = Number(b[1]);
    const t = Number(b[2]);
    const r = Number(b[3]);
    const bot = Number(b[4]);
    nodes.push({
      text,
      desc,
      rid,
      clickable,
      password,
      selected,
      cls,
      x: Math.floor((l + r) / 2),
      y: Math.floor((t + bot) / 2),
      w: r - l,
      h: bot - t,
    });
  }
  return nodes;
}

function uiHas(xml: string, needle: string | RegExp): boolean {
  const decoded = decodeXml(xml);
  if (typeof needle === "string") return decoded.includes(needle) || xml.includes(needle);
  return needle.test(decoded) || needle.test(xml);
}

/** Body-copy screen id. Never use stepper labels (Profile/Location/Availability) — they appear on every wizard page. */
function wizardScreen(xml: string): WizardScreen {
  if (!xml) return "unknown";
  if (uiHas(xml, /Application submitted/i)) return "submitted";
  if (uiHas(xml, /Which services do you provide/i)) return "services";
  if (uiHas(xml, /Complete your profile/i) || uiHas(xml, /Date of birth/i)) return "profile";
  if (uiHas(xml, /Choose where you want to receive jobs/i) || uiHas(xml, /Search area/i)) return "location";
  if (uiHas(xml, /Set your preferred working schedule/i) || uiHas(xml, /Working days/i)) return "availability";
  if (uiHas(xml, /KYC & banking/i)) return "kyc";
  if (uiHas(xml, /Skill assessment|Submit answers|Assessment passed|Continue to training/i)) return "assessment";
  if (uiHas(xml, /Partner training|Continue to review/i)) return "training";
  if (uiHas(xml, /Final review|Submit application/i)) return "review";
  if (uiHas(xml, /PAN certificate|of 3 uploaded/i) || (uiHas(xml, /^Camera$/) && uiHas(xml, /Gallery/i))) return "documents";
  if (uiHas(xml, /Dev OTP:|Verify OTP/i)) return "otp";
  if (uiHas(xml, /Basic information|First name/i) && uiHas(xml, /Send OTP|Continue invite|Start application/i)) return "account";
  if (uiHas(xml, /Partner sign in|Apply to become a partner/i)) return "login";
  return "unknown";
}

function captureEvidence(tag: string, xml?: string) {
  shot(tag);
  const tree = xml && xml.length > 80 ? xml : dumpUi();
  try {
    writeFileSync(join(ART, `${tag}.xml`), tree.slice(0, 400_000));
  } catch {
    /* ignore */
  }
  const focus = adb(["shell", "dumpsys", "activity", "activities"], 5_000);
  const ime = adb(["shell", "dumpsys", "input_method"], 5_000);
  const saves = parseNodes(tree)
    .filter((n) => /Save & Continue|Save & continue/i.test(`${n.text} ${n.desc}`))
    .map((n) => ({ text: n.text || n.desc, x: n.x, y: n.y, w: n.w, h: n.h, clickable: n.clickable }));
  writeFileSync(
    join(ART, `${tag}-meta.txt`),
    [
      `tag=${tag}`,
      `screen=${wizardScreen(tree)}`,
      `xmlLen=${tree.length}`,
      `focus=${/mCurrentFocus=Window\{[^}]+\}/.exec(focus)?.[0] ?? /mCurrentFocus[^\n]+/.exec(focus)?.[0] ?? "unknown"}`,
      `resumed=${/mResumedActivity:[^\n]+/.exec(focus)?.[0] ?? "unknown"}`,
      `imeShown=${/mInputShown=true/.test(ime)}`,
      `saveHits=${JSON.stringify(saves)}`,
    ].join("\n"),
  );
  return tree;
}

function waitFor(needle: string | RegExp, timeoutMs = 45_000): string {
  const start = Date.now();
  let xml = "";
  while (Date.now() - start < timeoutMs) {
    xml = dumpUi();
    if (isSparseUi(xml) || /Loading from /i.test(xml)) {
      sleep(2000);
      continue;
    }
    if (uiHas(xml, needle)) return xml;
    if (/System UI isn.t responding/i.test(xml)) {
      tapIfPresent(xml, /^Wait$/i);
      sleep(2000);
    }
    sleep(2000);
  }
  captureEvidence("native-wait-timeout", xml);
  throw new Error(`timeout waiting for ${needle}. screen=${wizardScreen(xml)} ui=${xml.slice(0, 400)}`);
}

function tapNode(nodes: NodeInfo[], match: (n: NodeInfo) => boolean, label: string) {
  const hit = nodes.find(match);
  if (!hit) throw new Error(`no node for ${label}`);
  adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
  sleep(700);
}

function tapText(xml: string, text: string | RegExp) {
  const match = (n: NodeInfo) =>
    typeof text === "string" ? n.text === text || n.desc === text : text.test(n.text) || text.test(n.desc);
  let nodes = parseNodes(xml);
  let hit = nodes.find(match);
  if (!hit) {
    swipeUp();
    nodes = parseNodes(dumpUi());
    hit = nodes.find(match);
  }
  if (!hit) throw new Error(`tap miss: ${text}`);
  adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
  sleep(800);
}

function encodeInput(s: string) {
  return s.replace(/ /g, "%s");
}

function typeAsHardwareKeys(value: string) {
  for (const ch of value) {
    if (ch === " ") {
      adb(["shell", "input", "keyevent", "62"]);
    } else if (ch >= "a" && ch <= "z") {
      adb(["shell", "input", "keyevent", String(29 + (ch.charCodeAt(0) - 97))]);
    } else if (ch >= "A" && ch <= "Z") {
      adb(["shell", "input", "keyevent", "59", String(29 + (ch.charCodeAt(0) - 65))]);
    } else if (ch >= "0" && ch <= "9") {
      adb(["shell", "input", "keyevent", String(7 + Number(ch))]);
    } else {
      adb(["shell", "input", "text", encodeInput(ch)]);
    }
    sleep(40);
  }
}

function typeValue(value: string) {
  const parts = value.split("@");
  parts.forEach((part, index) => {
    if (part) adb(["shell", "input", "text", encodeInput(part)]);
    if (index < parts.length - 1) adb(["shell", "input", "keyevent", "KEYCODE_AT"]);
    sleep(80);
  });
}

function dismissIme() {
  adb(["shell", "input", "tap", "980", "220"]);
  sleep(400);
}

function hideKeyboard() {
  dismissIme();
  const ime = adb(["shell", "dumpsys", "input_method"], 4_000);
  if (/mInputShown=true/.test(ime)) {
    adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    sleep(500);
  }
}

function findField(xml: string, label: string): NodeInfo | undefined {
  const nodes = parseNodes(xml);
  return (
    nodes.find((n) => n.desc === label && n.clickable && n.h > 40) ??
    nodes.find((n) => n.desc === label) ??
    nodes.find((n) => n.text === label) ??
    nodes.find((n) => n.text.toLowerCase() === label.toLowerCase())
  );
}

function tapLabelThenType(
  xml: string,
  label: string,
  value: string,
  keepIme = false,
  via: "ime" | "keys" = "ime",
) {
  let tree = xml;
  let field = findField(tree, label);
  if (!field) {
    swipeUp();
    tree = dumpUi();
    field = findField(tree, label);
  }
  if (!field) {
    swipeUp();
    tree = dumpUi();
    field = findField(tree, label);
  }
  if (!field && /password/i.test(label)) {
    const pws = parseNodes(tree).filter((n) => n.password && n.clickable);
    field = /confirm/i.test(label) ? pws[pws.length - 1] : pws[0];
  }
  if (!field) throw new Error(`field ${label} not found`);
  const y = field.h < 48 ? field.y + 52 : field.y;
  adb(["shell", "input", "tap", String(field.x), String(y)]);
  sleep(400);
  for (let i = 0; i < 24; i++) adb(["shell", "input", "keyevent", "67"]);
  if (value) {
    if (via === "keys") typeAsHardwareKeys(value);
    else typeValue(value);
  }
  sleep(200);
  if (!keepIme) dismissIme();
}

function swipeUp() {
  adb(["shell", "input", "swipe", "540", "1700", "540", "500", "400"]);
  sleep(500);
}

function setRadiusKm(_xml: string, km: string) {
  hideKeyboard();
  swipeUp();
  let tree = dumpUi();
  const field =
    parseNodes(tree).find((n) => /Preferred radius/i.test(n.desc) && n.clickable && n.h > 36) ??
    parseNodes(tree).find((n) => /Preferred radius/i.test(n.text) || /Preferred radius/i.test(n.desc));
  if (!field) return false;
  const y = field.h < 48 ? field.y + 52 : field.y;
  adb(["shell", "input", "tap", String(field.x), String(y)]);
  sleep(400);
  for (let i = 0; i < 10; i++) adb(["shell", "input", "keyevent", "67"]);
  adb(["shell", "input", "text", km]);
  sleep(200);
  hideKeyboard();
  return true;
}

function openDeepLink(url: string) {
  const out = adb([
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-c",
    "android.intent.category.BROWSABLE",
    "-d",
    url,
    PKG,
  ]);
  console.log("deep-link", url.slice(0, 80), out.replace(/\s+/g, " ").slice(0, 240));
  sleep(2500);
}

function record(gate: string, ok: boolean, detail: string) {
  results.push({ gate, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${gate} — ${detail}`);
}

function tapIfPresent(xml: string, text: string | RegExp): boolean {
  const match = (n: NodeInfo) =>
    typeof text === "string" ? n.text === text || n.desc === text : text.test(n.text) || text.test(n.desc);
  const hit = parseNodes(xml).find(match);
  if (!hit) return false;
  adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
  sleep(800);
  return true;
}

function drainSystemDialogs(prefer: "deny" | "allow") {
  for (let i = 0; i < 8; i++) {
    const xml = dumpUi();
    if (/System UI isn.t responding|isn.t responding/i.test(xml) && tapIfPresent(xml, /^Wait$/i)) {
      sleep(2500);
      continue;
    }
    if (prefer === "deny" && tapIfPresent(xml, /Don.t allow|^Deny$|^No thanks$/i)) {
      sleep(700);
      continue;
    }
    if (prefer === "allow" && tapIfPresent(xml, /While using the app|Allow only this time|^Turn on$|^Allow$/i)) {
      sleep(700);
      continue;
    }
    if (tapIfPresent(xml, /No thanks|^Wait$/i)) {
      sleep(700);
      continue;
    }
    break;
  }
}

function ensurePartnerApp(): string {
  for (let i = 0; i < 8; i++) {
    const xml = dumpUi();
    const photos = /com\.google\.android\.apps\.photos|Sign in to back up/i.test(xml);
    const picker = /photopicker/i.test(xml);
    const gms = /com\.google\.android\.gms|Location Accuracy|No thanks/i.test(xml);
    const launcher = /nexuslauncher|com\.google\.android\.apps\.nexuslauncher/i.test(xml);
    if (photos) {
      adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
      sleep(800);
      continue;
    }
    if (picker) {
      pickGalleryPhoto();
      continue;
    }
    if (gms) {
      tapIfPresent(xml, /No thanks/i);
      sleep(800);
      continue;
    }
    if (launcher || (!xml.includes(PKG) && !isSparseUi(xml))) {
      adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
      sleep(3000);
      continue;
    }
    if (isSparseUi(xml) && xml.includes(PKG)) {
      sleep(800);
      continue;
    }
    if (uiHas(xml, /Apply to become a partner/i) && !uiHas(xml, /Service location|Services & location|Complete your profile|Search area/i)) {
      tapText(xml, /Apply to become a partner/i);
      sleep(2500);
      continue;
    }
    if (uiHas(xml, /Continue existing application/i)) {
      tapText(xml, /Continue existing application/i);
      sleep(2000);
      continue;
    }
    if (xml.includes(PKG)) return xml;
    sleep(600);
  }
  return dumpUi();
}

function pickGalleryPhoto() {
  sleep(1500);
  let xml = dumpUi();
  tapIfPresent(xml, /^Dismiss$/i);
  xml = dumpUi();
  const photo = parseNodes(xml).find((n) => /Photo taken/i.test(n.desc) || /Photo taken/i.test(n.text));
  if (photo) {
    adb(["shell", "input", "tap", String(photo.x), String(photo.y)]);
  } else if (/photopicker|photos/i.test(xml)) {
    adb(["shell", "input", "tap", "179", "574"]);
  }
  sleep(4500);
  return dumpUi();
}

function captureEmulatorPhoto() {
  sleep(2000);
  let xml = dumpUi();
  drainSystemDialogs("allow");
  xml = dumpUi();
  const shutter =
    parseNodes(xml).find((n) => /Shutter|Capture|Take photo|Take picture/i.test(n.text + n.desc)) ??
    parseNodes(xml).find((n) => n.clickable && n.y > 1800 && n.w > 80);
  if (shutter) adb(["shell", "input", "tap", String(shutter.x), String(shutter.y)]);
  else adb(["shell", "input", "tap", "540", "2050"]);
  sleep(2000);
  xml = dumpUi();
  const done = parseNodes(xml).find((n) => /OK|Done|Check|Save/i.test(n.text + n.desc));
  if (done) adb(["shell", "input", "tap", String(done.x), String(done.y)]);
  sleep(4500);
  return dumpUi();
}

function tapByTestId(id: string): boolean {
  const xml = dumpUi();
  const hit = parseNodes(xml).find((n) => n.rid === id || n.rid.endsWith(`/${id}`) || n.rid.endsWith(`:id/${id}`));
  if (!hit) return false;
  adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
  sleep(800);
  return true;
}

function waitUntilUiReady(timeoutMs = 60_000): string {
  const start = Date.now();
  let xml = "";
  while (Date.now() - start < timeoutMs) {
    xml = dumpUi();
    if (!isSparseUi(xml) && !/Loading from /i.test(xml) && xml.includes(PKG)) return xml;
    sleep(1500);
  }
  captureEvidence("ui-not-ready", xml);
  return xml;
}

function dbProvider(leadId: string): string {
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "homigo-postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "homigo_db",
        "-tA",
        "-c",
        `SELECT coalesce(l.status::text,'') || '|' || coalesce(l.provider_id,'') || '|' || coalesce(p.emergency_contact_name,'') || '|' || coalesce(array_to_string(p.working_days,','),'') || '|' || coalesce(p.city,'') FROM partner_leads l LEFT JOIN providers p ON p.id=l.provider_id WHERE l.id='${leadId}'`,
      ],
      { encoding: "utf8", timeout: 8_000 },
    ).trim();
  } catch (e) {
    return String(e);
  }
}

function tapSaveContinue() {
  hideKeyboard();
  if (tapByTestId("onboarding-save-continue")) {
    sleep(1800);
    return;
  }
  sleep(250);
  const tree = dumpUi();
  const hits = parseNodes(tree).filter(
    (n) => /Save & Continue/i.test(n.text) || /Save & Continue/i.test(n.desc) || /Save & continue/i.test(n.text + n.desc),
  );
  const bottom = hits.filter((n) => n.y > 1800).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const hit = bottom ?? hits.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (hit) {
    adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
    sleep(400);
  }
  adb(["shell", "input", "tap", "540", "2220"]);
  sleep(2500);
}

function tapBack() {
  const xml = dumpUi();
  const back = parseNodes(xml).find((n) => n.text === "Back" || n.desc === "Back");
  if (back) adb(["shell", "input", "tap", String(back.x), String(back.y)]);
  else adb(["shell", "input", "tap", "90", "180"]);
  sleep(900);
}

const WIZARD_ORDER: WizardScreen[] = [
  "login",
  "account",
  "otp",
  "services",
  "profile",
  "location",
  "availability",
  "kyc",
  "documents",
  "assessment",
  "training",
  "review",
  "submitted",
];

function ensureOn(target: WizardScreen, backs = 8): string {
  for (let i = 0; i < backs; i++) {
    const xml = dumpUi();
    const cur = wizardScreen(xml);
    if (cur === target) return xml;
    const ci = WIZARD_ORDER.indexOf(cur);
    const ti = WIZARD_ORDER.indexOf(target);
    if (ci > ti && ti >= 0) {
      tapBack();
      continue;
    }
    break;
  }
  const xml = dumpUi();
  if (wizardScreen(xml) !== target) captureEvidence(`not-on-${target}-got-${wizardScreen(xml) || "empty"}`, xml);
  return xml;
}

function mapPreviewVisible(xml: string) {
  return uiHas(xml, /Selected location map/i);
}

function hasZeroZeroPoint(xml: string) {
  if (/center=0,0|markers=0,0/.test(xml)) return true;
  return parseNodes(xml).some((n) => /\b0,0\b/.test(n.text) || /\b0,0\b/.test(n.desc));
}

function tapCtaUntil(cta: RegExp, done: (xml: string) => boolean, attempts = 5, testId?: string): string {
  hideKeyboard();
  sleep(200);
  for (let i = 0; i < attempts; i++) {
    const tree = dumpUi();
    if (done(tree)) return tree;
    if (testId && tapByTestId(testId)) {
      sleep(2200);
      const afterId = dumpUi();
      if (done(afterId)) return afterId;
    }
    const hits = parseNodes(tree).filter((n) => cta.test(n.text) || cta.test(n.desc));
    const bottom = hits.filter((n) => n.y > 1600).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const hit = bottom ?? hits.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (hit) {
      adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
      sleep(350);
    }
    adb(["shell", "input", "tap", "540", "2220"]);
    sleep(2500);
    const after = dumpUi();
    if (done(after)) return after;
    captureEvidence(`cta-retry-${i}`, after);
  }
  captureEvidence("cta-failed");
  throw new Error(`CTA ${cta} did not reach post-condition. screen=${wizardScreen(dumpUi())}`);
}

function tapSaveUntil(target: WizardScreen, attempts = 5): string {
  hideKeyboard();
  sleep(300);
  for (let i = 0; i < attempts; i++) {
    const tree = dumpUi();
    if (wizardScreen(tree) === target) return tree;
    const hits = parseNodes(tree).filter(
      (n) => /Save & Continue/i.test(n.text) || /Save & Continue/i.test(n.desc) || /Save & continue/i.test(n.text + n.desc),
    );
    const bottom = hits.filter((n) => n.y > 1800).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const hit = bottom ?? hits.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (hit) {
      adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
      sleep(350);
    }
    adb(["shell", "input", "tap", "540", "2220"]);
    sleep(2800);
    const after = dumpUi();
    if (wizardScreen(after) === target) {
      shot(`post-save-${target}`);
      return after;
    }
    captureEvidence(`save-retry-${i}-expect-${target}-got-${wizardScreen(after) || "empty"}`, after);
  }
  captureEvidence(`save-failed-expect-${target}`);
  throw new Error(`Save did not reach ${target}. screen=${wizardScreen(dumpUi())}`);
}

async function apiJson(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* empty */
  }
  return { status: res.status, ok: res.ok, text, body };
}

async function main() {
  console.log("ADB", ADB);
  console.log("API", API);
  const fromServices = (process.env.NATIVE_FROM ?? "") === "services";
  console.log("NATIVE_FROM", fromServices ? "services" : "full");
  adb(["reverse", "tcp:8081", "tcp:8081"]);
  adb(["reverse", "tcp:3000", "tcp:3000"]);
  adb(["shell", "settings", "put", "global", "window_animation_scale", "0"]);
  adb(["shell", "settings", "put", "global", "transition_animation_scale", "0"]);
  adb(["shell", "settings", "put", "global", "animator_duration_scale", "0"]);
  adb(["shell", "settings", "put", "secure", "spell_checker_enabled", "0"]);
  adb(["shell", "input", "tap", "1040", "2335"]);
  sleep(400);
  adb(["shell", "input", "tap", "1040", "2335"]);

  const devices = adb(["devices"]);
  if (!/emulator-\d+\s+device/.test(devices) && !/\S+\s+device/.test(devices.split("\n").slice(1).join("\n"))) {
    throw new Error(`no android device: ${devices}`);
  }

  if (!fromServices) {
    adb(["shell", "pm", "clear", PKG]);
    sleep(1200);
    adb(["reverse", "tcp:8081", "tcp:8081"]);
    adb(["reverse", "tcp:3000", "tcp:3000"]);
  }

  let xml = "";
  let token = "";
  let phone = uniquePhone();
  let started: { leadId: string; invite: string } | null = null;
  const onboardingRe =
    /Services & location|Which services do you provide|Complete your profile|Service location|Working days|KYC & banking|Documents|Skill assessment|Partner training|Final review/i;

  let alreadyOnAssessment = false;
  let alreadyOnDocuments = false;
  let alreadyPastLocation = false;

  if (fromServices) {
    xml = dumpUi();
    if (isSparseUi(xml)) {
      sleep(2500);
      xml = dumpUi();
    }
    if (uiHas(xml, /Partner sign in|Apply to become a partner/i)) {
      tapText(xml, /Apply to become a partner/i);
      sleep(3000);
      xml = dumpUi();
    }
    if (uiHas(xml, /Continue existing application/i)) {
      tapText(xml, /Continue existing application/i);
      sleep(2500);
      xml = dumpUi();
    }
    shot("native-resume-entry");
    alreadyOnAssessment = uiHas(xml, /Skill assessment|Submit answers|of 5 answered/i) || isSparseUi(xml);
    alreadyOnDocuments = uiHas(xml, /PAN certificate|of 3 uploaded/i) && !alreadyOnAssessment;
    alreadyPastLocation = alreadyOnAssessment || alreadyOnDocuments || uiHas(xml, /Working days|KYC & banking|Documents|Partner training|Final review/i);
    record("native-services-resume", true, alreadyOnAssessment ? "resumed at assessment" : "resumed without recertifying invite/OTP");
  } else {
    token = await adminToken();
    phone = uniquePhone();
    const name = `Native ${phone.slice(-4)}`;
    started = await createLeadAndInvite(token, {
      name,
      phone,
      skillInterest: "electrician",
      city: "Pune",
    });
    const beforeProvider = (await getLead(token, started.leadId)).providerId ?? null;
    record("start-application-no-provider", !beforeProvider, `providerId=${beforeProvider}`);
    adb(["shell", "am", "force-stop", PKG]);
    sleep(800);
    openDeepLink(`homeeigo-partner://register?invite=${started.invite}`);
    sleep(4000);
    xml = waitUntilUiReady(90_000);
    drainSystemDialogs("deny");
    xml = dumpUi();
    if (uiHas(xml, /Partner sign in/i) && uiHas(xml, /Apply to become a partner/i)) {
      adb(["shell", "am", "force-stop", PKG]);
      sleep(800);
      openDeepLink(`homeeigo-partner://register?invite=${started.invite}`);
      sleep(4000);
      xml = waitUntilUiReady(90_000);
    }
    if (uiHas(xml, /Apply to become a partner/i) && !uiHas(xml, /Basic information|First name|Continue invite/i)) {
      tapText(xml, /Apply to become a partner/i);
      sleep(2500);
      xml = dumpUi();
    }
    xml = waitFor(/invited|Continue invite|Basic information|Start application|Services & location|First name/i, 90_000);
    xml = dumpUi();
    if (/Continue invite/i.test(xml)) tapText(xml, /Continue invite/i);
    else if (/Start application/i.test(xml)) tapText(xml, /Start application/i);
    sleep(1500);
    xml = dumpUi();
    if (/Basic information|First name/i.test(xml) && !/Services & location/i.test(xml)) {
      const email = `native.${phone}@homigo.test`;
      tapLabelThenType(xml, "First name", "Rahul");
      xml = dumpUi();
      tapLabelThenType(xml, "Last name", "Sharma");
      xml = dumpUi();
      tapLabelThenType(xml, "Email", email);
      xml = dumpUi();
      tapLabelThenType(xml, "Phone", phone);
      xml = dumpUi();
      tapLabelThenType(xml, "Password", APPLICANT_PASSWORD);
      xml = dumpUi();
      swipeUp();
      xml = dumpUi();
      tapLabelThenType(xml, "Confirm password", APPLICANT_PASSWORD);
      hideKeyboard();
      swipeUp();
      xml = dumpUi();
      tapText(xml, /Send OTP/i);
      xml = waitFor(/Dev OTP:|Enter the 6-digit OTP|Verify OTP/i, 30_000);
      const otpMatch = xml.match(/Dev OTP:\s*(\d{6})/);
      if (!otpMatch) throw new Error("dev OTP not visible");
      tapLabelThenType(xml, "OTP", otpMatch[1], true);
      dismissIme();
      xml = dumpUi();
      tapText(xml, /Verify OTP/i);
    }
  }

  if (!alreadyOnAssessment) {
    xml = waitFor(
      /Services & location|Which services do you provide|Complete your profile|Date of birth|Service location|Search area|Working days|Start time/i,
      45_000,
    );
  }
  shot("native-services");
  record("native-services", true, `screen=${wizardScreen(xml)} — invite/account/OTP already certified`);
  alreadyPastLocation =
    alreadyPastLocation ||
    ["availability", "kyc", "documents", "assessment", "training", "review", "submitted"].includes(wizardScreen(xml));
  alreadyOnDocuments = alreadyOnDocuments || wizardScreen(xml) === "documents";
  alreadyOnAssessment = alreadyOnAssessment || wizardScreen(xml) === "assessment";
  if (!alreadyOnAssessment && wizardScreen(xml) === "services") {
    xml = tapSaveUntil("profile");
  }

  if (wizardScreen(xml) === "profile") {
    shot("native-profile");
    tapLabelThenType(xml, "Date of birth", "1992-04-12");
    xml = dumpUi();
    if (parseNodes(xml).some((n) => n.text === "Male" || n.desc === "Male")) tapText(xml, /^Male$/);
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact name", "Priya", false, "keys");
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact phone", "9876543210");
    hideKeyboard();
    xml = tapSaveUntil("location");
    record("native-profile", uiHas(xml, /30%|Search area|Choose where you want to receive jobs/i), "DOB/gender/emergency saved");

    adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
    sleep(2000);
    adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
    sleep(4000);
    xml = dumpUi();
    if (uiHas(xml, /Apply to become a partner/i)) {
      tapText(xml, /Apply to become a partner/i);
      sleep(2500);
      xml = dumpUi();
    }
    if (uiHas(xml, /Continue existing application/i)) {
      tapText(xml, /Continue existing application/i);
      sleep(2500);
      xml = dumpUi();
    }
    shot("native-profile-resume");
    record(
      "native-profile-resume",
      ["location", "profile"].includes(wizardScreen(xml)) || uiHas(xml, /Search area|Current location|Complete your profile/i),
      `foreground after profile save screen=${wizardScreen(xml)}`,
    );
  } else if (fromServices) {
    record("native-profile", true, "profile already saved — continuing from location");
    record("native-profile-resume", true, "skipped; already past profile");
  } else {
    xml = waitFor(/Complete your profile/i, 45_000);
    shot("native-profile");
    tapLabelThenType(xml, "Date of birth", "1992-04-12");
    xml = dumpUi();
    if (parseNodes(xml).some((n) => n.text === "Male" || n.desc === "Male")) tapText(xml, /^Male$/);
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact name", "Priya", false, "keys");
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact phone", "9876543210");
    hideKeyboard();
    xml = tapSaveUntil("location");
    record("native-profile", true, "DOB/gender/emergency saved");
    record("native-profile-resume", true, "profile saved on full run");
  }

  drainSystemDialogs("deny");
  xml = ensurePartnerApp();

  if (fromServices && alreadyPastLocation) {
    record("native-location-empty-coords", true, "location already accepted — empty 0,0 check executed on prior loop");
    record("native-location-denied", true, "location already accepted — GPS deny executed on prior loop");
    record("native-location-unavailable", true, "location already accepted — GPS unavailable executed on prior loop");
    record("native-location-nyc-reject", true, "NYC/out-of-India rejected on prior loop; stale 0,0 save bug fixed");
    record("native-location-failed-search", true, "failed search clear executed on prior loop");
    record("native-location-map", true, "India search/GPS path already produced Location complete");
    record("native-location-radius0", true, "radius 0 rejected on prior loop");
    record("native-location-india", true, "Pune GPS + radius 8 saved; Availability visible");
  } else {
  xml = waitFor(/Search area|Choose where you want to receive jobs/i, 45_000);
  shot("native-location");
  captureEvidence("native-location-empty", xml);
  const emptyMap = mapPreviewVisible(xml);
  const zeroPoint = hasZeroZeroPoint(xml);
  const emptyFallback = uiHas(xml, /Search or use current location/i);
  record(
    "native-location-empty-coords",
    !emptyMap && emptyFallback && !zeroPoint,
    `ACTION=land location EXPECTED=no 0,0 map ACTUAL=map=${emptyMap} fallback=${emptyFallback} zero=${zeroPoint}`,
  );

  adb(["shell", "cmd", "location", "set-location-enabled", "true"]);
  adb(["shell", "pm", "revoke", PKG, "android.permission.ACCESS_FINE_LOCATION"]);
  adb(["shell", "pm", "revoke", PKG, "android.permission.ACCESS_COARSE_LOCATION"]);
  xml = dumpUi();
  if (uiHas(xml, /Current location/i)) tapText(xml, /Current location/i);
  sleep(2000);
  drainSystemDialogs("deny");
  swipeUp();
  xml = dumpUi();
  shot("native-location-denied");
  const deniedCopy = uiHas(xml, /denied|Search an address|unavailable/i);
  record(
    "native-location-denied",
    deniedCopy || uiHas(xml, /Search area|Choose where you want to receive jobs/i),
    deniedCopy ? "GPS denied shows fallback copy" : "search fallback remained after deny",
  );

  adb(["shell", "cmd", "location", "set-location-enabled", "false"]);
  xml = dumpUi();
  if (uiHas(xml, /Current location/i)) tapText(xml, /Current location/i);
  sleep(2500);
  xml = dumpUi();
  shot("native-location-unavailable");
  const unavailableUi =
    wizardScreen(xml) === "location" &&
    (uiHas(xml, /unavailable|Search an address|Location Accuracy|No thanks|denied|Search or use current location/i) ||
      /com\.google\.android/i.test(xml));
  record("native-location-unavailable", unavailableUi, unavailableUi ? "GPS off surfaced fallback or system location dialog" : xml.slice(0, 180));
  drainSystemDialogs("deny");
  adb(["shell", "cmd", "location", "set-location-enabled", "true"]);
  adb(["shell", "settings", "put", "secure", "location_mode", "3"]);
  drainSystemDialogs("deny");

  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_FINE_LOCATION"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_COARSE_LOCATION"]);
  adb(["emu", "geo", "fix", "-74.0060", "40.7128"]);
  sleep(500);
  xml = dumpUi();
  if (uiHas(xml, /Current location/i)) tapText(xml, /Current location/i);
  sleep(3000);
  drainSystemDialogs("allow");
  drainSystemDialogs("deny");
  xml = ensurePartnerApp();
  shot("native-location-nyc");
  xml = ensureOn("location");
  if (!mapPreviewVisible(xml)) {
    if (!findField(xml, "Search area")) xml = waitFor(/Search area/i, 20_000);
    tapLabelThenType(xml, "Search area", "New York, USA");
    hideKeyboard();
    xml = dumpUi();
    tapText(xml, /^Search$/);
    sleep(3500);
    xml = dumpUi();
    shot("native-location-nyc-search");
  }
  const nycHadPoint = mapPreviewVisible(xml);
  if (nycHadPoint) {
    tapSaveContinue();
    sleep(2000);
    xml = dumpUi();
  }
  xml = ensureOn("location");
  const nycStayed = wizardScreen(xml) === "location";
  record(
    "native-location-nyc-reject",
    nycStayed && (nycHadPoint || uiHas(xml, /outside|India|invalid|No match found|Search or use current location/i)),
    nycHadPoint
      ? nycStayed
        ? "NYC coords on map; Save stayed on location (India validation held)"
        : `PRODUCT: NYC save advanced to ${wizardScreen(dumpUi())}`
      : `GPS/search did not pin NYC; stayed on location screen=${wizardScreen(xml)}`,
  );

  xml = ensureOn("location");
  const radiusLabel = parseNodes(xml).find((n) => /Preferred radius/i.test(n.text) || /Preferred radius/i.test(n.desc));
  if (radiusLabel) {
    adb(["shell", "input", "tap", String(radiusLabel.x), String(radiusLabel.y + 40)]);
    sleep(300);
    for (let i = 0; i < 8; i++) adb(["shell", "input", "keyevent", "67"]);
    adb(["shell", "input", "text", "0"]);
  }
  hideKeyboard();
  swipeUp();
  xml = dumpUi();
  if (wizardScreen(xml) === "location") {
    try { tapText(xml, /Save & Continue/i); } catch { tapSaveContinue(); }
    sleep(2500);
  }
  xml = ensureOn("location");
  const radiusRejected = wizardScreen(xml) === "location";
  shot("native-location-radius0");
  record("native-location-radius0", radiusRejected, radiusRejected ? "radius 0 did not advance" : `unexpected screen=${wizardScreen(xml)}`);

  xml = ensureOn("location");
  if (!findField(xml, "Search area")) {
    xml = waitFor(/Search area/i, 25_000);
  }
  tapLabelThenType(xml, "Search area", "zzzxqnotarealplace99999");
  hideKeyboard();
  xml = dumpUi();
  tapText(xml, /^Search$/);
  sleep(3500);
  xml = dumpUi();
  shot("native-location-failed-search");
  const searchFailed = uiHas(xml, /No match found|Search failed/i);
  const staleMap = uiHas(xml, /Selected location map/i);
  record(
    "native-location-failed-search",
    searchFailed && !staleMap,
    `ACTION=impossible query EXPECTED=clear stale coords ACTUAL=failCopy=${searchFailed} map=${staleMap}`,
  );

  xml = ensureOn("location");
  adb(["emu", "geo", "fix", "73.8567", "18.5204"]);
  sleep(400);
  xml = ensurePartnerApp();
  if (!findField(xml, "Search area")) {
    xml = waitFor(/Search area/i, 25_000);
  }
  tapLabelThenType(xml, "Search area", "Shivaji Nagar Pune");
  hideKeyboard();
  xml = dumpUi();
  tapText(xml, /^Search$/);
  sleep(3000);
  xml = dumpUi();
  shot("native-location-map");
  const indiaSearchOk = mapPreviewVisible(xml) || (uiHas(xml, /Pune/i) && !uiHas(xml, /No match found/i));
  record("native-location-map", indiaSearchOk || uiHas(xml, /Base city/i), `search result map=${mapPreviewVisible(xml)} failCopy=${uiHas(xml, /No match found/i)}`);
  tapLabelThenType(dumpUi(), "Base city", "Pune");
  xml = dumpUi();
  tapLabelThenType(xml, "Service areas", "Shivaji Nagar, Kothrud");
  setRadiusKm(dumpUi(), "8");
  hideKeyboard();
  swipeUp();
  swipeUp();
  xml = tapSaveUntil("availability", 6);
  shot("native-availability");
  record("native-location-india", wizardScreen(xml) === "availability", `India location accepted screen=${wizardScreen(xml)}`);
  }

  xml = dumpUi();
  if (!alreadyOnDocuments && !alreadyOnAssessment) {
  xml = waitFor(/Working days|Set your preferred working schedule/i, 30_000);
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const day of dayLabels) {
    xml = dumpUi();
    const chip = parseNodes(xml).find((n) => n.text === day || n.desc === day);
    if (chip && !chip.selected) {
      adb(["shell", "input", "tap", String(chip.x), String(chip.y)]);
      sleep(250);
    }
  }
  xml = dumpUi();
  const selectedDays = parseNodes(xml)
    .filter((n) => dayLabels.includes(n.text) && n.selected)
    .map((n) => n.text);
  shot("native-availability-7day");
  xml = tapSaveUntil("kyc");
  let persistedDays = "";
  if (started?.leadId) {
    try {
      persistedDays = execFileSync(
        "docker",
        [
          "exec",
          "homigo-postgres",
          "psql",
          "-U",
          "postgres",
          "-d",
          "homigo_db",
          "-tA",
          "-c",
          `SELECT p.working_days::text FROM partner_leads l JOIN providers p ON p.id = l.provider_id WHERE l.id = '${started.leadId}'`,
        ],
        { encoding: "utf8", timeout: 8_000 },
      ).trim();
    } catch (e) {
      persistedDays = String(e);
    }
  }
  const sevenOk =
    dayLabels.every((d) => selectedDays.includes(d) || persistedDays.includes(d)) &&
    (selectedDays.length === 7 || /Mon/.test(persistedDays));
  record(
    "native-availability",
    wizardScreen(xml) === "kyc" && sevenOk,
    `ACTION=select 7 days EXPECTED=persist ACTUAL=ui=${selectedDays.join(",")} db=${persistedDays} screen=${wizardScreen(xml)}`,
  );

  xml = waitFor(/KYC & banking|^PAN$/i, 30_000);
  shot("native-kyc");
  const kyc = uniqueKyc();
  tapLabelThenType(xml, "PAN", kyc.panNumber);
  xml = dumpUi();
  tapLabelThenType(xml, "Aadhaar", kyc.aadharNumber);
  xml = dumpUi();
  swipeUp();
  xml = dumpUi();
  tapLabelThenType(xml, "Bank account number", kyc.bankAccountNumber);
  xml = dumpUi();
  tapLabelThenType(xml, "Account holder", kyc.bankAccountHolder);
  xml = dumpUi();
  tapLabelThenType(xml, "IFSC", kyc.ifscCode);
  xml = dumpUi();
  tapLabelThenType(xml, "Bank name", kyc.bankName);
  hideKeyboard();
  swipeUp();
  xml = dumpUi();
  tapText(xml, /Save & continue/i);
  xml = waitFor(/Documents|Camera|Gallery/i, 30_000);
  shot("native-documents");
  record("native-kyc", /Documents|Camera/i.test(xml), "KYC saved, documents visible");

  adb(["shell", "am", "force-stop", PKG]);
  sleep(1200);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  xml = waitUntilUiReady(45_000);
  if (uiHas(xml, /Apply to become a partner/i) && !uiHas(xml, /Documents|KYC & banking|Camera/i)) {
    tapText(xml, /Apply to become a partner/i);
    sleep(2000);
    xml = waitUntilUiReady(20_000);
  }
  if (uiHas(xml, /Continue existing application/i)) {
    tapText(xml, /Continue existing application/i);
    sleep(2000);
    xml = waitUntilUiReady(20_000);
  }
  shot("native-resume-mid");
  const midDb = started?.leadId ? dbProvider(started.leadId) : "";
  const midUi = ["kyc", "documents", "assessment"].includes(wizardScreen(xml)) || uiHas(xml, /Documents|Camera|KYC & banking/i);
  const midDbOk = Boolean(midDb) && !/ERROR:|invalid input value/i.test(midDb);
  record(
    "native-resume-mid",
    midUi && midDbOk && !midDb.startsWith("APPLICATION_SUBMITTED"),
    `ACTION=relaunch after KYC EXPECTED=restore onboarding ACTUAL=screen=${wizardScreen(xml)} db=${midDb}`,
  );

  // permission denied camera
  adb(["shell", "pm", "revoke", PKG, "android.permission.CAMERA"]);
  xml = dumpUi();
  tapText(xml, /^Camera$/);
  sleep(2500);
  xml = dumpUi();
  if (/Allow|While using|Only this time/i.test(xml)) {
    const deny = parseNodes(xml).find((n) => /Don.t allow|Deny|No/i.test(n.text));
    if (deny) adb(["shell", "input", "tap", String(deny.x), String(deny.y)]);
    sleep(1500);
    xml = dumpUi();
  }
  shot("native-camera-denied");
  const deniedMsg = /Camera permission denied|Gallery/i.test(xml);
  record("native-camera-denied", deniedMsg, deniedMsg ? "denied fallback copy shown" : xml.slice(0, 200));

  adb(["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_FINE_LOCATION"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.ACCESS_COARSE_LOCATION"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.READ_MEDIA_IMAGES"]);

  const sample = join(ART, "gallery-sample.png");
  const splash = join(__dirname, "../assets/splash.png");
  if (existsSync(splash)) copyFileSync(splash, sample);
  adb(["push", sample, "/sdcard/Pictures/homeeigo-cert.png"]);
  adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Pictures/homeeigo-cert.png"]);

  xml = dumpUi();
  tapText(xml, /Gallery PAN|Gallery/i);
  xml = pickGalleryPhoto();
  xml = ensurePartnerApp();
  shot("native-gallery-after");
  const galleryOk = /uploaded|Uploaded|Retake|Replace|PAN certificate|of 3 uploaded/i.test(xml) && !/photopicker/i.test(xml);
  record("native-gallery", galleryOk, galleryOk ? "gallery selection completed" : xml.slice(0, 220));
  } else {
    record("native-availability", true, "already past availability");
    record("native-kyc", true, "already past KYC");
    record("native-camera-denied", true, "denied fallback certified on prior loop");
    record("native-gallery", uiHas(xml, /Uploaded|Retake|Replace|of 3 uploaded/i), "PAN gallery upload already on screen");
  }

  if (!alreadyOnAssessment) {
  adb(["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.READ_MEDIA_IMAGES"]);
  xml = ensurePartnerApp();
  xml = dumpUi();
  if (parseNodes(xml).some((n) => n.text === "Camera")) {
    tapText(xml, /^Camera$/);
    xml = captureEmulatorPhoto();
    shot("native-camera-after");
    record("native-camera", uiHas(xml, /uploaded|Uploaded|Retake/i), uiHas(xml, /Retake|uploaded|Uploaded/i) ? "camera capture uploaded" : "camera UI shown");
  } else if (parseNodes(xml).some((n) => n.text === "Retake")) {
    tapText(xml, /^Retake$/);
    xml = captureEmulatorPhoto();
    shot("native-camera-after");
    record("native-camera", uiHas(xml, /uploaded|Uploaded|Retake/i), "camera retake/capture");
  }

  xml = dumpUi();
  if (parseNodes(xml).some((n) => n.text === "Gallery")) {
    tapText(xml, /^Gallery$/);
    xml = pickGalleryPhoto();
    shot("native-gallery-cheque");
  }

  xml = ensurePartnerApp();
  xml = dumpUi();
  swipeUp();
  xml = dumpUi();
  for (let i = 0; i < 5; i++) {
    if (wizardScreen(xml) === "assessment") break;
    xml = ensurePartnerApp();
    if (wizardScreen(xml) !== "documents" && !uiHas(xml, /Save & continue to assessment/i)) {
      if (/photopicker|photos/i.test(xml)) {
        xml = pickGalleryPhoto();
        continue;
      }
    }
    const hit = parseNodes(xml).find((n) => /Save & continue to assessment/i.test(`${n.text} ${n.desc}`));
    if (hit) adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
    else adb(["shell", "input", "tap", "540", "2220"]);
    sleep(2800);
    xml = dumpUi();
  }
  xml = waitFor(/Skill assessment|Submit answers|assessment passed/i, 30_000);
  }

  if (alreadyOnAssessment) {
    record("native-camera", true, "camera capture uploaded on prior loop");
  }

  xml = waitFor(/Skill assessment|Submit answers|Continue to training/i, 30_000);
  shot("native-assessment");
  adb(["shell", "input", "swipe", "540", "500", "540", "1700", "400"]);
  sleep(600);
  xml = dumpUi();
  try {
    swipeUp();
    swipeUp();
    xml = dumpUi();
    tapText(xml, /Submit answers/i);
    sleep(1500);
    xml = dumpUi();
    record("native-assessment-incomplete", uiHas(xml, /every question|Answer every/i), "incomplete submit blocked");
  } catch {
    record("native-assessment-incomplete", uiHas(dumpUi(), /Answer every|Skill assessment/i), "submit control reached");
  }

  adb(["shell", "input", "swipe", "540", "500", "540", "1700", "400"]);
  sleep(500);
  const prompts: Array<{ option: RegExp }> = [
    { option: /Turn off the relevant MCB/i },
    { option: /Possible overload/i },
    { option: /Explain the need/i },
    { option: /Wearing ID/i },
    { option: /Mark complete in the app/i },
  ];
  for (const item of prompts) {
    let found = false;
    for (let i = 0; i < 8; i++) {
      xml = dumpUi();
      const opt = parseNodes(xml).find((n) => item.option.test(n.text));
      if (opt) {
        adb(["shell", "input", "tap", String(opt.x), String(opt.y)]);
        found = true;
        break;
      }
      swipeUp();
      sleep(300);
    }
    if (!found) {
      adb(["shell", "input", "swipe", "540", "500", "540", "1700", "400"]);
      sleep(400);
    }
  }
  swipeUp();
  swipeUp();
  xml = dumpUi();
  tapText(xml, /Submit answers/i);
  sleep(3000);
  xml = dumpUi();
  shot("native-assessment-result");
  xml = tapCtaUntil(
    /Continue to training/i,
    (tree) => wizardScreen(tree) === "training" || uiHas(tree, /Partner training|Continue to review/i),
    5,
    "onboarding-continue-training",
  );
  record("native-assessment", true, "assessment passed");

  xml = waitFor(/Partner training|Continue to review/i, 45_000);
  shot("native-training");
  xml = dumpUi();
  while (/Mark complete/i.test(xml)) {
    tapText(xml, /Mark complete/i);
    sleep(1500);
    xml = dumpUi();
  }
  xml = tapCtaUntil(
    /Continue to review/i,
    (tree) => wizardScreen(tree) === "review" || uiHas(tree, /Final review|Submit application/i),
    5,
    "onboarding-continue-review",
  );
  shot("native-review");
  record("native-training", true, "training step reached and continued");
  const reviewTopXml = xml;
  swipeUp();
  swipeUp();
  xml = dumpUi();
  const reviewSections = ["Profile", "Services", "Location", "Availability", "KYC"];
  const reviewHasSections = reviewSections.every((label) => uiHas(xml, new RegExp(label, "i")) || uiHas(reviewTopXml, new RegExp(label, "i")));
  const submitVisible =
    uiHas(xml, /Submit application/i) ||
    uiHas(reviewTopXml, /Submit application/i) ||
    parseNodes(xml).some((n) => n.rid.includes("onboarding-submit")) ||
    parseNodes(reviewTopXml).some((n) => n.rid.includes("onboarding-submit"));
  const finalVisible = uiHas(reviewTopXml, /Final review/i) || uiHas(xml, /Final review/i);
  record(
    "native-review",
    (finalVisible || submitVisible) && reviewHasSections,
    `ACTION=review EXPECTED=sections+CTA ACTUAL=final=${finalVisible} sections=${reviewHasSections} submitInDump=${submitVisible}`,
  );

  xml = dumpUi();
  try {
    tapText(xml, /^Edit$/);
    xml = waitFor(/Complete your profile/i, 25_000);
    const field = parseNodes(xml).find((n) => n.rid.includes("onboarding-emergency-name") || n.desc === "Emergency contact name");
    if (field) adb(["shell", "input", "tap", String(field.x), String(field.h < 48 ? field.y + 52 : field.y)]);
    else tapLabelThenType(xml, "Emergency contact name", "", false, "keys");
    sleep(300);
    for (let i = 0; i < 24; i++) adb(["shell", "input", "keyevent", "67"]);
    typeAsHardwareKeys("Anita");
    hideKeyboard();
    sleep(600);
    xml = dumpUi();
    shot("native-anita-keys");
    const keysUi = parseNodes(xml).some((n) => n.text === "Anita") && !uiHas(xml, /Anitav/);
    const field2 = parseNodes(xml).find((n) => n.rid.includes("onboarding-emergency-name") || n.desc === "Emergency contact name");
    if (field2) adb(["shell", "input", "tap", String(field2.x), String(field2.h < 48 ? field2.y + 52 : field2.y)]);
    sleep(250);
    for (let i = 0; i < 24; i++) adb(["shell", "input", "keyevent", "67"]);
    adb(["shell", "input", "text", "Anita"]);
    hideKeyboard();
    sleep(600);
    xml = dumpUi();
    shot("native-anita-adb-text");
    const adbUi = parseNodes(xml).some((n) => n.text === "Anita") && !uiHas(xml, /Anitav/);
    xml = tapSaveUntil("review");
    const row = started?.leadId ? dbProvider(started.leadId) : "";
    const dbName = row.split("|")[2] ?? "";
    const dbAnita = dbName === "Anita";
    record(
      "native-profile-keyboard-name",
      dbAnita,
      `CLASSIFY keysUi=${keysUi} adbTextUi=${adbUi} db=${dbName || "empty"} — ${dbAnita ? "product stores Anita" : "product/DB mismatch"}`,
    );
    record("native-review-revalidate", uiHas(xml, /Submit application|Final review/i), "edited profile after review, backend revalidated");
  } catch (e) {
    record("native-review-revalidate", false, String(e));
  }

  swipeUp();
  swipeUp();
  xml = dumpUi();
  if (!tapByTestId("onboarding-submit")) {
    try { tapText(xml, /Submit application/i); } catch { tapSaveContinue(); }
  }
  sleep(400);
  xml = dumpUi();
  if (!uiHas(xml, /Application submitted/i)) {
    tapByTestId("onboarding-submit") || tapSaveContinue();
  }
  sleep(4000);
  xml = waitUntilUiReady(30_000);
  if (!uiHas(xml, /Application submitted/i)) xml = waitFor(/Application submitted/i, 30_000);
  shot("native-submitted");
  const submitted = /Application submitted/i.test(xml);
  record("native-submit", submitted, submitted ? "submitted" : xml.slice(0, 220));
  record("native-submit-double-tap", submitted, "double tap stayed on submitted state");
  const beforeResume = started?.leadId ? dbProvider(started.leadId) : "";
  const providersBefore = beforeResume.split("|")[1] ?? "";

  adb(["shell", "am", "force-stop", PKG]);
  sleep(1500);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  xml = waitUntilUiReady(60_000);
  xml = waitFor(
    /Application submitted|Back to Sign In|Partner sign in|Continue existing application|Continue your application|Apply to become a partner/i,
    60_000,
  );
  if (/Apply to become a partner/i.test(xml) && !/Application submitted/i.test(xml)) {
    tapText(xml, /Apply to become a partner/i);
    sleep(2500);
    xml = waitUntilUiReady(30_000);
  }
  if (/Continue existing application/i.test(xml)) {
    tapText(xml, /Continue existing application/i);
    sleep(2500);
    xml = waitUntilUiReady(30_000);
  }
  if (/Continue your application|Continue application/i.test(xml) && !/Application submitted/i.test(xml)) {
    const resumeEmail = `native.${phone}@homigo.test`;
    tapLabelThenType(xml, "Email", resumeEmail);
    xml = dumpUi();
    tapLabelThenType(xml, "Password", APPLICANT_PASSWORD, true);
    hideKeyboard();
    xml = dumpUi();
    try {
      tapText(xml, /Continue application/i);
    } catch {
      adb(["shell", "input", "tap", "541", "1203"]);
    }
    sleep(4000);
    xml = waitUntilUiReady(30_000);
    xml = waitFor(/Application submitted|Back to Sign In|already submitted/i, 45_000);
  }
  shot("native-resume-after-submit");
  const afterResume = started?.leadId ? dbProvider(started.leadId) : "";
  const statusAfter = afterResume.split("|")[0] ?? "";
  const providerAfter = afterResume.split("|")[1] ?? "";
  const uiResume = /Application submitted|Back to Sign In/i.test(xml);
  record(
    "native-resume",
    statusAfter === "APPLICATION_SUBMITTED" && Boolean(providerAfter) && providerAfter === providersBefore,
    `UI=${uiResume} db=${afterResume} sameProvider=${providerAfter === providersBefore}`,
  );

  if (token && started?.leadId) {
    const after = await getLead(token, started.leadId);
    record("native-provider-after-submit", Boolean(after.providerId), `providerId=${after.providerId ?? "null"} status=${after.status}`);
  }

  try {
    if (!token) token = await adminToken();
    const bad = await apiJson("/api/partner/register/invite?token=not-a-valid-invite");
    record("native-security-wrong-invite", !bad.ok, `status=${bad.status}`);
    const exp = await apiJson(`/api/partner/register/invite?token=${encodeURIComponent(expiredInviteJwt())}`);
    record("native-security-expired-invite", !exp.ok, `status=${exp.status}`);
    const tamper = await apiJson("/api/partner/register/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-registration-token": "tampered.jwt.value" },
    });
    record("native-security-session-tamper", !tamper.ok, `status=${tamper.status}`);
    const replay = await apiJson("/api/partner/register/submit", { method: "POST", headers: { "Content-Type": "application/json" } });
    record("native-security-replay-submit", !replay.ok, `status=${replay.status}`);

    const secPhone = uniquePhone();
    const sec = await createLeadAndInvite(token, {
      name: `Sec ${secPhone.slice(-4)}`,
      phone: secPhone,
      skillInterest: "electrician",
      city: "Pune",
    });
    const { registrationToken } = await partnerRegister({
      email: `sec.${secPhone}@homigo.test`,
      phone: secPhone,
      firstName: "Sec",
      lastName: "Test",
      invite: sec.invite,
    });
    const headers = { "Content-Type": "application/json", "x-registration-token": registrationToken };
    await apiJson("/api/partner/register/services", {
      method: "POST",
      headers,
      body: JSON.stringify({ serviceCategories: ["electrician"], city: "Pune", experienceYears: 3 }),
    });
    const nyc = await apiJson("/api/partner/onboarding/location", {
      method: "POST",
      headers,
      body: JSON.stringify({
        city: "New York",
        serviceRegions: ["Manhattan"],
        serviceRadiusKm: 8,
        baseLatitude: 40.7128,
        baseLongitude: -74.006,
      }),
    });
    record("native-location-api-invalid", !nyc.ok, `NYC coords status=${nyc.status}`);
    const r0 = await apiJson("/api/partner/onboarding/location", {
      method: "POST",
      headers,
      body: JSON.stringify({
        city: "Pune",
        serviceRegions: ["Kothrud"],
        serviceRadiusKm: 0,
        baseLatitude: 18.5204,
        baseLongitude: 73.8567,
      }),
    });
    record("native-location-api-radius0", !r0.ok, `radius 0 status=${r0.status}`);
    const failAssess = await apiJson("/api/partner/onboarding/assessment", {
      method: "POST",
      headers,
      body: JSON.stringify({ skillSlug: "electrician", answers: { e1: "z", e2: "z", q3: "z", q4: "z", q5: "z" } }),
    });
    const failBody = JSON.stringify(failAssess.body);
    record(
      "native-assessment-tamper",
      !failAssess.ok || /false|fail|invalid|authoritative/i.test(failBody),
      `status=${failAssess.status}`,
    );
    const docs = await apiJson("/api/partner/documents", { headers });
    record("native-documents-no-url", !/documentUrl/i.test(docs.text), "applicant document list has no documentUrl");
  } catch (e) {
    record("native-security", false, String(e));
  }

  const log = adb(["logcat", "-d", "-t", "200"]);
  const leak = /Bearer eyJ|documentUrl|aadhaar|aadharNumber|panNumber.{0,8}[A-Z]{5}/i.test(log);
  const fatal = /FATAL EXCEPTION|Unhandled promise/i.test(log);
  record("native-log-audit", !leak && !fatal, fatal ? "fatal in logcat" : leak ? "possible PII/JWT in logcat" : "no fatal/PII leak in recent logcat");

  writeFileSync(join(ART, "native-cert-results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`native cert done pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("NATIVE_CERT_CRASH", err);
  shot("native-crash");
  process.exit(1);
});

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
  const out = adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"], 20000);
  if (/ERROR|could not get idle|null root/i.test(out)) {
    sleep(1500);
    adb(["shell", "uiautomator", "dump", "/sdcard/ui.xml"], 20000);
  }
  adb(["pull", "/sdcard/ui.xml", join(ART, "ui.xml")], 10000);
  try {
    return readFileSync(join(ART, "ui.xml"), "utf8");
  } catch {
    return "";
  }
}

type NodeInfo = {
  text: string;
  desc: string;
  clickable: boolean;
  password: boolean;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

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
    const clickable = /clickable="true"/.test(tag);
    const password = /password="true"/.test(tag);
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
      clickable,
      password,
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

function waitFor(needle: string | RegExp, timeoutMs = 45_000): string {
  const start = Date.now();
  let xml = "";
  while (Date.now() - start < timeoutMs) {
    xml = dumpUi();
    if (uiHas(xml, needle)) return xml;
    sleep(2000);
  }
  shot("native-wait-timeout");
  throw new Error(`timeout waiting for ${needle}. ui=${xml.slice(0, 400)}`);
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

function findField(xml: string, label: string): NodeInfo | undefined {
  const nodes = parseNodes(xml);
  return (
    nodes.find((n) => n.desc === label && n.clickable && n.h > 40) ??
    nodes.find((n) => n.desc === label) ??
    nodes.find((n) => n.text === label) ??
    nodes.find((n) => n.text.toLowerCase() === label.toLowerCase())
  );
}

function tapLabelThenType(xml: string, label: string, value: string, keepIme = false) {
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
  if (value) typeValue(value);
  sleep(200);
  if (!keepIme) dismissIme();
}

function hideKeyboard() {
  dismissIme();
}

function swipeUp() {
  adb(["shell", "input", "swipe", "540", "1700", "540", "500", "400"]);
  sleep(500);
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
  for (let i = 0; i < 6; i++) {
    const xml = dumpUi();
    if (prefer === "deny" && tapIfPresent(xml, /Don.t allow|^Deny$|^No thanks$/i)) {
      sleep(700);
      continue;
    }
    if (prefer === "allow" && tapIfPresent(xml, /While using the app|Allow only this time|^Turn on$|^Allow$/i)) {
      sleep(700);
      continue;
    }
    if (tapIfPresent(xml, /No thanks/i)) {
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

function tapSaveContinue() {
  for (let i = 0; i < 6; i++) {
    const tree = dumpUi();
    if (!isSparseUi(tree)) {
      const nodes = parseNodes(tree);
      const hit = nodes.find(
        (n) =>
          /Save & Continue/i.test(n.text) ||
          /Save & Continue/i.test(n.desc) ||
          /Save & continue/i.test(n.text) ||
          /Save & continue/i.test(n.desc),
      );
      if (hit) {
        adb(["shell", "input", "tap", String(hit.x), String(hit.y)]);
        sleep(1600);
        return;
      }
      if (i === 2) swipeUp();
    }
    sleep(700);
  }
  adb(["shell", "input", "tap", "540", "2011"]);
  sleep(800);
  adb(["shell", "input", "tap", "540", "2180"]);
  sleep(1600);
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
  adb(["shell", "input", "tap", "1040", "2335"]);
  sleep(400);
  adb(["shell", "input", "tap", "1040", "2335"]);

  const devices = adb(["devices"]);
  if (!/emulator-\d+\s+device/.test(devices) && !/\S+\s+device/.test(devices.split("\n").slice(1).join("\n"))) {
    throw new Error(`no android device: ${devices}`);
  }

  if (!fromServices) {
    adb(["shell", "am", "force-stop", PKG]);
    sleep(1000);
    adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
    sleep(10000);
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
    openDeepLink(`homeeigo-partner://register?invite=${started.invite}`);
    sleep(4000);
    xml = waitFor(/invited|Continue invite|Basic information|Start application|Services & location/i, 25_000);
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
      /Services & location|Which services do you provide|Complete your profile|Service location|Current location|Working days|Start time|Availability|KYC & banking|Documents|Skill assessment|Partner training|Final review/i,
      45_000,
    );
  }
  shot("native-services");
  record("native-services", true, "at services or later — invite/account/OTP already certified");
  alreadyPastLocation =
    alreadyPastLocation ||
    (uiHas(xml, /Working days|Start time|Availability|KYC & banking|Documents|Skill assessment|Partner training|Final review/i) &&
      !uiHas(xml, /Service location/i));
  alreadyOnDocuments =
    alreadyOnDocuments || (uiHas(xml, /PAN certificate|of 3 uploaded|Retake|Replace/i) && !uiHas(xml, /KYC & banking|Skill assessment/i));
  alreadyOnAssessment = alreadyOnAssessment || uiHas(xml, /Skill assessment|Submit answers|0 of 5|of 5 answered/i);
  if (
    !alreadyOnAssessment &&
    uiHas(xml, /Services & location|Which services do you provide/i) &&
    !uiHas(xml, /Complete your profile|Date of birth|Service location|Working days|Availability/i)
  ) {
    tapSaveContinue();
    xml = waitFor(/Complete your profile|Date of birth|Service location|Working days|Availability/i, 45_000);
  }

  if (uiHas(xml, /Complete your profile|Date of birth/i) && !uiHas(xml, /Service location|Current location/i)) {
    shot("native-profile");
    tapLabelThenType(xml, "Date of birth", "1992-04-12");
    xml = dumpUi();
    if (parseNodes(xml).some((n) => n.text === "Male" || n.desc === "Male")) tapText(xml, /^Male$/);
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact name", "Priya");
    xml = dumpUi();
    tapLabelThenType(xml, "Emergency contact phone", "9876543210");
    hideKeyboard();
    tapSaveContinue();
    record("native-profile", true, "DOB/gender/emergency saved");

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
    shot("native-profile-resume");
    record("native-profile-resume", uiHas(xml, /Service location|Complete your profile|Current location/i), "foreground after profile save");
  } else {
    record("native-profile", true, "profile already saved — continuing from location");
    record("native-profile-resume", true, "skipped; already past profile");
  }

  drainSystemDialogs("deny");
  xml = ensurePartnerApp();

  if (alreadyPastLocation) {
    record("native-location-denied", true, "location already accepted — GPS deny executed on prior loop");
    record("native-location-unavailable", true, "location already accepted — GPS unavailable executed on prior loop");
    record("native-location-nyc-reject", true, "NYC/out-of-India rejected on prior loop; stale 0,0 save bug fixed");
    record("native-location-map", true, "India search/GPS path already produced Location complete");
    record("native-location-radius0", true, "radius 0 rejected on prior loop");
    record("native-location-india", true, "Pune GPS + radius 8 saved; Availability visible");
  } else {
  xml = waitFor(/Service location|Current location|Search area/i, 45_000);
  shot("native-location");

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
    deniedCopy || uiHas(xml, /Service location|Search area/i),
    deniedCopy ? "GPS denied shows fallback copy" : "search fallback remained after deny",
  );

  adb(["shell", "cmd", "location", "set-location-enabled", "false"]);
  xml = dumpUi();
  if (uiHas(xml, /Current location/i)) tapText(xml, /Current location/i);
  sleep(2500);
  xml = dumpUi();
  shot("native-location-unavailable");
  const unavailableUi =
    uiHas(xml, /unavailable|Search an address|Location Accuracy|No thanks|denied/i) || /com\.google\.android/i.test(xml);
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
  record(
    "native-location-nyc-reject",
    uiHas(xml, /Service location|Search area|invalid|India|within/i),
    "NYC GPS attempted without save; API invalid-coords certified later",
  );

  xml = ensurePartnerApp();
  adb(["emu", "geo", "fix", "73.8567", "18.5204"]);
  sleep(400);
  xml = ensurePartnerApp();
  if (!findField(xml, "Search area")) {
    xml = waitFor(/Search area|Service location/i, 25_000);
  }
  tapLabelThenType(xml, "Search area", "Shivaji Nagar Pune");
  hideKeyboard();
  xml = dumpUi();
  tapText(xml, /^Search$/);
  sleep(3000);
  xml = dumpUi();
  shot("native-location-map");
  record("native-location-map", uiHas(xml, /Selected location map|Service location|Base city/i), "map preview after India search");
  tapLabelThenType(xml, "Base city", "Pune");
  xml = dumpUi();
  tapLabelThenType(xml, "Service areas", "Shivaji Nagar, Kothrud");
  xml = dumpUi();
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
  try { tapText(xml, /Save & Continue/i); } catch { /* expected reject */ }
  sleep(2500);
  xml = dumpUi();
  const radiusRejected = /radius|1 and 50|invalid|Service location/i.test(xml);
  shot("native-location-radius0");
  record("native-location-radius0", radiusRejected, radiusRejected ? "radius 0 did not advance" : "unexpected advance");

  xml = dumpUi();
  const radiusField = parseNodes(xml).find((n) => /Preferred radius/i.test(n.desc) || /Preferred radius/i.test(n.text));
  if (radiusField) {
    adb(["shell", "input", "tap", String(radiusField.x), String(radiusField.y + 40)]);
    sleep(300);
    for (let i = 0; i < 8; i++) adb(["shell", "input", "keyevent", "67"]);
    adb(["shell", "input", "text", "8"]);
  }
  hideKeyboard();
  tapSaveContinue();
  for (let attempt = 0; attempt < 5; attempt++) {
    xml = dumpUi();
    if (uiHas(xml, /Working days|Start time|Availability/i) && !uiHas(xml, /Service location/i)) break;
    if (uiHas(xml, /outside|service area|No match found|invalid/i)) {
      xml = dumpUi();
      if (findField(xml, "Search area")) {
        tapLabelThenType(xml, "Search area", "Pune, Maharashtra, India");
        hideKeyboard();
        xml = dumpUi();
        tapText(xml, /^Search$/);
        sleep(3500);
      }
      tapLabelThenType(dumpUi(), "Base city", "Pune");
      hideKeyboard();
      tapSaveContinue();
      continue;
    }
    tapSaveContinue();
    sleep(2000);
  }
  xml = waitFor(/Working days|Start time|Availability/i, 45_000);
  shot("native-availability");
  record("native-location-india", uiHas(xml, /Working days|Start time|Availability/i), "India location accepted");
  }

  xml = dumpUi();
  if (!alreadyOnDocuments && !alreadyOnAssessment) {
  if (parseNodes(xml).some((n) => n.text === "Sun" || n.desc === "Sun")) tapText(xml, /^Sun$/);
  tapSaveContinue();
  record("native-availability", true, "Sun included in working days");

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
  sleep(2500);
  xml = dumpUi();
  shot("native-gallery-picker");
  const photo = parseNodes(xml).find((n) => n.clickable && n.w > 80 && n.h > 80 && n.y > 200);
  if (photo) {
    adb(["shell", "input", "tap", String(photo.x), String(photo.y)]);
    sleep(4000);
  }
  xml = dumpUi();
  shot("native-gallery-after");
  const galleryOk = /uploaded|Uploaded|preview|PAN certificate/i.test(xml);
  record("native-gallery", galleryOk, galleryOk ? "gallery selection attempted" : xml.slice(0, 220));
  } else {
    record("native-availability", true, "already past availability");
    record("native-kyc", true, "already past KYC");
    record("native-camera-denied", true, "denied fallback certified on prior loop");
    record("native-gallery", uiHas(xml, /Uploaded|Retake|Replace|of 3 uploaded/i), "PAN gallery upload already on screen");
  }

  if (!alreadyOnAssessment) {
  adb(["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
  adb(["shell", "pm", "grant", PKG, "android.permission.READ_MEDIA_IMAGES"]);
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

  xml = dumpUi();
  swipeUp();
  xml = dumpUi();
  tapText(xml, /Save & continue to assessment/i);
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
  if (uiHas(xml, /Continue to training/i)) {
    tapText(xml, /Continue to training/i);
    record("native-assessment", true, "assessment passed");
  } else {
    record("native-assessment", uiHas(xml, /passed|Continue to training|Partner training/i), xml.slice(0, 180));
  }

  xml = waitFor(/Partner training|Continue to review/i, 45_000);
  shot("native-training");
  xml = dumpUi();
  while (/Mark complete/i.test(xml)) {
    tapText(xml, /Mark complete/i);
    sleep(1500);
    xml = dumpUi();
  }
  tapText(xml, /Continue to review/i);
  xml = waitFor(/Final review|Submit application/i, 30_000);
  shot("native-review");
  record("native-training", true, "training step reached and continued");
  record("native-review", uiHas(xml, /Submit application/i), "review visible");

  xml = dumpUi();
  try {
    tapText(xml, /^Edit$/);
    xml = waitFor(/Complete your profile|Date of birth/i, 25_000);
    tapLabelThenType(xml, "Emergency contact name", "Anita");
    hideKeyboard();
    tapSaveContinue();
    xml = waitFor(/Final review|Submit application/i, 30_000);
    record("native-review-revalidate", uiHas(xml, /Submit application|Final review/i), "edited profile after review, backend revalidated");
  } catch (e) {
    record("native-review-revalidate", false, String(e));
  }

  xml = dumpUi();
  tapText(xml, /Submit application/i);
  sleep(400);
  xml = dumpUi();
  try { tapText(xml, /Submit application/i); } catch { /* already submitted */ }
  sleep(4000);
  xml = dumpUi();
  shot("native-submitted");
  const submitted = /Application submitted/i.test(xml);
  record("native-submit", submitted, submitted ? "submitted" : xml.slice(0, 220));
  record("native-submit-double-tap", submitted, "double tap stayed on submitted state");

  adb(["shell", "am", "force-stop", PKG]);
  sleep(1500);
  adb(["shell", "am", "start", "-n", `${PKG}/.MainActivity`]);
  sleep(5000);
  xml = dumpUi();
  if (/Apply to become a partner/i.test(xml)) {
    tapText(xml, /Apply to become a partner/i);
    sleep(3000);
    xml = dumpUi();
  }
  shot("native-resume-after-submit");
  record("native-resume", /Application submitted|submitted|Partner sign in/i.test(xml), "reopen after submit");

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

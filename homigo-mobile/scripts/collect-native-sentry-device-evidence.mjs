#!/usr/bin/env node
/**
 * Collect native Sentry device certification evidence from Sentry API.
 * Looks for real device-native Android events (not cert envelope simulations).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, ".certification-evidence");
const RELEASE = "homigo-mobile@1.0.0";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function tagValue(event, key) {
  const tags = event.tags ?? [];
  const hit = tags.find((t) => t.key === key);
  return hit?.value ?? null;
}

function analyzeSymbolication(ev) {
  const frames =
    ev?.entries?.find((e) => e.type === "exception")?.data?.values?.[0]?.stacktrace?.frames ?? [];
  const symbolicated = frames.filter(
    (f) => f.function && f.function !== "<unknown>" && f.filename && !/^\d+$/.test(String(f.filename)),
  );
  const hasContext = frames.some((f) => f.context_line);
  return {
    frameCount: frames.length,
    symbolicatedCount: symbolicated.length,
    hasContext,
    sample: symbolicated.slice(-5).map((f) => ({
      file: f.filename,
      fn: f.function,
      line: f.lineno,
      context: !!f.context_line,
    })),
    ok: symbolicated.length > 0 && hasContext,
  };
}

function startupCrumbs(ev) {
  const crumbs =
    ev.entries?.find((e) => e.type === "breadcrumbs")?.data?.values ?? ev.breadcrumbs?.values ?? [];
  const startup = crumbs.filter((c) => c.category === "startup");
  return { all: crumbs.length, startup: startup.length, messages: startup.map((c) => c.message) };
}

async function main() {
  const env = {
    ...loadEnv(join(REPO, "apps", "backend", ".env")),
    ...loadEnv(join(ROOT, ".env")),
    ...process.env,
  };

  const token = env.SENTRY_AUTH_TOKEN || "";
  const org = env.SENTRY_ORG || "homigo-g4";
  let project = env.SENTRY_PROJECT_MOBILE || env.SENTRY_PROJECT || "node-fastify";

  const out = {
    generatedAt: new Date().toISOString(),
    release: RELEASE,
    org,
    project,
    eventId: null,
    issueId: null,
    deviceModel: null,
    androidVersion: null,
    releaseVersion: RELEASE,
    checks: {},
    passCriteria: {},
    overallStatus: "FAIL",
  };

  if (!token) {
    out.error = "SENTRY_AUTH_TOKEN missing";
    writeOut(out);
    process.exit(2);
  }

  const projectsRes = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (projectsRes.ok) {
    const projects = await projectsRes.json();
    const slugs = projects.map((p) => p.slug);
    if (!slugs.includes(project)) {
      project = slugs.includes("node-fastify") ? "node-fastify" : (slugs[0] ?? project);
    }
    out.project = project;
  }

  const cliEnv = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project };
  try {
    const list = execSync(`npx --yes @sentry/cli@2 releases files ${RELEASE} list`, {
      env: cliEnv,
      encoding: "utf8",
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const files = list.trim().split("\n").filter(Boolean);
    const hasMap = files.some((f) => /\.map$/i.test(f));
    const hasJs = files.some((f) => /\.js$/i.test(f));
    out.checks.source_maps_attached = {
      ok: hasMap && hasJs,
      detail: hasMap ? `${files.length} artifact(s) with .map` : `${files.length} file(s); no .map`,
      files: files.slice(0, 30),
    };
    out.checks.release_attached = {
      ok: files.length > 0,
      detail: files.length ? `release ${RELEASE} has ${files.length} artifact(s)` : `no artifacts on ${RELEASE}`,
    };
  } catch (e) {
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 400);
    out.checks.source_maps_attached = { ok: false, detail: msg };
    out.checks.release_attached = { ok: false, detail: msg };
  }

  const queries = [
    "platform:android crash_kind:native_android",
    "platform:android certification:device-native-crash",
    "platform:android",
  ];

  let event = null;
  let issueId = null;

  for (const query of queries) {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/events/?query=${encodeURIComponent(query)}&full=true&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const events = await res.json();
    const list = Array.isArray(events) ? events : [];
    const deviceEvents = list.filter((e) => {
      const certTag = tagValue(e, "certification");
      if (certTag === "homigo-mobile") return false;
      if (e.environment === "certification") return false;
      if (e.platform !== "android" && e.platform !== "native") return false;
      return true;
    });
    if (deviceEvents.length > 0) {
      event = deviceEvents[0];
      issueId = event.groupID ?? event.groupId ?? null;
      break;
    }
  }

  if (!event) {
    out.checks.native_android_event = {
      ok: false,
      detail: "No real platform:android device event found in Sentry",
    };
    writeOut(out);
    process.exit(2);
  }

  const eventId = event.eventID ?? event.id;
  out.eventId = eventId;
  out.issueId = issueId;

  const detailRes = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/events/${eventId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ev = detailRes.ok ? await detailRes.json() : event;

  out.deviceModel =
    tagValue(ev, "device") ??
    ev.context?.device?.model ??
    ev.tags?.find((t) => t.key === "device")?.value ??
    ev.device?.model ??
    null;
  out.androidVersion =
    tagValue(ev, "os") ??
    ev.context?.os?.version ??
    ev.tags?.find((t) => t.key === "os")?.value ??
    null;
  out.releaseVersion = tagValue(ev, "release") ?? ev.release ?? RELEASE;

  out.checks.native_android_event = {
    ok: ev.platform === "android" || ev.platform === "native",
    detail: `platform=${ev.platform}; title=${ev.title ?? ev.message ?? "native crash"}`,
    eventId,
    issueId,
  };

  out.checks.release_attached = {
    ok: !!ev.release && String(ev.release).includes("homigo-mobile"),
    detail: ev.release ? `release=${ev.release}` : "no release on event",
  };

  const sym = analyzeSymbolication(ev);
  out.checks.stack_symbolicated = {
    ok: sym.ok,
    detail: `${sym.symbolicatedCount}/${sym.frameCount} frames; context_line=${sym.hasContext}`,
    sample: sym.sample,
  };

  const crumbs = startupCrumbs(ev);
  out.checks.startup_breadcrumbs = {
    ok: crumbs.startup >= 2,
    detail: `${crumbs.startup} startup breadcrumb(s) of ${crumbs.all} total`,
    messages: crumbs.messages,
  };

  out.checks.user_context = {
    ok: !!ev.user?.id,
    detail: ev.user?.id ? `user.id=${ev.user.id}` : "no user.id on event",
    userId: ev.user?.id ?? null,
  };

  const criteria = [
    "native_android_event",
    "release_attached",
    "source_maps_attached",
    "user_context",
    "startup_breadcrumbs",
    "stack_symbolicated",
  ];
  out.passCriteria = Object.fromEntries(criteria.map((k) => [k, out.checks[k]?.ok ?? false]));
  out.overallStatus = criteria.every((k) => out.checks[k]?.ok) ? "PASS" : "FAIL";

  writeOut(out);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.overallStatus === "PASS" ? 0 : 2);
}

function writeOut(data) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "native-sentry-device-evidence.json"), JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});

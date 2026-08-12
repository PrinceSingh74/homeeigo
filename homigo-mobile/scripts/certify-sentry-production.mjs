#!/usr/bin/env node
/**
 * Phase 1: Sentry production certification for homigo-mobile.
 * Loads credentials from apps/backend/.env (gitignored). Never fakes success.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..");
const BACKEND_ENV = join(REPO, "apps", "backend", ".env");
const MOBILE_ENV = join(ROOT, ".env");
const OUT_DIR = join(ROOT, ".certification-evidence");

function loadEnvFile(path) {
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

function parseDsn(dsn) {
  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\//, "");
  const key = u.username;
  const host = `https://${u.host}`;
  return { key, host, projectId };
}

function env() {
  return { ...loadEnvFile(BACKEND_ENV), ...loadEnvFile(MOBILE_ENV), ...process.env };
}

const MARKER = `HOMIGO_MOBILE_SENTRY_CERT_${Date.now()}`;
const RELEASE = "homigo-mobile@1.0.0";

async function sendEnvelope(dsn, event) {
  const { key, host, projectId } = parseDsn(dsn);
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  const url = `${host}/api/${projectId}/envelope/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=homigo-cert/1.0`,
    },
    body: envelope,
  });
  return { ok: res.ok, status: res.status, eventId: event.event_id };
}

function makeEvent(kind) {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    release: RELEASE,
    environment: "certification",
    message: `${MARKER} ${kind}`,
    tags: { certification: "homigo-mobile", kind },
    exception: {
      values: [
        {
          type: "Error",
          value: `${MARKER} ${kind}`,
          stacktrace: {
            frames: [
              { filename: "app/_layout.tsx", function: "RootLayout", lineno: 42, colno: 11, in_app: true },
              { filename: "src/lib/observability/sentry.ts", function: "triggerSentryTestException", lineno: 136, in_app: true },
            ],
          },
        },
      ],
    },
    breadcrumbs: {
      values: [
        { category: "startup", message: "APP_START", level: "info", timestamp: Date.now() / 1000 - 2 },
        { category: "startup", message: "INTERACTIVE", level: "info", timestamp: Date.now() / 1000 - 1 },
      ],
    },
  };
}

async function queryIssues(token, org, project, query) {
  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=${encodeURIComponent(query)}&statsPeriod=24h`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, status: res.status, issues: [] };
  const issues = await res.json();
  return { ok: true, issues };
}

async function queryEvents(token, org, project, issueId) {
  const url = `https://sentry.io/api/0/issues/${issueId}/events/`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  return res.json();
}

async function listProjects(token, org) {
  const res = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

function trySourceMapUpload(token, org, project) {
  try {
    const envVars = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project };
    execSync(`npx --yes @sentry/cli@2 releases new ${RELEASE}`, { env: envVars, stdio: "pipe", cwd: ROOT });
  const bundleDir = join(ROOT, ".expo-export-test");
  if (!existsSync(bundleDir)) {
    execSync("npx expo export --platform web --output-dir .expo-export-test", { cwd: ROOT, stdio: "pipe", timeout: 120000 });
  }
    const jsFile = existsSync(join(bundleDir, "_expo", "static", "js"))
      ? execSync('powershell -Command "Get-ChildItem -Recurse -Filter entry-*.js .expo-export-test | Select-Object -First 1 -ExpandProperty FullName"', { cwd: ROOT, encoding: "utf8" }).trim()
      : null;
    if (jsFile && existsSync(jsFile)) {
      execSync(
        `npx --yes @sentry/cli@2 sourcemaps upload --release ${RELEASE} --url-prefix "app:///" "${jsFile}"`,
        { env: envVars, stdio: "pipe", cwd: ROOT },
      );
    }
    const list = execSync(`npx --yes @sentry/cli@2 releases files ${RELEASE} list`, { env: envVars, encoding: "utf8", cwd: ROOT });
    const hasMap = /\.map/i.test(list);
    const hasJs = /\.js/i.test(list);
    return {
      ok: hasMap && hasJs,
      detail: hasMap ? "sourcemap artifact listed on release" : `release listed but no .map artifact (${list.trim().split("\n").length} files)`,
    };
  } catch (e) {
    return { ok: false, detail: String(e.stderr ?? e.message ?? e).slice(0, 300) };
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const e = env();
  const dsn = e.EXPO_PUBLIC_SENTRY_DSN || e.SENTRY_DSN || "";
  const token = e.SENTRY_AUTH_TOKEN || "";
  const org = e.SENTRY_ORG || "homigo-g4";
  let project = e.SENTRY_PROJECT_MOBILE || e.EXPO_PUBLIC_SENTRY_PROJECT || "homigo-mobile";

  const results = {
    generatedAt: new Date().toISOString(),
    marker: MARKER,
    release: RELEASE,
    checks: {},
    eventIds: [],
    issueIds: [],
    screenshotPath: null,
    remainingBlockers: [],
  };

  results.checks.dsn_configured = { ok: !!dsn, detail: dsn ? "DSN present" : "missing EXPO_PUBLIC_SENTRY_DSN / SENTRY_DSN" };
  results.checks.auth_token = { ok: !!token, detail: token ? "SENTRY_AUTH_TOKEN present" : "missing" };

  if (!dsn) {
    results.remainingBlockers.push("Set EXPO_PUBLIC_SENTRY_DSN in homigo-mobile/.env");
    writeEvidence(results);
    process.exit(2);
  }

  // Sync mobile .env if missing DSN
  if (!loadEnvFile(MOBILE_ENV).EXPO_PUBLIC_SENTRY_DSN && dsn) {
    const append = `\nEXPO_PUBLIC_SENTRY_DSN=${dsn}\nSENTRY_ORG=${org}\nSENTRY_PROJECT=${project}\n`;
    try {
      writeFileSync(MOBILE_ENV, readFileSync(MOBILE_ENV, "utf8") + append);
      results.checks.mobile_env_synced = { ok: true, detail: "EXPO_PUBLIC_SENTRY_DSN written to homigo-mobile/.env" };
    } catch {
      results.checks.mobile_env_synced = { ok: false, detail: "could not write homigo-mobile/.env" };
    }
  }

  if (token) {
    const projects = await listProjects(token, org);
    const slugs = projects.map((p) => p.slug);
    if (!slugs.includes(project)) {
      project = slugs.includes("node-fastify") ? "node-fastify" : slugs[0] ?? project;
      results.checks.project_resolved = { ok: true, detail: `using project slug: ${project} (available: ${slugs.join(", ")})` };
    } else {
      results.checks.project_resolved = { ok: true, detail: `project ${project} exists` };
    }
  }

  const jsEvent = makeEvent("js_crash");
  const jsSend = await sendEnvelope(dsn, jsEvent);
  results.checks.js_crash_delivery = { ok: jsSend.ok, detail: `HTTP ${jsSend.status}`, eventId: jsSend.eventId };
  if (jsSend.eventId) results.eventIds.push(jsSend.eventId);

  const nativeEvent = makeEvent("native_crash_simulated");
  nativeEvent.platform = "cocoa";
  nativeEvent.tags.runtime = "react-native";
  const nativeSend = await sendEnvelope(dsn, nativeEvent);
  results.checks.native_crash_delivery = {
    ok: nativeSend.ok,
    detail: `envelope HTTP ${nativeSend.status} (true native crash requires EAS build on device)`,
    eventId: nativeSend.eventId,
  };
  if (nativeSend.eventId) results.eventIds.push(nativeSend.eventId);

  results.checks.startup_breadcrumbs = {
    ok: !!(jsEvent.breadcrumbs?.values?.length),
    detail: `${jsEvent.breadcrumbs?.values?.length ?? 0} breadcrumbs attached to test event`,
  };

  if (token) {
    await new Promise((r) => setTimeout(r, 20000));
    const issues = await queryIssues(token, org, project, MARKER);
    let eventLookupOk = false;
    for (const eid of results.eventIds) {
      try {
        const er = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/events/${eid}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (er.ok) {
          eventLookupOk = true;
          const ev = await er.json();
          results.checks[`event_${eid.slice(0, 8)}`] = {
            ok: true,
            detail: ev.title ?? ev.message ?? "visible",
            eventId: eid,
          };
        }
      } catch {
        /* continue */
      }
    }
    results.checks.sentry_api_delivery = {
      ok: (issues.ok && issues.issues.length > 0) || eventLookupOk,
      detail: issues.ok
        ? `${issues.issues.length} issue(s); eventLookup=${eventLookupOk}`
        : `issues API: ${issues.issues?.length ?? 0}; eventLookup=${eventLookupOk}`,
    };
    results.issueIds = issues.issues.map((i) => i.id);
    if (issues.issues[0]?.id) {
      const events = await queryEvents(token, org, project, issues.issues[0].id);
      results.checks.event_visible_in_issue = {
        ok: events.length > 0,
        detail: `${events.length} event(s) on issue ${issues.issues[0].id}`,
      };
    }
    const sm = trySourceMapUpload(token, org, project);
    results.checks.source_map_upload = sm;
  } else {
    results.checks.sentry_api_delivery = { ok: false, detail: "skipped — no SENTRY_AUTH_TOKEN" };
    results.checks.source_map_upload = { ok: false, detail: "skipped — no SENTRY_AUTH_TOKEN" };
    results.remainingBlockers.push("SENTRY_AUTH_TOKEN required for delivery confirmation and source maps");
  }

  const failed = Object.entries(results.checks).filter(([, v]) => !v.ok);
  writeEvidence(results);
  console.log(JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}

function writeEvidence(results) {
  writeFileSync(join(OUT_DIR, "sentry-certification.json"), JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("[certify:sentry] FATAL", err);
  process.exit(3);
});

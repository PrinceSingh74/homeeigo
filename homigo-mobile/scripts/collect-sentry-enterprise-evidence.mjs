#!/usr/bin/env node
/** Sentry enterprise certification — phases 3, 7, 8 evidence collector. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const env = {
  ...loadEnv(join(REPO, "apps", "backend", ".env")),
  ...loadEnv(join(ROOT, ".env")),
  ...process.env,
};

const token = env.SENTRY_AUTH_TOKEN || "";
const org = env.SENTRY_ORG || "homigo-g4";
let project = env.SENTRY_PROJECT || "node-fastify";
const cliEnv = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project };

const REQUIRED_CRUMBS = [
  "APP_START",
  "HYDRATION_START",
  "HYDRATION_END",
  "BOOTSTRAP_START",
  "BOOTSTRAP_END",
  "HOME_RENDER",
  "INTERACTIVE",
  "AUTH_READY",
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const out = { generatedAt: new Date().toISOString(), release: RELEASE, org, project, phases: {} };

  if (!token) {
    out.error = "SENTRY_AUTH_TOKEN missing";
    writeFileSync(join(OUT, "sentry-enterprise-evidence.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  // Resolve project
  const projectsRes = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (projectsRes.ok) {
    const projects = await projectsRes.json();
    const slugs = projects.map((p) => p.slug);
    if (!slugs.includes(project)) project = slugs.includes("node-fastify") ? "node-fastify" : slugs[0];
    out.project = project;
  }

  // Phase 3 — sentry-cli releases
  try {
    const releasesList = execSync("npx --yes @sentry/cli@2 releases list", {
      env: cliEnv,
      encoding: "utf8",
      cwd: ROOT,
    });
    out.phases.source_maps = {
      releases_list: releasesList.trim().split("\n").slice(0, 15),
      release_exists: releasesList.includes(RELEASE),
    };
  } catch (e) {
    out.phases.source_maps = { error: String(e.stderr ?? e.message).slice(0, 300) };
  }

  try {
    const filesList = execSync(`npx --yes @sentry/cli@2 releases files ${RELEASE} list`, {
      env: cliEnv,
      encoding: "utf8",
      cwd: ROOT,
    });
    const files = filesList.trim().split("\n").filter(Boolean);
    const mapCount = files.filter((f) => /\.map$/i.test(f)).length;
    const jsCount = files.filter((f) => /\.js$/i.test(f)).length;
    out.phases.source_maps = {
      ...out.phases.source_maps,
      files_list: files,
      artifact_count: files.length,
      source_map_count: mapCount,
      js_artifact_count: jsCount,
      pass: mapCount > 0 && files.length > 0,
    };
  } catch (e) {
    out.phases.source_maps = {
      ...out.phases.source_maps,
      files_error: String(e.stderr ?? e.message).slice(0, 300),
      artifact_count: 0,
      source_map_count: 0,
      pass: false,
    };
  }

  // Phase 8 — release health
  const releaseRes = await fetch(
    `https://sentry.io/api/0/organizations/${org}/releases/${encodeURIComponent(RELEASE)}/`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (releaseRes.ok) {
    const rel = await releaseRes.json();
    out.phases.release_tracking = {
      release_id: rel.version,
      dateCreated: rel.dateCreated,
      dateReleased: rel.dateReleased,
      newGroups: rel.newGroups,
      commitCount: rel.commitCount,
      projects: rel.projects?.map((p) => p.slug),
    };
  } else {
    out.phases.release_tracking = { ok: false, status: releaseRes.status };
  }

  const healthRes = await fetch(
    `https://sentry.io/api/0/organizations/${org}/releases/${encodeURIComponent(RELEASE)}/health/`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (healthRes.ok) {
    const health = await healthRes.json();
    out.phases.release_tracking = {
      ...out.phases.release_tracking,
      health,
      crash_free_rate: health?.crashFreeUsers ?? health?.crashFreeSessions ?? null,
    };
  }

  // Phase 6/7 — analyze latest cert event
  const certPath = join(OUT, "sentry-certification.json");
  const cert = existsSync(certPath) ? JSON.parse(readFileSync(certPath, "utf8")) : null;
  const eventId = cert?.eventIds?.[0];
  if (eventId) {
    const evRes = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/events/${eventId}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (evRes.ok) {
      const ev = await evRes.json();
      const crumbs =
        ev.entries?.find((e) => e.type === "breadcrumbs")?.data?.values ?? ev.breadcrumbs?.values ?? [];
      const startupMsgs = crumbs.filter((c) => c.category === "startup").map((c) => c.message);
      const missing = REQUIRED_CRUMBS.filter((m) => !startupMsgs.includes(m));

      out.phases.js_crash = {
        eventId,
        issueIds: cert.issueIds,
        timestamp: ev.dateCreated ?? ev.dateReceived,
        environment: ev.tags?.find((t) => t.key === "environment")?.value ?? ev.environment,
        release: ev.tags?.find((t) => t.key === "release")?.value ?? ev.release?.version,
        title: ev.title,
      };

      out.phases.breadcrumbs = {
        total: crumbs.length,
        startup_count: startupMsgs.length,
        startup_messages: startupMsgs,
        required: REQUIRED_CRUMBS,
        missing,
        pass: missing.length === 0,
      };

      out.phases.user_context = {
        user_id: ev.user?.id ?? null,
        user_email: ev.user?.email ?? null,
        role_tag: ev.tags?.find((t) => t.key === "role")?.value ?? null,
        app_version_tag: ev.tags?.find((t) => t.key === "app_version")?.value ?? null,
        environment: ev.tags?.find((t) => t.key === "environment")?.value ?? null,
        pass: !!(ev.user?.id && ev.tags?.some((t) => t.key === "app_version")),
      };
    }
  }

  // Phase 5 — native events query
  for (const [platform, query] of [
    ["android", "platform:android"],
    ["ios", "platform:cocoa"],
  ]) {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/events/?query=${encodeURIComponent(query)}&full=true&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const events = res.ok ? await res.json() : [];
    const real = (Array.isArray(events) ? events : []).filter(
      (e) => !e.title?.includes("HOMIGO_MOBILE_SENTRY_CERT") && !e.message?.includes("HOMIGO_MOBILE_SENTRY_CERT"),
    );
    out.phases.native_crashes = out.phases.native_crashes ?? {};
    out.phases.native_crashes[platform] = {
      count: real.length,
      events: real.slice(0, 3).map((e) => ({
        eventId: e.eventID ?? e.id,
        title: e.title,
        device: e.tags?.find((t) => t.key === "device")?.value,
        os: e.tags?.find((t) => t.key === "os")?.value,
      })),
      pass: real.length > 0,
    };
  }

  // Code audit — AUTH_READY in sentry allowlist
  const sentryTs = readFileSync(join(ROOT, "src/lib/observability/sentry.ts"), "utf8");
  out.phases.breadcrumb_wiring = {
    auth_ready_in_allowlist: sentryTs.includes('"AUTH_READY"'),
    required_markers_in_startup_trace: REQUIRED_CRUMBS.filter((m) => sentryTs.includes(`"${m}"`)),
  };

  writeFileSync(join(OUT, "sentry-enterprise-evidence.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});

#!/usr/bin/env node
/** Deep Sentry native certification probe — strict PASS criteria. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, ".certification-evidence");

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

function analyzeSymbolication(ev) {
  const frames =
    ev?.entries?.find((e) => e.type === "exception")?.data?.values?.[0]?.stacktrace?.frames ?? [];
  const symbolicated = frames.filter(
    (f) => f.function && f.function !== "<unknown>" && f.filename && !/^\d+$/.test(f.filename),
  );
  const hasContext = frames.some((f) => f.context_line);
  return {
    frameCount: frames.length,
    symbolicatedCount: symbolicated.length,
    hasContext,
    sample: symbolicated.slice(-3).map((f) => ({ file: f.filename, fn: f.function, line: f.lineno })),
    ok: symbolicated.length > 0 && frames.some((f) => f.in_app) && hasContext,
  };
}

async function main() {
  const env = {
    ...loadEnvFile(join(REPO, "apps", "backend", ".env")),
    ...loadEnvFile(join(ROOT, ".env")),
    ...process.env,
  };

  const token = env.SENTRY_AUTH_TOKEN || "";
  const org = env.SENTRY_ORG || "homigo-g4";
  let project = env.SENTRY_PROJECT_MOBILE || env.EXPO_PUBLIC_SENTRY_PROJECT || env.SENTRY_PROJECT || "homigo-mobile";
  const release = "homigo-mobile@1.0.0";
  const certPath = join(OUT, "sentry-certification.json");
  const cert = existsSync(certPath) ? JSON.parse(readFileSync(certPath, "utf8")) : null;
  const eventId = cert?.eventIds?.[0] ?? null;

  const results = { generatedAt: new Date().toISOString(), release, org, project, checks: {} };

  results.checks.dsn_configured = {
    ok: !!(env.EXPO_PUBLIC_SENTRY_DSN || env.SENTRY_DSN),
    detail: env.EXPO_PUBLIC_SENTRY_DSN
      ? "EXPO_PUBLIC_SENTRY_DSN in env"
      : env.SENTRY_DSN
        ? "SENTRY_DSN in backend env"
        : "missing",
  };

  results.checks.auth_token = {
    ok: !!token,
    detail: token ? "SENTRY_AUTH_TOKEN present" : "missing",
  };

  if (token) {
    const projectsRes = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (projectsRes.ok) {
      const projects = await projectsRes.json();
      const slugs = projects.map((p) => p.slug);
      results.availableProjects = slugs;
      if (!slugs.includes(project)) {
        project = slugs.includes("node-fastify") ? "node-fastify" : (slugs[0] ?? project);
      }
      results.projectResolved = project;
    }
  }

  if (token) {
    const cliEnv = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project };
    try {
      const list = execSync(`npx --yes @sentry/cli@2 releases files ${release} list`, {
        env: cliEnv,
        encoding: "utf8",
        cwd: ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const files = list.trim().split("\n").filter(Boolean);
      const hasMap = files.some((f) => /\.map$/i.test(f));
      const hasJs = files.some((f) => /\.js$/i.test(f));
      results.checks.source_map_upload = {
        ok: hasMap && hasJs,
        detail: hasMap ? `${files.length} artifact(s) including .map` : `${files.length} file(s); no .map on release ${release}`,
        files: files.slice(0, 20),
      };
      results.checks.release_artifacts = {
        ok: files.length > 0 && hasMap,
        detail: files.length ? files.join(" | ") : `release ${release} has zero artifacts`,
      };
    } catch (e) {
      const msg = String(e.stderr ?? e.message ?? e).slice(0, 400);
      results.checks.source_map_upload = { ok: false, detail: msg };
      results.checks.release_artifacts = { ok: false, detail: msg };
    }
  } else {
    results.checks.source_map_upload = { ok: false, detail: "no SENTRY_AUTH_TOKEN" };
    results.checks.release_artifacts = { ok: false, detail: "no SENTRY_AUTH_TOKEN" };
  }

  if (token && eventId) {
    const res = await fetch(`https://sentry.io/api/0/projects/${org}/${project}/events/${eventId}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const ev = await res.json();
      const sym = analyzeSymbolication(ev);
      results.checks.stack_trace_symbolicated = {
        ok: sym.ok,
        detail: `${sym.symbolicatedCount}/${sym.frameCount} named frames; context_line=${sym.hasContext}`,
        sample: sym.sample,
        eventId,
      };
      const crumbs =
        ev.entries?.find((e) => e.type === "breadcrumbs")?.data?.values ?? ev.breadcrumbs?.values ?? [];
      results.checks.startup_breadcrumbs = {
        ok: crumbs.some((c) => c.category === "startup"),
        detail: `${crumbs.length} breadcrumb(s); startup=${crumbs.filter((c) => c.category === "startup").length}`,
      };
      results.checks.user_context_runtime = {
        ok: !!ev.user?.id,
        detail: ev.user?.id ? `user.id=${ev.user.id} on event` : "no user.id on cert envelope event",
      };
    } else {
      results.checks.stack_trace_symbolicated = { ok: false, detail: `event ${eventId} HTTP ${res.status}` };
    }
  } else {
    results.checks.stack_trace_symbolicated = { ok: false, detail: "no cert event id" };
  }

  if (token) {
    for (const [key, q] of [
      ["native_android_crash", "platform:android"],
      ["native_ios_crash", "platform:cocoa"],
    ]) {
      const res = await fetch(
        `https://sentry.io/api/0/projects/${org}/${project}/events/?query=${encodeURIComponent(q)}&full=true&limit=10`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const events = res.ok ? await res.json() : [];
      const list = Array.isArray(events) ? events : [];
      const deviceCrashes = list.filter((e) => e.tags?.some?.((t) => t.key === "certification") !== true);
      results.checks[key] = {
        ok: deviceCrashes.length > 0,
        detail: `${deviceCrashes.length} non-cert ${q} event(s) in last query — requires EAS build + device crash`,
      };
    }
  } else {
    results.checks.native_android_crash = { ok: false, detail: "no token" };
    results.checks.native_ios_crash = { ok: false, detail: "no token" };
  }

  const sentryTs = readFileSync(join(ROOT, "src/lib/observability/sentry.ts"), "utf8");
  results.checks.native_sdk_enabled = {
    ok: sentryTs.includes("enableNative: true") && sentryTs.includes("enableNativeCrashHandling: true"),
    detail: "enableNative + enableNativeCrashHandling in sentry.ts",
  };
  results.checks.user_context_wiring = {
    ok: readFileSync(join(ROOT, "src/stores/auth-store.ts"), "utf8").includes("setSentryUser"),
    detail: "auth-store calls setSentryUser on login/logout",
  };
  results.checks.startup_breadcrumbs_wiring = {
    ok: readFileSync(join(ROOT, "src/lib/startup-trace.ts"), "utf8").includes("addStartupBreadcrumb"),
    detail: "startup-trace calls addStartupBreadcrumb",
  };

  const passCriteria = ["source_map_upload", "native_android_crash", "native_ios_crash", "stack_trace_symbolicated"];
  results.passCriteria = Object.fromEntries(passCriteria.map((k) => [k, results.checks[k]?.ok ?? false]));
  results.overallStatus = passCriteria.every((k) => results.checks[k]?.ok) ? "PASS" : "BLOCKED";

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "sentry-native-probe.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.overallStatus === "PASS" ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});

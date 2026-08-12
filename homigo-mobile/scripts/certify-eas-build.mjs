#!/usr/bin/env node
/**
 * EAS production build certification — static + CLI checks.
 * Cloud builds require eas-cli login + valid projectId (see eas-production-certification.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".certification-evidence");
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, cwd: ROOT, encoding: "utf8", ...opts });
}

function loadJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8"));
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const appJson = loadJson("app.json");
  const easJson = loadJson("eas.json");
  const pkgJson = loadJson("package.json");
  const projectId = appJson.expo?.extra?.eas?.projectId;
  const placeholder = projectId === PLACEHOLDER_ID;

  const results = {
    generatedAt: new Date().toISOString(),
    projectId,
    checks: {},
    profiles: {},
    builds: [],
    blockers: [],
  };

  const easWhich = run("npx eas-cli --version");
  results.checks.eas_cli = {
    ok: easWhich.status === 0,
    detail: (easWhich.stdout || easWhich.stderr || "").trim(),
  };

  const whoami = run("npx eas-cli whoami");
  results.checks.eas_login = {
    ok: whoami.status === 0,
    detail: (whoami.stdout || whoami.stderr || "").trim(),
  };

  results.checks.project_id = {
    ok: !placeholder && !!projectId,
    detail: placeholder
      ? "app.json extra.eas.projectId is placeholder — run: npx eas-cli init"
      : projectId,
  };

  results.checks.runtime_version = {
    ok: !!appJson.expo?.runtimeVersion,
    detail: JSON.stringify(appJson.expo?.runtimeVersion ?? null),
  };

  const hasUpdatesPkg = !!pkgJson.dependencies?.["expo-updates"];
  const hasUpdatesPlugin = (appJson.expo?.plugins ?? []).some(
    (p) => p === "expo-updates" || p?.[0] === "expo-updates",
  );
  results.checks.expo_updates = {
    ok: hasUpdatesPkg && hasUpdatesPlugin,
    detail: hasUpdatesPkg
      ? hasUpdatesPlugin
        ? `expo-updates@${pkgJson.dependencies["expo-updates"]}`
        : "package installed but expo-updates plugin missing in app.json"
      : "expo-updates not installed",
  };

  results.checks.updates_url = {
    ok: !!appJson.expo?.updates?.url && !placeholder,
    detail: appJson.expo?.updates?.url ?? "missing — set by eas init after project link",
  };

  const expectedChannels = {
    development: "development",
    preview: "preview",
    "preview-aab": "preview",
    production: "production",
  };
  for (const [profile, channel] of Object.entries(expectedChannels)) {
    const buildChannel = easJson.build?.[profile]?.channel;
    const updateChannel = easJson.update?.[profile]?.channel;
    results.profiles[profile] = {
      defined: !!easJson.build?.[profile],
      buildChannel,
      updateChannel,
      androidBuildType: easJson.build?.[profile]?.android?.buildType ?? null,
      channelOk: buildChannel === channel,
      updateProfileOk: profile === "preview-aab" ? true : updateChannel === channel,
    };
  }

  results.checks.release_channels = {
    ok: Object.values(results.profiles).every((p) => p.channelOk && p.updateProfileOk),
    detail: Object.entries(results.profiles)
      .map(([k, v]) => `${k}: build=${v.buildChannel ?? "—"} update=${v.updateChannel ?? "—"}`)
      .join("; "),
  };

  results.checks.android_apk_profile = {
    ok: easJson.build?.preview?.android?.buildType === "apk",
    detail: `preview.android.buildType=${easJson.build?.preview?.android?.buildType ?? "—"}`,
  };

  results.checks.android_aab_profile = {
    ok:
      easJson.build?.production?.android?.buildType === "app-bundle" &&
      easJson.build?.["preview-aab"]?.android?.buildType === "app-bundle",
    detail: `production=${easJson.build?.production?.android?.buildType}, preview-aab=${easJson.build?.["preview-aab"]?.android?.buildType}`,
  };

  results.checks.ios_bundle_id = {
    ok: !!appJson.expo?.ios?.bundleIdentifier,
    detail: appJson.expo?.ios?.bundleIdentifier ?? "missing",
  };

  const doctor = run("npx expo-doctor", { timeout: 120000 });
  const doctorOut = (doctor.stdout || "") + (doctor.stderr || "");
  results.checks.expo_doctor = {
    ok: doctor.status === 0,
    detail: doctorOut.includes("checks passed")
      ? doctorOut.match(/\d+\/\d+ checks passed/)?.[0] ?? doctorOut.slice(0, 300)
      : doctorOut.slice(0, 500),
  };

  const exportVerify = run("npx expo export --platform web --output-dir .expo-export-certify", {
    timeout: 180000,
  });
  results.checks.js_bundle_export = {
    ok: exportVerify.status === 0,
    detail: exportVerify.status === 0 ? "expo export --platform web succeeded" : exportVerify.stderr?.slice(0, 300),
  };

  if (!results.checks.eas_login.ok) {
    results.blockers.push("Run: npx eas-cli login");
  }
  if (placeholder) {
    results.blockers.push("Run: cd homigo-mobile && npx eas-cli init");
  }
  if (!results.checks.updates_url.ok && !placeholder) {
    results.blockers.push("Re-run eas init or add expo.updates.url to app.json");
  }

  const staticOk =
    results.checks.expo_updates.ok &&
    results.checks.release_channels.ok &&
    results.checks.android_apk_profile.ok &&
    results.checks.android_aab_profile.ok &&
    results.checks.ios_bundle_id.ok &&
    results.checks.js_bundle_export.ok;

  results.summary = {
    staticConfig: staticOk ? "PASS" : "FAIL",
    cloudBuild: results.checks.eas_login.ok && results.checks.project_id.ok ? "READY_TO_ATTEMPT" : "BLOCKED",
  };

  if (results.checks.eas_login.ok && results.checks.project_id.ok) {
    for (const profile of ["preview", "preview-aab", "production"]) {
      const r = run(
        `npx eas-cli build --profile ${profile} --platform android --non-interactive --no-wait`,
        { timeout: 120000 },
      );
      const output = (r.stdout || "") + (r.stderr || "");
      results.builds.push({
        profile,
        platform: "android",
        ok: r.status === 0,
        buildUrl: output.match(/https:\/\/expo\.dev\/[^\s]+/)?.[0] ?? null,
        output: output.slice(0, 500),
      });
    }
  }

  writeFileSync(join(OUT, "eas-build.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  const exitCode = results.blockers.length ? 2 : staticOk ? 0 : 1;
  process.exit(exitCode);
}

main();

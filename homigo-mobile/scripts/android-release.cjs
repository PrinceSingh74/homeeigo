/**
 * Customer app Android release build: `npm run android:release [-- --internal]`.
 *
 * Mirrors homigo-partner-mobile/scripts/android-release.cjs, plus what the customer app's first release
 * build taught (2026-10-01):
 *
 * 1. Metro server root. Expo picks the monorepo root (D:\homigo) as Metro's server root and
 *    `createBundleReleaseJsAndAssets` fails with "Unable to resolve module ./index.js". The build runs with
 *    EXPO_NO_METRO_WORKSPACE_ROOT=1.
 * 2. Stale bundle. The environment is not a Gradle input, so a plain `assembleRelease` reported SUCCESS
 *    with an OLD cached JS bundle — one that carried the production Sentry DSN. The bundle task is always
 *    re-run (`--rerun`).
 * 3. Release environment, refused BEFORE building (messages name variables, never values):
 *    - EXPO_PUBLIC_API_URL missing, local / emulator-host, or not https (the release app fails closed on
 *      loopback at runtime anyway — this stops the misleading artefact from being produced at all);
 *    - EXPO_PUBLIC_E2E_NATIVE set.
 * 4. Sentry. A production build keeps the configured DSN. `--internal` (an installable test build) blanks
 *    it — with a single space, because Expo's env loader treats an EMPTY variable as unset and refills it
 *    from .env — so test sessions never reach the production Sentry project. Source-map upload is off
 *    for --internal (SENTRY_DISABLE_AUTO_UPLOAD).
 * 5. After the build, the APK is checked: no Sentry DSN key in an --internal bundle, the API url present
 *    (positive control: a scan that finds nothing may be broken), and the signing certificate reported.
 *    android/app/build.gradle signs `release` with the DEBUG keystore — this is an installable APK, not a
 *    store artefact; a store upload needs the owner's upload keystore (EXTERNAL). Nothing here invents one.
 *
 * Extra arguments after the flags are passed to Gradle (e.g. -PreactNativeArchitectures=x86_64).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LOCAL = /^(https?):\/\/(localhost|127\.\d+\.\d+\.\d+|10\.0\.2\.2|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

function checkAndroidReleaseEnv(env) {
  const errors = [];
  const warnings = [];
  const api = (env.EXPO_PUBLIC_API_URL || "").trim();
  if (!api) errors.push("EXPO_PUBLIC_API_URL is not set — a release build has no backend to call.");
  else if (LOCAL.test(api)) errors.push("EXPO_PUBLIC_API_URL points at a local / emulator-host address; the release app refuses it.");
  else if (!/^https:\/\//i.test(api)) errors.push("EXPO_PUBLIC_API_URL must be an https:// url.");
  if (env.EXPO_PUBLIC_E2E_NATIVE) errors.push("EXPO_PUBLIC_E2E_NATIVE is a test switch and must not be set for a release.");
  if (!(env.GOOGLE_MAPS_API_KEY || "").trim()) warnings.push("GOOGLE_MAPS_API_KEY is not set — maps fall back to their 'unavailable' state.");
  return { errors, warnings };
}

/** The environment Gradle (and through it, Metro) builds with. */
function releaseBuildEnv(env, opts = {}) {
  const out = { ...env, NODE_ENV: "production", EXPO_NO_METRO_WORKSPACE_ROOT: "1" };
  if (opts.internal) {
    out.EXPO_PUBLIC_SENTRY_DSN = " "; // blank but SET: an empty value would be refilled from .env
    out.SENTRY_DISABLE_AUTO_UPLOAD = "true";
  }
  return out;
}

/** The key part of a DSN (https://<key>@host/project), or null. Never logged. */
function dsnKey(dsn) {
  const m = /^https?:\/\/([0-9a-f]{16,})@/i.exec((dsn || "").trim());
  return m ? m[1] : null;
}

/** Scan an extracted JS bundle for the DSN key and the API url (positive control). */
function inspectBundle(bundle, { dsn, apiUrl }) {
  const key = dsnKey(dsn);
  return {
    dsnEmbedded: key ? bundle.includes(key) : false,
    apiUrlPresent: apiUrl ? bundle.includes(apiUrl.trim()) : false,
  };
}

module.exports = { checkAndroidReleaseEnv, releaseBuildEnv, dsnKey, inspectBundle };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  // Read .env files the way the Expo CLI will during the build.
  require("@expo/env").load(root, { force: false, silent: true });
  const internal = process.argv.includes("--internal");
  const { errors, warnings } = checkAndroidReleaseEnv(process.env);
  for (const w of warnings) console.warn(`[android-release] warning: ${w}`);
  for (const e of errors) console.error(`[android-release] ERROR: ${e}`);
  if (errors.length > 0) process.exit(1);

  const configuredDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const extra = process.argv.slice(2).filter((a) => a !== "--internal");
  const r = spawnSync(gradlew, [":app:createBundleReleaseJsAndAssets", "--rerun", "assembleRelease", "--console=plain", ...extra], {
    cwd: path.join(root, "android"),
    env: releaseBuildEnv(process.env, { internal }),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);

  // ---- verify the artefact ----
  const apk = path.join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!fs.existsSync(apk)) {
    console.error("[android-release] ERROR: build reported success but app-release.apk is missing");
    process.exit(1);
  }
  const unzip = spawnSync("unzip", ["-p", apk, "assets/index.android.bundle"], { maxBuffer: 256 * 1024 * 1024 });
  if (unzip.status !== 0 || !unzip.stdout?.length) {
    console.error("[android-release] ERROR: could not read assets/index.android.bundle from the APK (is `unzip` on PATH?)");
    process.exit(1);
  }
  const bundle = unzip.stdout.toString("latin1");
  const seen = inspectBundle(bundle, { dsn: configuredDsn, apiUrl: process.env.EXPO_PUBLIC_API_URL });
  if (!seen.apiUrlPresent) {
    console.error("[android-release] ERROR: the configured EXPO_PUBLIC_API_URL is not in the bundle — the scan or the build is wrong");
    process.exit(1);
  }
  if (internal && seen.dsnEmbedded) {
    console.error("[android-release] ERROR: the configured Sentry DSN is embedded in an --internal build");
    process.exit(1);
  }
  const cert = spawnSync("keytool", ["-printcert", "-jarfile", apk], { encoding: "utf8" });
  const debugSigned = /CN=Android Debug/i.test(cert.stdout || "");
  console.log(
    `[android-release] OK ${internal ? "(internal)" : "(production config)"} — api url present, ` +
      `sentry dsn ${seen.dsnEmbedded ? "EMBEDDED" : "not embedded"}, ` +
      `signed with ${debugSigned ? "the DEBUG keystore (installable APK, NOT a store artefact)" : cert.status === 0 ? "a non-debug certificate" : "an unverified certificate (keytool unavailable)"}`,
  );
}

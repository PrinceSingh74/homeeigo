/**
 * Partner app Android release build: `npm run android:release [-- --allow-test-payments]`.
 *
 * 1. Metro server root. In this monorepo Expo picks D:\homigo (the workspace root) as Metro's server
 *    root, and `createBundleReleaseJsAndAssets` then fails with "Unable to resolve module ./index.js from
 *    <repo root>". The release build runs with EXPO_NO_METRO_WORKSPACE_ROOT=1 (Metro rooted at the app).
 * 2. Release environment. Refuses an environment that would ship a broken or test-wired app: no / local /
 *    plain-http EXPO_PUBLIC_API_URL, the native E2E switch, or a Razorpay TEST key — unless the build is
 *    declared an internal test build with --allow-test-payments. A Live key is the owner's credential;
 *    nothing here invents one. Messages name variables, never their values.
 *
 * Signing: android/app/build.gradle signs `release` with the debug keystore. A store upload needs the
 * owner's upload keystore (EXTERNAL) — this script builds an installable APK, not a store artefact.
 */
const path = require("path");
const { spawnSync } = require("child_process");

const LOCAL = /^(https?):\/\/(localhost|127\.\d+\.\d+\.\d+|10\.0\.2\.2|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

function checkAndroidReleaseEnv(env, opts = {}) {
  const errors = [];
  const warnings = [];
  const api = (env.EXPO_PUBLIC_API_URL || "").trim();
  if (!api) errors.push("EXPO_PUBLIC_API_URL is not set — a release build has no backend to call.");
  else if (LOCAL.test(api)) errors.push("EXPO_PUBLIC_API_URL points at a local / emulator-host address.");
  else if (!/^https:\/\//i.test(api)) errors.push("EXPO_PUBLIC_API_URL must be an https:// url.");
  if (env.EXPO_PUBLIC_E2E_NATIVE) errors.push("EXPO_PUBLIC_E2E_NATIVE is a test switch and must not be set for a release.");
  const rzp = (env.EXPO_PUBLIC_RAZORPAY_KEY_ID || "").trim();
  if (/^rzp_test_/.test(rzp)) {
    if (opts.allowTestPayments) warnings.push("EXPO_PUBLIC_RAZORPAY_KEY_ID is a Test-mode key — internal test build only.");
    else errors.push("EXPO_PUBLIC_RAZORPAY_KEY_ID is a Test-mode key. Supply the Live key, or pass --allow-test-payments for an internal test build.");
  } else if (!rzp) warnings.push("EXPO_PUBLIC_RAZORPAY_KEY_ID is not set — in-app payments are unavailable in this build.");
  if (!(env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim()) warnings.push("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set — the Live Map shows its 'unavailable' fallback.");
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
  const allowTestPayments = process.argv.includes("--allow-test-payments");
  const internal = process.argv.includes("--internal");
  const { errors, warnings } = checkAndroidReleaseEnv(process.env, { allowTestPayments });
  for (const w of warnings) console.warn(`[android-release] warning: ${w}`);
  for (const e of errors) console.error(`[android-release] ERROR: ${e}`);
  if (errors.length > 0) process.exit(1);
  const configuredDsn = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const extra = process.argv.slice(2).filter((a) => a !== "--allow-test-payments" && a !== "--internal");
  // `--rerun` on the JS bundle task (2026-10-01, ported from the customer app): Gradle otherwise
  // reuses a bundle cached under an EARLIER environment — the customer app once shipped a stale
  // bundle carrying the production Sentry DSN into an internal build exactly that way.
  const r = spawnSync(gradlew, [":app:createBundleReleaseJsAndAssets", "--rerun", "assembleRelease", "--console=plain", ...extra], {
    cwd: path.join(root, "android"),
    env: releaseBuildEnv(process.env, { internal }),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);

  // ---- verify the artefact: a green Gradle exit says nothing about what was bundled ----
  const fs = require("fs");
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
  const seen = inspectBundle(unzip.stdout.toString("latin1"), { dsn: configuredDsn, apiUrl: process.env.EXPO_PUBLIC_API_URL });
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

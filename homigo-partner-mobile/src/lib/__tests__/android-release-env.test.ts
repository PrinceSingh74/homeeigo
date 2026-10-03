import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Partner app release path (2026-09-30). `gradlew assembleRelease` failed at
 * `createBundleReleaseJsAndAssets` ("Unable to resolve module ./index.js from D:\homigo/.") because
 * Expo picks the monorepo root as Metro's server root; it builds with EXPO_NO_METRO_WORKSPACE_ROOT=1.
 * `npm run android:release` sets that and refuses an environment that would ship a broken or
 * test-wired app: no / local / plain-http API url, the native E2E switch, or a Test-mode payment key
 * without an explicit "this is an internal test build" flag. Messages name variables, never values.
 */
const require = createRequire(import.meta.url);
const { checkAndroidReleaseEnv, releaseBuildEnv, dsnKey, inspectBundle } = require(join(import.meta.dirname, "..", "..", "..", "scripts", "android-release.cjs")) as {
  checkAndroidReleaseEnv(env: Record<string, string | undefined>, opts?: { allowTestPayments?: boolean }): { errors: string[]; warnings: string[] };
  releaseBuildEnv(env: Record<string, string | undefined>, opts?: { internal?: boolean }): Record<string, string | undefined>;
  dsnKey(dsn: string | undefined): string | null;
  inspectBundle(bundle: string, o: { dsn?: string; apiUrl?: string }): { dsnEmbedded: boolean; apiUrlPresent: boolean };
};

const good = { EXPO_PUBLIC_API_URL: "https://api.homeeigo.com", EXPO_PUBLIC_RAZORPAY_KEY_ID: "rzp_live_ABCDEFGHIJ", EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: "AIza" + "B".repeat(35) };

test("a complete https environment with a Live payment key passes", () => {
  assert.deepEqual(checkAndroidReleaseEnv(good).errors, []);
});

test("missing, local or plain-http API url is refused", () => {
  for (const v of [undefined, "", "http://localhost:3000", "http://10.0.2.2:3000", "http://127.0.0.1:3100", "http://api.homeeigo.com"]) {
    assert.ok(checkAndroidReleaseEnv({ ...good, EXPO_PUBLIC_API_URL: v }).errors.length > 0, String(v));
  }
});

test("the native E2E switch is refused in a release", () => {
  assert.ok(checkAndroidReleaseEnv({ ...good, EXPO_PUBLIC_E2E_NATIVE: "1" }).errors.length > 0);
});

test("a Test-mode payment key is refused unless the build is declared an internal test build", () => {
  const env = { ...good, EXPO_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_ABCDEFGHIJ" };
  assert.ok(checkAndroidReleaseEnv(env).errors.some((e) => /RAZORPAY/.test(e)));
  const allowed = checkAndroidReleaseEnv(env, { allowTestPayments: true });
  assert.deepEqual(allowed.errors, []);
  assert.ok(allowed.warnings.some((w) => /RAZORPAY/.test(w)));
});

test("no Maps key is a warning (the Live Map shows its fallback), never an error", () => {
  const r = checkAndroidReleaseEnv({ ...good, EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: undefined });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /GOOGLE_MAPS/.test(w)));
});

test("the build runs Metro from the app, not the monorepo root", () => {
  assert.equal(releaseBuildEnv({}).EXPO_NO_METRO_WORKSPACE_ROOT, "1");
  assert.equal(releaseBuildEnv({}).NODE_ENV, "production");
});

// 2026-10-01 — parity with the customer app: internal builds carry no production DSN, and the built
// bundle is scanned with the API url as a positive control.
const DSN = "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42";

test("an --internal build blanks the DSN with a SET value (an empty one would be refilled from .env)", () => {
  const env = releaseBuildEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN }, { internal: true });
  assert.equal(env.EXPO_PUBLIC_SENTRY_DSN, " ");
  assert.equal(env.SENTRY_DISABLE_AUTO_UPLOAD, "true");
  assert.equal(releaseBuildEnv({ EXPO_PUBLIC_SENTRY_DSN: DSN }).EXPO_PUBLIC_SENTRY_DSN, DSN);
});

test("the bundle scan finds the DSN key and requires the API url as a positive control", () => {
  assert.equal(dsnKey(DSN), "0123456789abcdef0123456789abcdef");
  assert.equal(dsnKey(" "), null);
  const api = "https://api.homeeigo.com";
  assert.deepEqual(inspectBundle(`a="${api}";b="${DSN}"`, { dsn: DSN, apiUrl: api }), { dsnEmbedded: true, apiUrlPresent: true });
  assert.deepEqual(inspectBundle(`a="${api}"`, { dsn: DSN, apiUrl: api }), { dsnEmbedded: false, apiUrlPresent: true });
  // An empty bundle is a broken scan or build — never a clean pass.
  assert.equal(inspectBundle("", { dsn: DSN, apiUrl: api }).apiUrlPresent, false);
});

test("messages never contain a value", () => {
  const r = checkAndroidReleaseEnv({ EXPO_PUBLIC_API_URL: "http://localhost:3000", EXPO_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_SECRETISH123" });
  assert.ok(!JSON.stringify(r).includes("rzp_test_SECRETISH123"));
  assert.ok(!JSON.stringify(r).includes("localhost:3000"));
});

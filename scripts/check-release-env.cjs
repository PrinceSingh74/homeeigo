/**
 * Release-environment check for the customer web and admin Next.js apps (2026-10-01).
 *
 * Same contract as apps/partner-web/scripts/release-env.cjs, which partner web already runs: both apps
 * proxy `/api/*` to `BACKEND_ORIGIN || NEXT_PUBLIC_API_URL || http://127.0.0.1:3000`, so a release
 * built without a backend variable ships an app that talks to localhost and nobody notices until
 * users do. `npm run build:release` runs this first and refuses such an environment.
 *
 * Customer web additionally builds canonical URLs, the sitemap and robots.txt from
 * NEXT_PUBLIC_SITE_URL, which silently defaults to a placeholder domain — a release must name it.
 *
 * Never prints a value — only variable names — so a key cannot end up in a build log.
 *
 *   node scripts/check-release-env.cjs --app apps/web [--require-site-url]
 */
const path = require("path");

const LOCAL = /^(https?|wss?):\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|10\.0\.2\.2)(:\d+)?(\/|$)/i;

function checkReleaseEnv(env, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!env.BACKEND_ORIGIN && !env.NEXT_PUBLIC_API_URL) {
    errors.push("Neither BACKEND_ORIGIN nor NEXT_PUBLIC_API_URL is set — the /api proxy would fall back to localhost.");
  }
  for (const name of ["BACKEND_ORIGIN", "NEXT_PUBLIC_API_URL"]) {
    const v = env[name];
    if (!v) continue;
    if (LOCAL.test(v)) errors.push(`${name} points at a local address.`);
    else if (!/^https:\/\//i.test(v)) errors.push(`${name} must be an https:// origin.`);
  }
  if (env.NEXT_PUBLIC_WS_URL) {
    if (LOCAL.test(env.NEXT_PUBLIC_WS_URL)) errors.push("NEXT_PUBLIC_WS_URL points at a local address.");
    else if (!/^wss:\/\//i.test(env.NEXT_PUBLIC_WS_URL)) errors.push("NEXT_PUBLIC_WS_URL must be a wss:// url.");
  } else {
    warnings.push("NEXT_PUBLIC_WS_URL is not set — the socket is derived from the API url, or falls back to port 3000 on the page host.");
  }
  if (env.NEXT_PUBLIC_API_PORT) errors.push("NEXT_PUBLIC_API_PORT is a development override and must not be set for a release.");
  if (env.NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true") {
    errors.push("NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA is on — a release would show demo services, prices and offers to customers.");
  }
  if (opts.requireSiteUrl) {
    const site = env.NEXT_PUBLIC_SITE_URL;
    if (!site) errors.push("NEXT_PUBLIC_SITE_URL is not set — canonical URLs and the sitemap would use a placeholder domain.");
    else if (LOCAL.test(site)) errors.push("NEXT_PUBLIC_SITE_URL points at a local address.");
    else if (!/^https:\/\//i.test(site)) errors.push("NEXT_PUBLIC_SITE_URL must be an https:// origin.");
  }
  if (!env.NEXT_PUBLIC_SENTRY_DSN) warnings.push("NEXT_PUBLIC_SENTRY_DSN is not set — browser errors will not be reported.");
  return { errors, warnings };
}

module.exports = { checkReleaseEnv };

if (require.main === module) {
  const args = process.argv.slice(2);
  const appArg = args[args.indexOf("--app") + 1];
  if (!appArg || appArg.startsWith("--")) {
    console.error("usage: check-release-env.cjs --app <path-to-next-app> [--require-site-url]");
    process.exit(2);
  }
  const appDir = path.resolve(process.cwd(), appArg);
  // Read .env.production / .env.local / .env exactly as `next build` will (production mode).
  require(require.resolve("@next/env", { paths: [appDir] })).loadEnvConfig(appDir, false);
  const { errors, warnings } = checkReleaseEnv(process.env, { requireSiteUrl: args.includes("--require-site-url") });
  for (const w of warnings) console.warn(`[release-env] warning: ${w}`);
  for (const e of errors) console.error(`[release-env] ERROR: ${e}`);
  if (errors.length > 0) {
    console.error(`[release-env] refusing to build a release of ${appArg}. Set the variables above.`);
    process.exit(1);
  }
  console.log("[release-env] ok");
}

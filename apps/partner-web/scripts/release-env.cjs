/**
 * Release-environment check for partner web.
 *
 * `next.config.js` proxies `/api/*` to `BACKEND_ORIGIN || "http://localhost:3000"`, so a production
 * build made without a backend variable ships an app that talks to localhost and nobody notices until
 * partners do. `npm run build:release` runs this first and refuses such an environment;
 * `npm run build` (CI's compile check) only prints the same findings as warnings.
 *
 * Never prints a value — only variable names — so a key cannot end up in a build log.
 *
 *   node scripts/release-env.cjs        exit 1 on any error
 */
const LOCAL = /^(https?|wss?):\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

function checkReleaseEnv(env) {
  const errors = [];
  const warnings = [];
  const backend = env.BACKEND_ORIGIN || env.NEXT_PUBLIC_API_URL;
  if (!backend) {
    errors.push("Neither BACKEND_ORIGIN nor NEXT_PUBLIC_API_URL is set — the /api proxy would fall back to http://localhost:3000.");
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
  }
  if (env.NEXT_PUBLIC_API_PORT) errors.push("NEXT_PUBLIC_API_PORT is a development override and must not be set for a release.");
  const maps = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!maps) warnings.push("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — maps show their 'unavailable' fallback.");
  else if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(maps)) warnings.push("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY does not look like a Google API key.");
  return { errors, warnings };
}

module.exports = { checkReleaseEnv };

if (require.main === module) {
  // Read .env.production / .env.local / .env exactly as `next build` will (production mode).
  require("@next/env").loadEnvConfig(require("path").join(__dirname, ".."), false);
  const { errors, warnings } = checkReleaseEnv(process.env);
  for (const w of warnings) console.warn(`[release-env] warning: ${w}`);
  for (const e of errors) console.error(`[release-env] ERROR: ${e}`);
  if (errors.length > 0) {
    console.error("[release-env] refusing to build a release. Set the variables above (see apps/partner-web/.env.example).");
    process.exit(1);
  }
  console.log("[release-env] ok");
}

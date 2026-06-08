/**
 * Partner-web API smoke — routes used by apps/partner-web (partner-api.ts).
 *
 * Usage: bun run scripts/smoke-partner-routes.ts
 * Env:   API_URL=http://localhost:3000
 */
import {
  DEFAULT_BASE,
  printSmokeSummary,
  smokeReq,
  type SmokeResult,
} from "./smoke-lib";

const BASE = DEFAULT_BASE;
const results: SmokeResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function main() {
  console.log(`\nHOMIGO Partner routes smoke → ${BASE}\n`);

  const health = await smokeReq(BASE, "/health");
  record("Health", health.status === 200, `status=${health.status}`);
  if (health.status !== 200) {
    printSmokeSummary(results, "Partner smoke");
    process.exit(1);
  }

  const getPaths = [
    "/api/v1/partner/dashboard",
    "/api/v1/partner/profile",
    "/api/v1/partner/requests",
    "/api/v1/partner/schedule",
    "/api/v1/partner/wallet",
    "/api/v1/partner/performance",
    "/api/v1/partner/ai/insights",
  ];

  for (const path of getPaths) {
    const r = await smokeReq(BASE, path);
    record(`GET ${path}`, r.status === 200, `status=${r.status}`);
  }

  const accept = await smokeReq(BASE, "/api/v1/partner/requests/smoke-req/accept", {
    method: "POST",
  });
  record("POST partner request accept", accept.status === 200, `status=${accept.status}`);

  const reject = await smokeReq(BASE, "/api/v1/partner/requests/smoke-req/reject", {
    method: "POST",
  });
  record("POST partner request reject", reject.status === 200, `status=${reject.status}`);

  const availability = await smokeReq(BASE, "/api/v1/partner/availability", {
    method: "PUT",
    body: JSON.stringify({ online: true }),
  });
  record("PUT partner availability", availability.status === 200, `status=${availability.status}`);

  const failCount = printSmokeSummary(results, "Partner smoke");
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Partner smoke failed", err);
  process.exit(1);
});

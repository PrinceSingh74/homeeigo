/**
 * Partner-web A+B+C API smoke — every route in apps/partner-web/src/services/partner-api.ts
 *
 * Usage: bun run scripts/smoke-provider-api.ts
 */
import {
  DEFAULT_BASE,
  printSmokeSummary,
  smokeLogin,
  smokeReq,
  smokeWsHandshake,
  type SmokeResult,
} from "./smoke-lib";

const BASE = DEFAULT_BASE;
const results: SmokeResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function main() {
  console.log(`\nHOMIGO Partner-web API smoke (A+B+C) → ${BASE}\n`);

  const health = await smokeReq(BASE, "/health");
  record("Health", health.status === 200, `status=${health.status}`);
  if (health.status !== 200) {
    printSmokeSummary(results, "Partner-web smoke");
    process.exit(1);
  }

  const provider = await smokeLogin(BASE, "partner@homigo.demo", "Homigo@123");
  record("Provider login", provider.status === 200 && !!provider.token, `status=${provider.status}`);
  if (!provider.token) {
    printSmokeSummary(results, "Partner-web smoke");
    process.exit(1);
  }

  const auth = { Authorization: `Bearer ${provider.token}` };

  const getPaths = [
    "/api/providers/me",
    "/api/providers/me/dashboard",
    "/api/providers/me/earnings?days=30",
    "/api/providers/me/bookings",
    "/api/providers/me/reviews",
    "/api/providers/me/payouts",
    "/api/providers/me/invoices",
    "/api/providers/me/tax-summary",
    "/api/wallet/balance",
    "/api/wallet/transactions?page=1&limit=10",
    "/api/notifications?page=1&limit=10",
    "/api/subscriptions/plans",
    "/api/subscriptions/me",
    "/api/subscriptions/entitlements",
    "/api/bookings/upcoming",
  ];

  for (const path of getPaths) {
    const r = await smokeReq(BASE, path, { headers: auth });
    record(`GET ${path.split("?")[0]}`, r.status === 200, `status=${r.status}`);
  }

  const online = await smokeReq(BASE, "/api/providers/me/online", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ online: true }),
  });
  record("PUT providers/me/online", online.status === 200, `status=${online.status}`);

  const profile = await smokeReq(BASE, "/api/users/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ bio: "Smoke test bio" }),
  });
  record("PUT users/me (profile)", profile.status === 200, `status=${profile.status}`);

  const tracking = await smokeReq(BASE, "/api/tracking/non-existent-booking", { headers: auth });
  record("GET tracking (missing booking)", tracking.status === 404, `status=${tracking.status}`);

  const ws = await smokeWsHandshake(
    BASE,
    `/ws/notifications?token=${encodeURIComponent(provider.token)}`,
  );
  record("Notifications WebSocket", ws === "open" || ws.startsWith("closed:"), ws);

  const failCount = printSmokeSummary(results, "Partner-web smoke");
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Partner-web smoke failed", err);
  process.exit(1);
});

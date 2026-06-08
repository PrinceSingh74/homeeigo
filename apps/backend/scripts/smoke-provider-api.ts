/**
 * Provider (partner) role smoke — real /api/* routes for vendor JWT (not stub /api/v1/partner).
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
  console.log(`\nHOMIGO Provider API smoke → ${BASE}\n`);

  const health = await smokeReq(BASE, "/health");
  record("Health", health.status === 200, `status=${health.status}`);
  if (health.status !== 200) {
    printSmokeSummary(results, "Provider smoke");
    process.exit(1);
  }

  const provider = await smokeLogin(BASE, "partner@homigo.demo", "Homigo@123");
  record("Provider login", provider.status === 200 && !!provider.token, `status=${provider.status}`);
  if (!provider.token) {
    printSmokeSummary(results, "Provider smoke");
    process.exit(1);
  }

  const auth = { Authorization: `Bearer ${provider.token}` };

  const upcoming = await smokeReq(BASE, "/api/bookings/upcoming", { headers: auth });
  record("GET bookings/upcoming", upcoming.status === 200, `status=${upcoming.status}`);

  const tracking = await smokeReq(BASE, "/api/tracking/non-existent-booking", { headers: auth });
  record("GET tracking (missing)", tracking.status === 404, `status=${tracking.status}`);

  const location = await smokeReq(BASE, "/api/tracking/location", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      bookingId: "non-existent-booking",
      latitude: 28.63,
      longitude: 77.38,
    }),
  });
  record("POST tracking location", [200, 400, 403, 404].includes(location.status), `status=${location.status}`);

  const wallet = await smokeReq(BASE, "/api/wallet/balance", { headers: auth });
  record("GET wallet balance", wallet.status === 200, `status=${wallet.status}`);

  const ws = await smokeWsHandshake(
    BASE,
    `/ws/notifications?token=${encodeURIComponent(provider.token)}`,
  );
  record("Provider notifications WS", ws === "open" || ws.startsWith("closed:"), ws);

  const failCount = printSmokeSummary(results, "Provider smoke");
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Provider smoke failed", err);
  process.exit(1);
});

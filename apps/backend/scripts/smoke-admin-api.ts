/**
 * Admin API smoke — /api/admin/* (consumed by apps/admin-panel when wired).
 *
 * Usage: bun run scripts/smoke-admin-api.ts
 * Env:   API_URL=http://localhost:3000
 */
import {
  DEFAULT_BASE,
  printSmokeSummary,
  smokeLogin,
  smokeReq,
  smokeWsHandshake,
  type Json,
  type SmokeResult,
} from "./smoke-lib";

const BASE = DEFAULT_BASE;
const results: SmokeResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function main() {
  console.log(`\nHOMIGO Admin API smoke → ${BASE}\n`);

  const health = await smokeReq(BASE, "/health");
  record("Health", health.status === 200, `status=${health.status}`);
  if (health.status !== 200) {
    printSmokeSummary(results, "Admin smoke");
    process.exit(1);
  }

  const admin = await smokeLogin(BASE, "admin@homigo.demo", "Homigo@123");
  const customer = await smokeLogin(BASE, "customer@homigo.demo", "Homigo@123");

  record("Admin login", admin.status === 200 && !!admin.token, `status=${admin.status}`);
  record("Customer login", customer.status === 200 && !!customer.token, `status=${customer.status}`);

  if (!admin.token || !customer.token) {
    printSmokeSummary(results, "Admin smoke");
    process.exit(1);
  }

  const adminAuth = { Authorization: `Bearer ${admin.token}` };
  const customerAuth = { Authorization: `Bearer ${customer.token}` };

  const forbidden = await smokeReq(BASE, "/api/admin/dashboard", { headers: customerAuth });
  record("Customer blocked from admin", forbidden.status === 403, `status=${forbidden.status}`);

  const adminGets = [
    "/api/admin/dashboard",
    "/api/admin/users?limit=5&page=1",
    "/api/admin/providers?limit=5&page=1",
    "/api/admin/bookings?limit=5&page=1",
    "/api/admin/analytics?startDate=2026-01-01&endDate=2026-12-31",
  ];

  for (const path of adminGets) {
    const r = await smokeReq(BASE, path, { headers: adminAuth });
    record(`Admin ${path.split("?")[0]}`, r.status === 200, `status=${r.status}`);
  }

  const providers = await smokeReq(BASE, "/api/admin/providers?limit=1&page=1", {
    headers: adminAuth,
  });
  const providerId = (
    ((providers.body.data as Json | undefined)?.providers as Json[] | undefined)?.[0]?.id as
      | string
      | undefined
  );
  if (providerId) {
    const verify = await smokeReq(BASE, `/api/admin/providers/${providerId}/verify`, {
      method: "PUT",
      headers: adminAuth,
      body: JSON.stringify({ action: "approve", notes: "smoke test" }),
    });
    record("Admin provider verify", verify.status === 200, `status=${verify.status}`);
  } else {
    record("Admin provider verify", false, "no provider in list");
  }

  const banMissing = await smokeReq(BASE, "/api/admin/users/non-existent-user-id/ban", {
    method: "PUT",
    headers: adminAuth,
    body: JSON.stringify({ action: "ban", reason: "smoke probe" }),
  });
  record("Admin ban missing user", banMissing.status === 404, `status=${banMissing.status}`);

  const ws = await smokeWsHandshake(
    BASE,
    `/ws/notifications?token=${encodeURIComponent(admin.token)}`,
  );
  record("Admin notifications WS", ws === "open" || ws.startsWith("closed:"), ws);

  const failCount = printSmokeSummary(results, "Admin smoke");
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Admin smoke failed", err);
  process.exit(1);
});

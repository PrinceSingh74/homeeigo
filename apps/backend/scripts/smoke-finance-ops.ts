/**
 * Finance Operations 10/10 smoke — verifies new admin finance routes (in-process).
 *
 * Usage: bun --env-file=.env run scripts/smoke-finance-ops.ts
 */
import {
  printSmokeSummary,
  smokeAppReq,
  type Json,
  type SmokeResult,
} from "./smoke-lib";

const results: SmokeResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

async function adminLogin(): Promise<string | null> {
  const r = await smokeAppReq("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  });
  const token = (r.body.data as Json | undefined)?.accessToken as string | undefined;
  record("Admin login", r.status === 200 && !!token, `status=${r.status}`);
  return token ?? null;
}

async function get(path: string, token: string) {
  return smokeAppReq(path, { headers: { Authorization: `Bearer ${token}` } });
}

async function post(path: string, token: string, body?: unknown) {
  return smokeAppReq(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function main() {
  console.log("\nHOMIGO Finance Ops smoke (in-process)\n");

  const token = await adminLogin();
  if (!token) {
    printSmokeSummary(results, "Finance ops smoke");
    process.exit(1);
  }

  const financeGets: Array<{ path: string; label: string }> = [
    { path: "/api/admin/finance/dashboard", label: "CFO dashboard" },
    { path: "/api/admin/finance/reconciliation", label: "Reconciliation" },
    { path: "/api/admin/finance/reconciliation/gateway", label: "Gateway recon runs" },
    { path: "/api/admin/finance/payouts", label: "Payout ops" },
    { path: "/api/admin/finance/refunds", label: "Refund workflow" },
    { path: "/api/admin/finance/risk", label: "Risk queue" },
    { path: "/api/admin/finance/integrity", label: "Integrity center" },
    { path: "/api/admin/finance/chargebacks", label: "Chargebacks" },
    { path: "/api/admin/finance/settlement-sync", label: "Settlement sync" },
    { path: "/api/admin/finance/migrations", label: "Migrations" },
    { path: "/api/admin/finance/reports?period=monthly", label: "Executive reports" },
    { path: "/api/admin/finance/analytics/unit-economics?days=30", label: "Unit economics" },
  ];

  for (const { path, label } of financeGets) {
    const r = await get(path, token);
    const ok = r.status === 200 && r.body.success === true;
    record(label, ok, `status=${r.status}`);
  }

  const reconRun = await post("/api/admin/finance/reconciliation/run", token);
  record("POST reconciliation/run", reconRun.status === 200, `status=${reconRun.status}`);

  const gatewayRun = await post("/api/admin/finance/reconciliation/gateway/run", token);
  record("POST gateway recon/run", gatewayRun.status === 200, `status=${gatewayRun.status}`);

  const integrityRun = await post("/api/admin/finance/integrity/run", token);
  record("POST integrity/run", integrityRun.status === 200, `status=${integrityRun.status}`);

  const validationRun = await post("/api/admin/finance/validation/run", token);
  const valOk = validationRun.status === 200 && validationRun.body.success === true;
  record(
    "POST validation/run",
    valOk,
    valOk
      ? `status=${validationRun.status} result=${(validationRun.body.data as Json)?.status}`
      : `status=${validationRun.status}`,
  );

  const customerLogin = await smokeAppReq("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "customer@homigo.demo", password: "Homigo@123", setAuthCookies: false }),
  });
  const customerToken = (customerLogin.body.data as Json | undefined)?.accessToken as string | undefined;
  if (customerToken) {
    const blocked = await get("/api/admin/finance/payouts", customerToken);
    record("Customer blocked from finance", blocked.status === 403, `status=${blocked.status}`);
  }

  const failCount = printSmokeSummary(results, "Finance ops smoke");
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Finance ops smoke failed", err);
  process.exit(1);
});

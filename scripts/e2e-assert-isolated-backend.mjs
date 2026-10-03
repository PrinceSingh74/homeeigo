/**
 * Playwright globalSetup shared by apps/web, apps/partner-web and apps/admin-panel.
 *
 * WHY
 * ---
 * Every local E2E run without E2E_SKIP_SERVERS either reused the backend already listening on :3000
 * (`reuseExistingServer`) or started one from `.env` — both the LIVE homigo_db, with the production
 * S3 bucket and real Razorpay keys. Signups, bookings, chargeback evidence and sessions from test runs
 * landed in live data more than once (2026-09-03..06 S10F rows, 2026-09-30 minted sessions), and on
 * 2026-10-01 an admin run reached for the production bucket. Script guards and egress barriers each
 * covered one path; this one covers the browser suites as a whole.
 *
 * RULE
 * ----
 * Before any test runs, GET `${E2E_API_URL}/health` and require `isolatedDatabase: true` — the backend's
 * own statement that it is attached to a disposable database (src/index.ts → isIsolatedDatabase).
 * Refuse otherwise, including when the field is missing or the backend is unreachable.
 *
 * The one exemption is a GitHub Actions runner (GITHUB_ACTIONS=true), whose homigo_db is the job's own
 * throwaway container — the same exemption the write-capable scripts' `--allow-live` rule makes.
 * There is deliberately no opt-out variable: an inherited shell must not be able to widen the scope.
 */
export default async function assertIsolatedBackend() {
  const api = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`[e2e-isolation] GitHub Actions runner — throwaway database, ${api} not checked`);
    return;
  }

  let body = null;
  let lastError = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5_000) });
      body = await res.json().catch(() => null);
      if (body && typeof body === "object") break;
      lastError = `HTTP ${res.status} without a JSON body`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  const isolated = body && typeof body === "object" ? body.isolatedDatabase : undefined;
  if (isolated === true) {
    console.log(`[e2e-isolation] ${api} reports an isolated database — proceeding`);
    return;
  }
  const why =
    body == null
      ? `could not read ${api}/health (${lastError || "no response"})`
      : isolated === false
        ? `${api} reports isolatedDatabase: false — it is attached to a database that is not disposable`
        : `${api}/health has no isolatedDatabase field, so the target cannot be shown to be disposable`;
  throw new Error(
    `[e2e-isolation] REFUSING to run browser E2E: ${why}.\n` +
      "Start an isolated backend (a *_test database, see apps/backend/scripts/lib/script-target.ts) and point " +
      "E2E_API_URL at it with E2E_SKIP_SERVERS=1. Never run these suites against the live backend.",
  );
}

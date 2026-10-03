/**
 * Runtime authorization probe: ask the running server, do not read the routes.
 *
 * Pass 4 inferred protection from route source and got it wrong in both directions — a
 * window-based scan missed router-level `.use(authPlugin)` and reported `/api/analytics/etl/run`
 * and `/api/ai/*` as PUBLIC, and the initial 400s that seemed to confirm it were schema validation
 * running before the auth hook. The only trustworthy answer is what the server returns.
 *
 * Every probe sends a well-formed body, because Elysia validates the body before the auth plugin's
 * hooks run: a malformed body returns 422/400 and tells you nothing about authorization.
 *
 *   bun run scripts/probe-endpoint-authorization.ts --base http://127.0.0.1:3000
 *
 * Read-only against the server. Every probe is expected to be REFUSED or to be a public read, so
 * nothing is created: the POST probes carry credentials that cannot authenticate, and the webhook
 * probes carry signatures that cannot verify. No probe here can reach a handler that writes.
 */
const baseIdx = process.argv.indexOf("--base");
const BASE = baseIdx >= 0 ? process.argv[baseIdx + 1]! : "http://127.0.0.1:3000";

type Expect = "UNAUTHENTICATED" | "FORBIDDEN" | "PUBLIC";

type Probe = {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  expect: Expect;
  /** Why this endpoint is on the list. */
  why: string;
};

/** 401 or 403 both count as refused; which one is a design choice, being refused is the contract. */
const REFUSED = new Set([401, 403]);

const PROBES: Probe[] = [
  // ── Admin surface ─────────────────────────────────────────────────────────────────────────────
  { name: "admin dashboard", method: "GET", path: "/api/admin/dashboard", expect: "UNAUTHENTICATED", why: "business totals" },
  { name: "admin users list", method: "GET", path: "/api/admin/users", expect: "UNAUTHENTICATED", why: "customer PII" },
  { name: "admin analytics", method: "GET", path: "/api/admin/analytics", expect: "UNAUTHENTICATED", why: "revenue" },
  { name: "admin bookings", method: "GET", path: "/api/admin/bookings", expect: "UNAUTHENTICATED", why: "customer records" },
  { name: "admin refunds queue", method: "GET", path: "/api/admin/finance/refunds", expect: "UNAUTHENTICATED", why: "money" },
  { name: "admin governance budgets", method: "GET", path: "/api/admin/governance/ai-budgets", expect: "UNAUTHENTICATED", why: "spend policy" },

  // ── Money ─────────────────────────────────────────────────────────────────────────────────────
  { name: "wallet balance", method: "GET", path: "/api/wallet/balance", expect: "UNAUTHENTICATED", why: "customer money" },
  { name: "wallet transactions", method: "GET", path: "/api/wallet/transactions", expect: "UNAUTHENTICATED", why: "customer money" },
  { name: "partner earnings", method: "GET", path: "/api/providers/me/earnings", expect: "UNAUTHENTICATED", why: "partner money" },
  { name: "partner withdrawals", method: "GET", path: "/api/providers/me/withdrawals", expect: "UNAUTHENTICATED", why: "partner payouts" },

  // ── Customer data ─────────────────────────────────────────────────────────────────────────────
  { name: "my profile", method: "GET", path: "/api/users/me", expect: "UNAUTHENTICATED", why: "PII" },
  { name: "my upcoming bookings", method: "GET", path: "/api/bookings/upcoming", expect: "UNAUTHENTICATED", why: "customer records" },
  { name: "my addresses", method: "GET", path: "/api/users/addresses", expect: "UNAUTHENTICATED", why: "PII" },

  // ── Compliance / DSR ──────────────────────────────────────────────────────────────────────────
  { name: "compliance requests", method: "GET", path: "/api/compliance/requests", expect: "UNAUTHENTICATED", why: "DSR — legal" },

  // ── AI / automation ───────────────────────────────────────────────────────────────────────────
  //
  // These are the two Pass 4 heuristically flagged as PUBLIC and then disproved by probing. Kept on
  // the list permanently so the claim is re-established every run rather than remembered.
  { name: "ai chat", method: "POST", path: "/api/ai/chat", body: { message: "hello" }, expect: "UNAUTHENTICATED", why: "spends money" },
  { name: "etl run", method: "POST", path: "/api/analytics/etl/run", body: { job: "noop" }, expect: "UNAUTHENTICATED", why: "warehouse write" },

  // ── Ops ───────────────────────────────────────────────────────────────────────────────────────
  { name: "ops map", method: "GET", path: "/api/admin/ops-map", expect: "UNAUTHENTICATED", why: "live partner locations" },

  // ── Deliberately public ───────────────────────────────────────────────────────────────────────
  // A probe list with no PUBLIC entries cannot tell "everything is protected" from "the probe is
  // broken and everything returns 401".
  { name: "health", method: "GET", path: "/health", expect: "PUBLIC", why: "liveness" },
  { name: "ready", method: "GET", path: "/ready", expect: "PUBLIC", why: "readiness" },
  { name: "metrics", method: "GET", path: "/metrics", expect: "PUBLIC", why: "scrape target" },
  { name: "featured services", method: "GET", path: "/api/services/featured", expect: "PUBLIC", why: "storefront" },
  { name: "recent ratings", method: "GET", path: "/api/ratings/recent", expect: "PUBLIC", why: "storefront reviews" },
];

/** A syntactically valid but unsigned JWT: tests the verifier, not the parser. */
const FORGED =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(JSON.stringify({ sub: "forged", role: "ADMIN", exp: 4102444800 })).toString("base64url") +
  ".not-a-real-signature";

type Result = { probe: Probe; status: number; label: string; ok: boolean };

async function run(probe: Probe, headers: Record<string, string> = {}): Promise<number> {
  try {
    const res = await fetch(`${BASE}${probe.path}`, {
      method: probe.method,
      headers: { "content-type": "application/json", ...headers },
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const results: Result[] = [];

console.log(`[authz-probe] target: ${BASE}\n`);
console.log("  no credentials");
for (const probe of PROBES) {
  const status = await run(probe);
  const refused = REFUSED.has(status);
  const ok = probe.expect === "PUBLIC" ? status === 200 : refused;
  // A 404 on a protected route is not protection: it may simply not be mounted, and this probe must
  // not report an absent route as a secured one.
  const label = status === 0 ? "NO RESPONSE" : status === 404 ? `${status} (route absent?)` : String(status);
  results.push({ probe, status, label, ok });
  console.log(`   ${ok ? "ok  " : "FAIL"}  ${String(status).padStart(3)}  ${probe.name.padEnd(28)} expect ${probe.expect}`);
}

console.log("\n  forged bearer token (valid shape, wrong signature) — protected routes only");
const forgedResults: Result[] = [];
for (const probe of PROBES.filter((p) => p.expect !== "PUBLIC")) {
  const status = await run(probe, { authorization: `Bearer ${FORGED}` });
  const ok = REFUSED.has(status);
  forgedResults.push({ probe, status, label: String(status), ok });
  console.log(`   ${ok ? "ok  " : "FAIL"}  ${String(status).padStart(3)}  ${probe.name}`);
}

/**
 * Webhook signature verification, refusal paths only.
 *
 * A *valid* signature is deliberately not exercised here. Producing one is possible — the secret is
 * in the environment — but a correctly signed Razorpay event would be processed as a real payment
 * event against the live database. The refusal paths are the security contract and they mutate
 * nothing; the accept path and its deduplication are covered by the integration suites, which run
 * against `homigo_test`.
 *
 * The handler must not distinguish "no secret configured" from "bad signature" in its response: a
 * 503 on an unconfigured environment tells an unauthenticated caller about config state.
 */
console.log("\n  webhook signature (refusal paths only — nothing is processed)");
const webhookCases: Array<[string, Record<string, string>]> = [
  ["no signature header", {}],
  ["empty signature", { "x-razorpay-signature": "" }],
  ["malformed signature", { "x-razorpay-signature": "not-a-signature" }],
  ["plausible-looking hex signature", { "x-razorpay-signature": "a".repeat(64) }],
];
const webhookResults: Result[] = [];
for (const [label, headers] of webhookCases) {
  const probe: Probe = {
    name: `webhook: ${label}`,
    method: "POST",
    path: "/api/payments/webhook",
    body: { event: "payment.captured", payload: {} },
    expect: "UNAUTHENTICATED",
    why: "money in",
  };
  const status = await run(probe, headers);
  // 401 only. A 503 would leak whether the secret is configured; a 200 would be catastrophic.
  const ok = status === 401;
  webhookResults.push({ probe, status, label: String(status), ok });
  console.log(`   ${ok ? "ok  " : "FAIL"}  ${String(status).padStart(3)}  ${label}`);
}

const failures = [...results, ...forgedResults, ...webhookResults].filter((r) => !r.ok);
const absent = results.filter((r) => r.status === 404 && r.probe.expect !== "PUBLIC");

console.log("");
if (absent.length) {
  console.log(`NOTE — ${absent.length} protected route(s) returned 404. Not counted as secured:`);
  for (const a of absent) console.log(`   ${a.probe.method} ${a.probe.path}`);
  console.log("");
}
if (failures.length) {
  console.log(`FAILURES (${failures.length}):`);
  for (const f of failures) console.log(`   ${f.probe.method} ${f.probe.path} -> ${f.label} (expected ${f.probe.expect})`);
  console.log(`\n[authz-probe] FAIL`);
  process.exit(1);
}
console.log(
  `[authz-probe] PASS — ${results.length} unauthenticated, ${forgedResults.length} forged-token, ` +
    `${webhookResults.length} webhook-signature probes`,
);

/**
 * Per-row verdicts for the routes `inventory-api-consumers.ts` found no client for.
 *
 * Each verdict is a rule with a stated reason, applied to one route at a time, so a reader can
 * dispute a specific row. Rules only encode facts established while re-measuring (Pass 5) — e.g.
 * that partners read withdrawals through `/me/payouts`, that the admin twin page calls `simulate`.
 * A route no rule covers is reported as NEEDS_OWNER_REVIEW rather than forced into a bucket.
 *
 *   bun run scripts/inventory-api-consumers.ts --list > out.txt
 *   bun run scripts/classify-unwired-routes.ts out.txt [--md]
 */
import { readFileSync } from "node:fs";

type Verdict =
  | "REAL_GAP"
  | "API_ONLY"
  | "BACKGROUND"
  | "BUSINESS_DECISION"
  | "EXTERNAL_BLOCKED"
  | "DEPRECATE_CANDIDATE"
  | "NEEDS_OWNER_REVIEW";

const RULES: Array<[RegExp, Verdict, string]> = [
  // ── Superseded or duplicated ─────────────────────────────────────────────────────────────────
  [/^\/api\/providers\/me\/withdrawals$/, "DEPRECATE_CANDIDATE", "partners read withdrawal history via /api/providers/me/payouts; nothing calls this"],
  [/^\/api\/analytics\/mlops\//, "DEPRECATE_CANDIDATE", "duplicate of /api/mlops/* — the admin console calls /api/mlops/registry"],
  [/^\/api\/users\/bookings\/:id$/, "DEPRECATE_CANDIDATE", "clients read one booking via /api/bookings/:id"],
  [/^\/api\/ai\/(gateway\/chat|customer|admin)$/, "DEPRECATE_CANDIDATE", "clients chat via /api/ai/chat; these older entry points have no caller"],
  [/^\/api\/legal\/consent$/, "DEPRECATE_CANDIDATE", "the cookie banner posts to /api/legal/consent/cookies"],

  // ── Built and unwired, with a clear user-facing purpose ──────────────────────────────────────
  [/^\/api\/providers\/me\/intel\//, "REAL_GAP", "partner intelligence (nudges / shift plan / earnings coach / zones) — no partner app screen calls it; the admin 'Earnings Coach' link is an admin page, not this partner route"],
  [/^\/api\/providers\/me\/lifecycle\//, "REAL_GAP", "partner self-service pause/resume + history — no partner app calls it"],
  [/^\/api\/customer-intel\/satisfaction\//, "REAL_GAP", "per-booking satisfaction signal — no client"],
  [/^\/api\/wallet\/checkout\/multi-source\//, "REAL_GAP", "split wallet+gateway checkout — no web or mobile caller"],
  [/^\/api\/digital-twin\/:city\/(scenario|what-if)$/, "REAL_GAP", "newer scenario engine that returns its assumptions; the admin twin page still calls the older /simulate"],
  [/^\/api\/admin\/providers\/:id\/(score|career)\/history$/, "REAL_GAP", "a partner's own history is wired (/providers/me/...); the admin view of any partner's history has no screen"],
  [/^\/api\/admin\/finance\/settlements\/:id/, "REAL_GAP", "settlement list is wired; no detail or export view"],
  [/^\/api\/admin\/finance\/settlement-sync\/discrepancies\/:id\//, "REAL_GAP", "discrepancies cannot be investigated or annotated from the console"],

  [/^\/api\/admin\/hcoins\/rules$/, "REAL_GAP", "H-Coin earning rules (a customer liability) have no screen: the list is never fetched and the admin client's `updateRule` has zero callers, so rule changes are API-only"],
  [/^\/api\/admin\/finance\/refunds\/request$/, "NEEDS_OWNER_REVIEW", "admins refund through /api/admin/bookings/:id/refund and the approve/reject queue; whether manual request creation is still needed is an owner call"],

  // ── Governance that exists only as an API ────────────────────────────────────────────────────
  [/^\/api\/admin\/governance\/ai-budgets$/, "BUSINESS_DECISION", "the ONLY way to set an AI spend cap; no UI. Live policies: 0 (NO_POLICY_CONFIGURED). Whether it needs a screen, and the cap amount, are owner decisions"],
  [/^\/api\/admin\/governance\/workflow-drafts/, "BUSINESS_DECISION", "AI workflow-draft review queue with no screen; human review of AI drafts is a governance choice"],
  [/^\/api\/admin\/governance\/models\//, "API_ONLY", "model evaluation read-outs for ML review"],

  // ── Operator / tooling endpoints: intentionally no screen ────────────────────────────────────
  [/^\/api\/analytics\/(etl|quality|freshness|features|versions|forecast)/, "API_ONLY", "data-platform operator endpoint; BigQuery ETL has been dead since 2026-08-19 (billing disabled), so a screen over it would show stale data as current"],
  [/^\/api\/ai\/(context|memory)/, "API_ONLY", "AI context-engine maintenance (rebuild / purge / compress)"],
  [/^\/api\/ai\/(prompts|prompt-versions)/, "API_ONLY", "prompt-registry operations beyond the list/diff/approve actions the console already calls"],
  [/^\/api\/ai\/brain\/conversations/, "API_ONLY", "ai-brain conversation store; the customer assistant uses /api/ai/conversations/latest and /:id"],
  [/^\/api\/ai\/tools\/approvals\/:approvalId(\/cancel)?$/, "API_ONLY", "approval list + decide are wired; single-read and cancel are not"],
  [/^\/api\/ai\/(cost|conversations)$/, "API_ONLY", "aggregate read with no screen"],
  [/^\/api\/admin\/ml\//, "API_ONLY", "ML lifecycle operations"],
  [/^\/api\/mlops\/metrics$/, "API_ONLY", "MLOps metrics read-out"],
  [/^\/api\/knowledge\/(ask|retrieve|scope)$/, "API_ONLY", "the console uses /api/admin/knowledge/*; these are the non-admin variants"],
  [/^\/api\/admin\/(integrity|observability\/logs\/export|finance\/liabilities\/snapshot|finance\/reconciliation\/gateway$|finance\/audit-export)/, "API_ONLY", "diagnostic / export / snapshot trigger for operators"],
  [/^\/api\/admin\/intelligence\/report-recipients$/, "API_ONLY", "scheduled-report configuration read"],

  // ── Background and external ──────────────────────────────────────────────────────────────────
  [/^\/api\/agents\/health$/, "BACKGROUND", "health probe"],
  [/^\/api\/geo\/checkin$/, "BACKGROUND", "device check-in endpoint; no literal caller found — verify against the partner location pipeline"],
  [/^\/api\/pricing\//, "EXTERNAL_BLOCKED", "dynamic pricing is recommend-only; nothing in checkout reads it and no client calls it (see dynamic-pricing-population.test.ts)"],
  [/^\/api\/weather\/(config|forecast)$/, "API_ONLY", "weather reads not surfaced; surge uses weather server-side"],
  [/^\/api\/vision\//, "API_ONLY", "image analysis read with no screen"],
];

const file = process.argv[2];
if (!file) {
  console.error("usage: classify-unwired-routes.ts <inventory --list output>");
  process.exit(2);
}
const text = readFileSync(file, "utf8");
const section = text.split("UNMATCHED by route file:")[1]?.split(/\nWIRED_WEAK|\nUNRESOLVED_PREFIX/)[0] ?? "";
const rows = [...section.matchAll(/^\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*$/gm)].map((m) => ({
  method: m[1]!,
  path: m[2]!,
}));

const classified = rows.map((r) => {
  const hit = RULES.find(([re]) => re.test(r.path));
  return { ...r, verdict: (hit?.[1] ?? "NEEDS_OWNER_REVIEW") as Verdict, reason: hit?.[2] ?? "no verified fact covers this row" };
});

const counts = new Map<Verdict, number>();
for (const c of classified) counts.set(c.verdict, (counts.get(c.verdict) ?? 0) + 1);

if (process.argv.includes("--md")) {
  console.log("| Verdict | Method | Route | Reason |");
  console.log("|---|---|---|---|");
  for (const c of [...classified].sort((a, b) => a.verdict.localeCompare(b.verdict) || a.path.localeCompare(b.path))) {
    console.log(`| ${c.verdict} | ${c.method} | \`${c.path}\` | ${c.reason} |`);
  }
} else {
  console.log(`[unwired] ${classified.length} routes with no client reference\n`);
  for (const [v, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(20)} ${n}`);
  const review = classified.filter((c) => c.verdict === "NEEDS_OWNER_REVIEW");
  if (review.length) {
    console.log(`\nNEEDS_OWNER_REVIEW:`);
    for (const r of review) console.log(`  ${r.method.padEnd(6)} ${r.path}`);
  }
}

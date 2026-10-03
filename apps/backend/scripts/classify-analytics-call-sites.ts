/**
 * The DQ-7 classification, as data rather than as a paragraph in a document.
 *
 * Every aggregate over a provenance-bearing model is assigned a category, and the script fails if
 * any site is unassigned. That is the point: a classification kept in prose drifts the moment
 * someone adds a query, and the site that was never considered is exactly the one that gets the
 * default treatment. Here a new call site breaks the build until a human says what it is.
 *
 * Sites are matched by a substring of the query text, never by line number, so the assignment
 * survives edits to the files around it.
 *
 *   bun run scripts/classify-analytics-call-sites.ts          # summary + any unclassified
 *   bun run scripts/classify-analytics-call-sites.ts --list   # every site with its category
 *
 * Read-only. Touches no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Category = "A" | "B" | "C" | "D" | "E" | "F" | "H" | "I";

const CATEGORY_NAMES: Record<Category, string> = {
  A: "business analytics — SCOPE",
  B: "operational control — NEVER SCOPE",
  C: "financial integrity / liability — NEVER SCOPE",
  D: "per-entity, already narrowed — no-op (see DQ-8)",
  E: "model input — SCOPE",
  F: "compliance / audit — NEVER SCOPE",
  H: "internal health, listing totals, diagnostics — do not scope",
  I: "ambiguous — owner decision",
};

/** Categories where the predicate is required; the script checks they actually carry it. */
const MUST_BE_SCOPED: Category[] = ["A", "E"];

type Rule = {
  file: string;
  category: Category;
  /** Overrides for sites in a mixed file, matched on a distinctive substring of the query. */
  except?: Array<{ match: string; category: Category; why: string }>;
  why: string;
};

const RULES: Rule[] = [
  {
    file: "src/services/admin.service.ts",
    category: "A",
    why: "dashboard totals and the 30-day analytics report",
    except: [
      {
        match: "prisma.user.count({ where })",
        category: "H",
        why: "pagination total for the admin user list — must match the unscoped list beside it",
      },
      {
        match: "prisma.booking.count({ where })",
        category: "H",
        why: "pagination total for the admin booking list",
      },
    ],
  },
  { file: "src/services/geo-intelligence.service.ts", category: "A", why: "executive KPIs, revenue forecast" },
  {
    file: "src/lib/partner-exec-metrics.ts",
    category: "A",
    why: "business gauges scraped by Prometheus",
    except: [
      {
        match: '"EN_ROUTE", "IN_PROGRESS"',
        category: "B",
        why: "jobs in flight right now — live operational state, not a business total",
      },
    ],
  },
  { file: "src/services/refund-workflow.service.ts", category: "A", why: "refund console; 97.1% of rows are not business" },
  { file: "src/lib/refund-backlog-metrics.ts", category: "A", why: "the refund alerts that page a human" },
  { file: "src/services/stats.service.ts", category: "A", why: "counters shown to customers on the public site" },
  { file: "src/services/finance-analytics.service.ts", category: "A", why: "unit economics" },
  { file: "src/services/membership-analytics.service.ts", category: "A", why: "upgrade funnel" },
  {
    file: "src/services/finance-dashboard.service.ts",
    category: "A",
    why: "finance overview",
    except: [
      {
        match: "walletBalance",
        category: "C",
        why: "liability: the platform owes every balance regardless of how the account was created",
      },
    ],
  },
  {
    file: "src/ai-brain/context/collectors/admin-context.ts",
    category: "A",
    why: "what the assistant reports about the business",
    except: [{ match: '"PENDING", "ACCEPTED"', category: "B", why: "active pipeline depth" }],
  },
  {
    file: "src/ai-brain/context/collectors/finance-context.ts",
    category: "A",
    why: "assistant's finance answers",
    except: [{ match: "walletBalance", category: "C", why: "liability — see finance-dashboard" }],
  },
  {
    file: "src/ai-brain/context/collectors/operations-context.ts",
    category: "A",
    why: "assistant's operations answers",
    except: [
      { match: '"ASSIGNED", "EN_ROUTE", "IN_PROGRESS"', category: "B", why: "live job count" },
      { match: 'status: "PENDING"', category: "B", why: "live queue depth" },
      { match: "CANCELLED_BY_USER", category: "B", why: "live cancellation feed, paired with the above" },
    ],
  },
  {
    file: "src/routes/admin.ts",
    category: "A",
    why: "premium-match ratio, both sides of it",
  },

  // ── Operational: must see every row that exists ───────────────────────────────────────────────
  { file: "src/services/booking-priority.service.ts", category: "B", why: "queue depth and wait estimates — a fixture booking still occupies the queue" },
  { file: "src/services/partner-operations.service.ts", category: "B", why: "concurrency and daily quota enforcement" },
  { file: "src/services/assignment-engine.service.ts", category: "B", why: "dispatch metrics" },
  { file: "src/services/command-center-overview.service.ts", category: "B", why: "live command-centre counters" },
  { file: "src/services/coverage.service.ts", category: "B", why: "live city coverage aggregates" },
  { file: "src/services/booking.service.ts", category: "B", why: "booking-path control flow" },
  { file: "src/services/booking-refund.service.ts", category: "B", why: "refund-path control flow" },
  { file: "src/services/address.service.ts", category: "B", why: "referential check before removing an address" },
  { file: "src/services/catalog.service.ts", category: "B", why: "referential check before removing a service" },
  { file: "src/services/alert-evaluator.service.ts", category: "H", why: "detector input — must see failures whatever created them" },
  { file: "src/services/partner-os.service.ts", category: "D", why: "per-provider summary and live workforce state" },
  { file: "src/lib/geo-metrics.ts", category: "B", why: "live geo gauge" },

  // ── Financial integrity: excluding a row manufactures drift ───────────────────────────────────
  { file: "src/services/financial-integrity.service.ts", category: "C", why: "invariant checks must cover every row" },
  { file: "src/services/ledger-reconciliation.service.ts", category: "C", why: "reconciliation must cover every row" },
  { file: "src/services/finance-intelligence.service.ts", category: "C", why: "canonical GMV is reconciled against the ledger" },
  { file: "src/services/partner-incentive-payout.service.ts", category: "C", why: "decides real money paid to a partner" },
  { file: "src/services/partner-referral.service.ts", category: "C", why: "decides a real referral payout" },
  { file: "src/services/production-validation.service.ts", category: "F", why: "production validation must see everything" },

  // ── Per-entity ────────────────────────────────────────────────────────────────────────────────
  { file: "src/services/provider.service.ts", category: "D", why: "a partner's own dashboard, plus one listing total" },
  { file: "src/services/partner-score.service.ts", category: "D", why: "per-partner score — see DQ-8" },
  { file: "src/services/partner-risk.service.ts", category: "D", why: "per-partner cancellation abuse — see DQ-8" },
  { file: "src/services/performance-nudges.service.ts", category: "D", why: "per-partner nudges — see DQ-8" },
  { file: "src/services/rating.service.ts", category: "D", why: "per-provider booking stats — see DQ-8" },
  { file: "src/services/eta-intelligence.service.ts", category: "D", why: "per-provider ETA calibration" },
  { file: "src/services/partner-intelligence.service.ts", category: "D", why: "per-partner job list" },
  { file: "src/ai-brain/context/collectors/partner-context.ts", category: "D", why: "one partner's day" },
  { file: "src/services/customer-intelligence.service.ts", category: "D", why: "one customer's profile" },
  { file: "src/services/service-recommendation.service.ts", category: "D", why: "recommendations for one customer" },
  { file: "src/services/satisfaction-intelligence.service.ts", category: "D", why: "signal for one booking" },
  { file: "src/services/support-context.service.ts", category: "D", why: "support context for one ticket" },

  // ── Model inputs ──────────────────────────────────────────────────────────────────────────────
  { file: "src/services/dynamic-pricing.service.ts", category: "E", why: "conversion rate feeds the price a customer is charged" },

  // ── Ambiguous ─────────────────────────────────────────────────────────────────────────────────
  { file: "src/lib/finops-metrics.ts", category: "I", why: "a bare user count whose consumer is unclear" },
];

// ── Collect the sites (same matcher as inventory-analytics-call-sites.ts) ───────────────────────
const ROOT = join(import.meta.dir, "..");
const MODELS = ["booking", "user", "refundRequest"];
const OPS = ["count", "aggregate", "groupBy"];
const CALL = new RegExp(`prisma\\.(${MODELS.join("|")})\\.(${OPS.join("|")})\\b`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "generated") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function balanced(lines: string[], idx: number): string {
  const text = lines.slice(idx, idx + 20).join(" ");
  const start = text.indexOf("prisma.");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(start, i + 1).replace(/\s+/g, " ");
  }
  return text.slice(start, start + 200).replace(/\s+/g, " ");
}

const sites: Array<{ file: string; line: number; snippet: string; scopedVars: string[] }> = [];
for (const dir of ["src", "analytics"]) {
  let files: string[] = [];
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (rel.includes("__tests__") || rel.endsWith("analytics-scope.ts")) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    /**
     * Names bound to a filter that already carries the predicate, e.g.
     *
     *   const where  = { createdAt: { gte: start }, ...analyticsWhere() };
     *   const scoped = analyticsWhere();
     *
     * A query reusing one of those IS scoped. Matching only on an inline `analyticsWhere(` reported
     * five sites in admin.service and six in refund-workflow as unscoped when they were not, and a
     * check that cries wolf gets muted — so it has to recognise the shapes people actually write.
     */
    const scopedVars = new Set(
      [...text.matchAll(/const\s+(\w+)\s*=\s*[^;]*analyticsWhere(Via)?\(/g)].map((m) => m[1]!),
    );
    for (let i = 0; i < lines.length; i++) {
      if (CALL.test(lines[i]!)) {
        sites.push({ file: rel, line: i + 1, snippet: balanced(lines, i), scopedVars: [...scopedVars] });
      }
    }
  }
}

// ── Assign ─────────────────────────────────────────────────────────────────────────────────────
const byFile = new Map(RULES.map((r) => [r.file, r]));
const unclassified: typeof sites = [];
const unscoped: Array<{ file: string; line: number; category: Category }> = [];
const counts = new Map<Category, number>();
const assigned: Array<{ file: string; line: number; category: Category; snippet: string }> = [];

for (const site of sites) {
  const rule = byFile.get(site.file);
  if (!rule) {
    unclassified.push(site);
    continue;
  }
  const override = rule.except?.find((e) => site.snippet.includes(e.match));
  const category = override?.category ?? rule.category;
  counts.set(category, (counts.get(category) ?? 0) + 1);
  assigned.push({ ...site, category });
  // `where: scoped`, `...scoped`, and the object shorthand `where,` — the last one is how
  // admin.service passes its scoped filter to `groupBy`, and missing it produced a false alarm.
  const usesScopedVar = site.scopedVars.some((v) =>
    new RegExp(`(\\.\\.\\.${v}\\b|where:\\s*${v}\\b|[{,]\\s*${v}\\s*[,}])`).test(site.snippet),
  );
  if (MUST_BE_SCOPED.includes(category) && !/analyticsWhere(Via)?\(/.test(site.snippet) && !usesScopedVar) {
    unscoped.push({ file: site.file, line: site.line, category });
  }
}

if (process.argv.includes("--list")) {
  for (const a of assigned.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line)) {
    console.log(`${a.category}  ${a.file}:${a.line}  ${a.snippet.slice(0, 110)}`);
  }
  console.log("");
}

console.log(`[dq7] ${sites.length} call sites over provenance-bearing models\n`);
for (const c of Object.keys(CATEGORY_NAMES) as Category[]) {
  console.log(`  ${c}  ${String(counts.get(c) ?? 0).padStart(3)}  ${CATEGORY_NAMES[c]}`);
}

let failed = false;
if (unclassified.length) {
  failed = true;
  console.log(`\nUNCLASSIFIED (${unclassified.length}) — add a rule saying what these are:`);
  for (const u of unclassified) console.log(`   ${u.file}:${u.line}  ${u.snippet.slice(0, 100)}`);
}
if (unscoped.length) {
  failed = true;
  console.log(`\nCLASSIFIED AS SCOPE-REQUIRED BUT NOT SCOPED (${unscoped.length}):`);
  for (const u of unscoped) console.log(`   [${u.category}] ${u.file}:${u.line}`);
}

console.log(failed ? "\n[dq7] FAIL" : "\n[dq7] PASS — every site classified, every scope-required site scoped");
process.exit(failed ? 1 : 0);

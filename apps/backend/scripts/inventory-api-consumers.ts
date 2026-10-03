/**
 * Which backend routes does any client actually call?
 *
 * Replaces the Pass-2 "92 unwired capabilities" estimate, whose matcher was later shown to both
 * over-match (it hid five customer-intel orphans) and under-match. That number should not be
 * quoted again; this is the re-measurement.
 *
 * Method, and its limits stated up front:
 *
 *   Routes   — extracted statically from `src/routes/*.ts`. Each route is assigned the nearest
 *              `prefix:` declared above it in the same file. Importing the app to read
 *              `app.routes` would be exact, but `src/index.ts` starts the schedulers, and a
 *              scheduler run against the live database from an audit script is an incident this
 *              codebase has already had. Routes whose prefix cannot be resolved are REPORTED, not
 *              guessed.
 *
 *   Clients  — every string or template literal beginning `/api/` in the three web apps and two
 *              mobile apps. apps/web proxies `/api/*` to the backend 1:1, so its literals are
 *              backend paths.
 *
 *   Matching — segment by segment. `:param` on the route side and `${expr}` on the client side are
 *              both wildcards. A client literal ending in `/` (built by concatenation) is recorded as
 *              a PREFIX match, which is weaker evidence and counted separately.
 *
 * A route with no client reference is not automatically dead: webhooks, health checks, metrics
 * scrapes and server-to-server calls have no client by design. Those are classified by path. The
 * rest are listed individually for a human verdict — no bulk classification.
 *
 *   bun run scripts/inventory-api-consumers.ts [--list]
 *
 * Read-only. Reads files only.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const BACKEND = join(import.meta.dir, "..");
const REPO = join(BACKEND, "..", "..");
const CLIENTS: Array<[string, string[]]> = [
  ["web", ["apps/web/src"]],
  ["admin", ["apps/admin-panel/src"]],
  ["partner-web", ["apps/partner-web/src"]],
  ["mobile", ["homigo-mobile/src", "homigo-mobile/app"]],
  ["partner-mobile", ["homigo-partner-mobile/src", "homigo-partner-mobile/app"]],
];

type Route = { method: string; path: string; file: string; line: number; resolved: boolean };

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "__tests__" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(full);
  }
  return out;
}

/**
 * A segment that STARTS with `${` is a wildcard. One that only ENDS with an interpolation —
 * `/api/users/bookings${query}` — is a literal with a query string appended, and treating the whole
 * segment as a wildcard demoted real calls like that one to WIRED_WEAK.
 */
const segs = (p: string) =>
  p
    .split("?")[0]!
    .split("/")
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith(":") || s.startsWith("${") || s === "*") return "*";
      const i = s.indexOf("${");
      return i > 0 ? s.slice(0, i) : s;
    });

/**
 * Routers that are `.use()`d inside another router, so their own prefix is not the whole story.
 * Resolved by reading where each is mounted (all five in `src/routes/admin.ts`, prefix `/api/admin`),
 * and stated here rather than inferred, so a remount breaks this list visibly instead of silently.
 */
const MOUNTED_UNDER: Record<string, string> = {
  "src/routes/admin-automation.ts": "/api/admin",
  "src/routes/admin-intelligence.ts": "/api/admin",
  "src/routes/admin-partner-acquisition.ts": "/api/admin",
  "src/routes/admin-partner-referral.ts": "/api/admin",
  "src/routes/admin-trust-safety.ts": "/api/admin",
};

// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
const routes: Route[] = [];
const ROUTE_RE = /\.(get|post|put|patch|delete)\(\s*(["'`])(\/[^"'`]*)\2/g;
for (const file of walk(join(BACKEND, "src", "routes"), [".ts"])) {
  const text = readFileSync(file, "utf8");
  const rel = relative(BACKEND, file).replace(/\\/g, "/");
  // Prefix declarations with their offsets, in order.
  const prefixes = [...text.matchAll(/prefix:\s*["'`]([^"'`]+)["'`]/g)].map((m) => ({ at: m.index!, p: m[1]! }));
  for (const m of text.matchAll(ROUTE_RE)) {
    const before = prefixes.filter((x) => x.at < m.index!);
    const prefix = before.length ? before[before.length - 1]!.p : "";
    const line = text.slice(0, m.index!).split("\n").length;
    const full = ((MOUNTED_UNDER[rel] ?? "") + prefix + m[3]!).replace(/\/+$/, "") || "/";
    // Only routes that end up under /api are client-callable in the sense measured here.
    routes.push({
      method: m[1]!.toUpperCase(),
      path: full,
      file: rel,
      line,
      resolved: full.startsWith("/api/") || full === "/api",
    });
  }
}

// ── Client literals ─────────────────────────────────────────────────────────────────────────────
// `/api/` directly after a quote, or after `${...}` inside a template
// (`${apiBase}/api/payments/e2e/mock-signature`). The first version required the quote and missed
// both of the template-built calls found by spot-validating its UNMATCHED list.
const LIT_RE = /(?:["'`]|\})(\/api\/[^"'`\s]*)/g;
const clientRefs: Array<{ app: string; lit: string; segs: string[]; prefix: boolean }> = [];
for (const [app, dirs] of CLIENTS) {
  for (const d of dirs) {
    for (const file of walk(join(REPO, d), [".ts", ".tsx", ".js", ".jsx"])) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(LIT_RE)) {
        const lit = m[1]!;
        clientRefs.push({ app, lit, segs: segs(lit), prefix: lit.endsWith("/") });
      }
    }
  }
}

/**
 * Whether a match leaned on a client-side wildcard covering a route-side literal. `/api/admin/${x}`
 * "matches" every two-segment admin route, which is not evidence that any particular one is called.
 * Such matches are reported as WIRED_WEAK rather than WIRED, so the over-match direction is visible
 * instead of silently inflating the wired count — the failure mode that made the old figure useless.
 */
function leansOnWildcard(route: string[], client: string[]): boolean {
  return client.some((c, i) => c === "*" && route[i] !== "*");
}

function matches(route: string[], client: string[], prefix: boolean): boolean {
  if (prefix) {
    // `/api/admin/users/` + id: the literal covers the leading segments and the rest is dynamic.
    if (client.length >= route.length) return false;
    return client.every((c, i) => c === "*" || route[i] === "*" || c === route[i]);
  }
  if (client.length !== route.length) return false;
  return client.every((c, i) => c === "*" || route[i] === "*" || c === route[i]);
}

// ── Classify ────────────────────────────────────────────────────────────────────────────────────
type Verdict = "WIRED" | "WIRED_WEAK" | "PREFIX_ONLY" | "BACKGROUND" | "UNMATCHED" | "UNRESOLVED_PREFIX";
const BACKGROUND_RE = /^\/api\/(webhooks|payments\/webhook|health|internal|cron|ops\/|tracking\/ingest)/;

const results = routes.map((r) => {
  if (!r.resolved) return { r, verdict: "UNRESOLVED_PREFIX" as Verdict, apps: [] as string[] };
  const rs = segs(r.path);
  const exact = clientRefs.filter((c) => !c.prefix && matches(rs, c.segs, false));
  const strong = exact.filter((c) => !leansOnWildcard(rs, c.segs));
  if (strong.length) return { r, verdict: "WIRED" as Verdict, apps: [...new Set(strong.map((c) => c.app))] };
  if (exact.length) return { r, verdict: "WIRED_WEAK" as Verdict, apps: [...new Set(exact.map((c) => c.app))] };
  const pre = clientRefs.filter((c) => c.prefix && matches(rs, c.segs, true));
  if (pre.length) return { r, verdict: "PREFIX_ONLY" as Verdict, apps: [...new Set(pre.map((c) => c.app))] };
  if (BACKGROUND_RE.test(r.path)) return { r, verdict: "BACKGROUND" as Verdict, apps: [] };
  return { r, verdict: "UNMATCHED" as Verdict, apps: [] };
});

const count = (v: Verdict) => results.filter((x) => x.verdict === v).length;
console.log(`[api-consumers] routes extracted: ${routes.length}   client /api literals: ${clientRefs.length}\n`);
for (const v of ["WIRED", "WIRED_WEAK", "PREFIX_ONLY", "BACKGROUND", "UNMATCHED", "UNRESOLVED_PREFIX"] as Verdict[]) {
  console.log(`  ${v.padEnd(18)} ${String(count(v)).padStart(4)}`);
}

// Unmatched grouped by route file, so the list reads by capability rather than alphabetically.
const unmatched = results.filter((x) => x.verdict === "UNMATCHED");
const byFile = new Map<string, typeof unmatched>();
for (const u of unmatched) byFile.set(u.r.file, [...(byFile.get(u.r.file) ?? []), u]);
console.log(`\nUNMATCHED by route file:`);
for (const [f, us] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(us.length).padStart(3)}  ${f}`);
  if (process.argv.includes("--list")) for (const u of us) console.log(`         ${u.r.method.padEnd(6)} ${u.r.path}`);
}

const weak = results.filter((x) => x.verdict === "WIRED_WEAK");
if (weak.length && process.argv.includes("--list")) {
  console.log(`
WIRED_WEAK (only a client wildcard covers a literal segment):`);
  for (const w of weak) console.log(`         ${w.r.method.padEnd(6)} ${w.r.path}  <- ${w.apps.join(",")}`);
}

const unresolved = results.filter((x) => x.verdict === "UNRESOLVED_PREFIX");
if (unresolved.length) {
  console.log(`\nUNRESOLVED_PREFIX (route path did not resolve under /api — not counted either way):`);
  const uf = new Map<string, number>();
  for (const u of unresolved) uf.set(u.r.file, (uf.get(u.r.file) ?? 0) + 1);
  for (const [f, n] of uf) console.log(`  ${String(n).padStart(3)}  ${f}`);
}

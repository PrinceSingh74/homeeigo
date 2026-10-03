/**
 * Runtime sweep: every parameter-free GET route, called as the role that should be able to use it.
 *
 * Two defects found in Pass 6 were invisible to type-checking and to every refusal-based test:
 *
 *   - the admin refund queue `include`d a relation that does not exist (500 on every call);
 *   - the governance and ML routers refused every caller, admins included (401).
 *
 * Both were found only by signing in and calling the endpoint. This does that for every GET route
 * without path parameters, so the next defect of either shape is found by a script instead of by a
 * user. A 5xx is always a finding. A 401/403 for the role that owns the surface is a finding too.
 *
 * Routes are extracted statically (same method as inventory-api-consumers.ts). Paths that export,
 * download or stream are skipped — they are heavy and not what this is testing.
 *
 *   bun run scripts/sweep-authenticated-gets.ts [--base http://127.0.0.1:3000]
 *
 * Uses the local demo accounts; the password is read in-process and never printed. GET only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const baseIdx = process.argv.indexOf("--base");
const BASE = baseIdx >= 0 ? process.argv[baseIdx + 1]! : "http://127.0.0.1:3000";
const ROOT = join(import.meta.dir, "..");

const MOUNTED_UNDER: Record<string, string> = {
  "src/routes/admin-automation.ts": "/api/admin",
  "src/routes/admin-intelligence.ts": "/api/admin",
  "src/routes/admin-partner-acquisition.ts": "/api/admin",
  "src/routes/admin-partner-referral.ts": "/api/admin",
  "src/routes/admin-trust-safety.ts": "/api/admin",
};
const SKIP = /export|download|stream|\/events$|\/sse|\.csv|\.json$|backup/i;
const APPLICANT_ONLY = /^\/api\/partner\/(onboarding|documents|registration-status)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (e.endsWith(".ts")) out.push(f);
  }
  return out;
}

const paths = new Set<string>();
for (const file of walk(join(ROOT, "src", "routes"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const prefixes = [...text.matchAll(/prefix:\s*["'`]([^"'`]+)["'`]/g)].map((m) => ({ at: m.index!, p: m[1]! }));
  for (const m of text.matchAll(/\.get\(\s*(["'`])(\/[^"'`]*)\1/g)) {
    const before = prefixes.filter((x) => x.at < m.index!);
    const prefix = before.length ? before[before.length - 1]!.p : "";
    const full = ((MOUNTED_UNDER[rel] ?? "") + prefix + m[2]!).replace(/\/+$/, "");
    if (!full.startsWith("/api/") || full.includes(":") || full.includes("*") || SKIP.test(full)) continue;
    if (APPLICANT_ONLY.test(full)) continue;
    paths.add(full);
  }
}

const seeder = readFileSync(join(import.meta.dir, "ensure-demo-users.ts"), "utf8");
const pw = seeder.match(/const DEMO_PASSWORD\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
if (!pw) {
  console.error("REFUSING: could not read DEMO_PASSWORD");
  process.exit(2);
}
async function token(email: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  const t = ((await r.json()) as any)?.data?.accessToken;
  if (!t) throw new Error(`login failed for ${email}: HTTP ${r.status}`);
  return t;
}

const tokens = {
  admin: await token("admin@homigo.demo"),
  customer: await token("customer@homigo.demo"),
  partner: await token("partner@homigo.demo"),
};

/**
 * Admin-only surfaces outside /api/admin. Established by measurement in Pass 6: each of these
 * refused the demo customer (403) and admitted the demo admin (200) — 21 of 21.
 */
const ADMIN_ONLY = [
  /^\/api\/admin/, /^\/api\/mlops/, /^\/api\/analytics/, /^\/api\/digital-twin/, /^\/api\/geo-intel/,
  /^\/api\/agents/, /^\/api\/ai\/tools/, /^\/api\/knowledge/,
  /^\/api\/ai\/(brain|context|cost|memory|prompts|timeline|usage)/, /^\/api\/vision/,
  /^\/api\/compliance\/admin/, /^\/api\/coverage\/(admin|intelligence|requests)/,
  /^\/api\/geo\/geofence/, /^\/api\/weather\/admin/,
];

/**
 * Which demo principal owns a path; anything not clearly owned is called as the customer.
 * Partner-applicant routes (APPLICANT_ONLY) authenticate with a registration token, not a session,
 * so a signed-in partner is correctly refused — they are excluded at extraction, not here.
 */
function ownerOf(path: string): keyof typeof tokens {
  if (ADMIN_ONLY.some((re) => re.test(path))) return "admin";
  if (path.startsWith("/api/providers/me") || path.startsWith("/api/partner")) return "partner";
  return "customer";
}

type Row = { path: string; as: string; status: number; snippet: string };
const rows: Row[] = [];
for (const path of [...paths].sort()) {
  const as = ownerOf(path);
  let status = 0;
  let snippet = "";
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { authorization: `Bearer ${tokens[as]}` },
      signal: AbortSignal.timeout(20_000),
      // A redirect to an app scheme (the Google mobile callback) is a correct answer, not a failure.
      redirect: "manual",
    });
    status = r.status;
    if (status >= 400) snippet = (await r.text()).replace(/\s+/g, " ").slice(0, 140);
    else await r.arrayBuffer();
  } catch (e) {
    snippet = e instanceof Error ? e.message : String(e);
  }
  rows.push({ path, as, status, snippet });
}

const by = (pred: (r: Row) => boolean) => rows.filter(pred);
const server = by((r) => r.status >= 500 || r.status === 0);
const denied = by((r) => r.status === 401 || r.status === 403);
const other4xx = by((r) => r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403);
console.log(`[get-sweep] ${rows.length} parameter-free GET routes  target=${BASE}\n`);
console.log(`  2xx/3xx                 ${rows.length - server.length - denied.length - other4xx.length}`);
console.log(`  5xx / no response       ${server.length}`);
console.log(`  401/403 for its owner   ${denied.length}`);
console.log(`  other 4xx               ${other4xx.length}`);
for (const [label, list] of [["5xx", server], ["DENIED TO ITS OWNER", denied], ["OTHER 4xx", other4xx]] as const) {
  if (!list.length) continue;
  console.log(`\n${label}:`);
  for (const r of list) console.log(`  ${String(r.status).padEnd(4)} as ${r.as.padEnd(8)} ${r.path}  ${r.snippet}`);
}
process.exit(server.length ? 1 : 0);

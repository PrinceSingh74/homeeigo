/**
 * Apply the Phase 06 requirement PROPOSAL (scripts/data/phase-06-requirement-proposal.ts) through the
 * audited admin path: catalogue items via requirementCatalogService, per-service assignments via
 * catalogService.update (publish gate, version bump, ServiceConfigVersion row, SERVICE_CONFIG_VERSIONED
 * audit, relational sync — exactly what the admin panel does).
 *
 *   bun --env-file=.env.test run scripts/apply-requirement-proposal.ts --target test --dry-run
 *   bun --env-file=.env.test run scripts/apply-requirement-proposal.ts --target test --actor <admin email>
 *   bun --env-file=.env      run scripts/apply-requirement-proposal.ts --target live --dry-run
 *   bun --env-file=.env      run scripts/apply-requirement-proposal.ts --target live --actor-id <super admin user id> [--services a,b] [--overwrite] [--evidence out.json]
 *
 * Guards: `--target live` requires the database to be named homigo_db (or --confirm-db <name>); `--target test`
 * requires a name containing "test". Idempotent: identical content is skipped without a version bump.
 * A service whose current requirements differ from the proposal is REFUSED unless --overwrite is given —
 * an owner's edit in the admin panel is never silently replaced. --dry-run validates everything (schema,
 * gate, resolver, service existence) and writes nothing.
 */
import { writeFileSync } from "node:fs";
import prisma from "../src/lib/prisma";
import { catalogService } from "../src/services/catalog.service";
import { requirementCatalogService } from "../src/services/requirement-catalog.service";
import { parseCatalogConfig } from "../src/lib/service-catalog-config";
import { loadHydratedCatalog } from "../src/lib/service-catalog-store";
import { requirementAssignmentSchema, resolveServiceRequirements, validateServiceRequirements, type RequirementItemInfo } from "../src/lib/service-requirements";
import { canonicalAssignments, contentHash, planService } from "./lib/requirement-content-apply-plan";
import { validateContent } from "./lib/requirement-content-validator";
import * as FINAL from "./data/phase-06-requirement-content-final";
import * as DRAFT from "./data/phase-06-requirement-proposal";

// --content final (default) | proposal (historical). The final content is validated by the content engine before anything runs.
const contentArg = process.argv.includes("--content") ? process.argv[process.argv.indexOf("--content") + 1] : "final";
const strip = (a: Record<string, unknown>) => { const { meta: _m, ...rest } = a; return rest; };
const SET = contentArg === "proposal"
  ? { version: DRAFT.PROPOSAL_VERSION, CATALOGUE: DRAFT.CATALOGUE.map((i) => ({ ...i, customerLabel: i.customerLabel ?? null, description: i.description ?? null })), PROPOSAL: DRAFT.PROPOSAL as Record<string, unknown[]>, decisions: DRAFT.OWNER_DECISIONS }
  : { version: FINAL.CONTENT_VERSION, CATALOGUE: FINAL.CATALOGUE, PROPOSAL: Object.fromEntries(Object.entries(FINAL.CONTENT).map(([k, v]) => [k, v.assignments.map(strip)])) as Record<string, unknown[]>, decisions: FINAL.HOLDS.map((h) => ({ service: h.services.join(", "), decision: h.what })) };
const { CATALOGUE, PROPOSAL } = SET;
const PROPOSAL_VERSION = SET.version;
const OWNER_DECISIONS = SET.decisions;
const CONTENT_HASH = contentArg === "proposal" ? "n/a" : contentHash({ version: FINAL.CONTENT_VERSION, catalogue: FINAL.CATALOGUE, content: FINAL.CONTENT });
const expectedHash = process.argv.includes("--expect-hash") ? process.argv[process.argv.indexOf("--expect-hash") + 1] : undefined;
if (contentArg !== "proposal") {
  const report = validateContent({ version: FINAL.CONTENT_VERSION, catalogue: FINAL.CATALOGUE, content: FINAL.CONTENT });
  if (report.errors) { console.error(`refusing: content engine reports ${report.errors} error(s) — run scripts/validate-requirement-content.ts`); process.exit(1); }
  console.log(`[requirement-proposal] content engine: 0 errors · hash ${CONTENT_HASH}`);
  if (expectedHash && expectedHash !== CONTENT_HASH) { console.error(`refusing: --expect-hash ${expectedHash} does not match the content on disk (${CONTENT_HASH})`); process.exit(2); }
}

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const has = (k: string) => args.includes(k);
const target = arg("--target");
const dryRun = has("--dry-run");
const overwrite = has("--overwrite");
const only = arg("--services")?.split(",").map((s) => s.trim()).filter(Boolean);
const actorEmail = arg("--actor");
const actorIdArg = arg("--actor-id"); // live admin e-mails are PII-encrypted (users.email is null) — pass the user id from the admin panel
const evidencePath = arg("--evidence");
/**
 * --supersedes <frozen artifact json>: upgrade our own previously applied content. A service whose stored rows
 * equal that artifact is replaced (SUPERSEDE); anything else still differs = an owner edit = refused. Catalogue
 * items present in the artifact but dropped by the new content are archived once nothing uses them.
 */
const supersedesPath = arg("--supersedes");

const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (target !== "test" && target !== "live") { console.error("usage: --target test|live"); process.exit(2); }
if (target === "live" && dbName !== (arg("--confirm-db") ?? "homigo_db")) { console.error(`refusing: --target live but DATABASE_URL is "${dbName}" (pass --confirm-db to override)`); process.exit(2); }
if (target === "test" && !/test/i.test(dbName)) { console.error(`refusing: --target test but DATABASE_URL database "${dbName}" does not contain "test"`); process.exit(2); }
if (!dryRun && !actorEmail && !actorIdArg) { console.error("--actor <super admin email> or --actor-id <user id> is required unless --dry-run"); process.exit(2); }
if (target === "live" && !dryRun && !expectedHash) { console.error("refusing: a live write must be tied to the approved artifact — pass --expect-hash <content hash>"); process.exit(2); }

type Row = { service: string; action: "SKIP_IDENTICAL" | "APPLY" | "SUPERSEDE" | "REFUSED_OWNER_EDIT" | "NOT_FOUND" | "INVALID" | "ERROR" | "WOULD_APPLY" | "WOULD_SUPERSEDE"; detail: string; version?: [number, number] };
const rows: Row[] = [];
const itemRows: Array<{ code: string; action: string }> = [];
const log = (m: string) => console.log(`[requirement-proposal] ${m}`);

/* ── 1. static validation of the proposal itself (no database) ────────────────── */
const byCode = new Map(CATALOGUE.map((i) => [i.code, i]));
const dupCodes = CATALOGUE.map((i) => i.code).filter((c, i, a) => a.indexOf(c) !== i);
if (dupCodes.length) { console.error("duplicate catalogue codes: " + dupCodes.join(", ")); process.exit(1); }
const simulatedItems: Record<string, RequirementItemInfo> = Object.fromEntries(CATALOGUE.map((i) => [i.code, { code: i.code, kind: i.kind, name: i.name, customerLabel: i.customerLabel ?? null, description: i.description ?? null, isActive: true }]));
let staticProblems = 0;
const normalized: Record<string, ReturnType<typeof requirementAssignmentSchema.parse>[]> = {};
for (const [slug, assignments] of Object.entries(PROPOSAL)) {
  const parsed: ReturnType<typeof requirementAssignmentSchema.parse>[] = [];
  for (const a of assignments) {
    const r = requirementAssignmentSchema.safeParse(a);
    if (!r.success) { staticProblems++; console.error(`  ${slug}/${a.id}: ${r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`); continue; }
    if (!byCode.has(r.data.itemCode)) { staticProblems++; console.error(`  ${slug}/${a.id}: unknown catalogue code ${r.data.itemCode}`); }
    parsed.push(r.data);
  }
  normalized[slug] = parsed;
  const issues = validateServiceRequirements({ requirements: parsed, requirementItems: simulatedItems, variants: [], addons: [] } as never);
  if (issues.length) { staticProblems++; console.error(`  ${slug}: gate would refuse — ${issues.map((i) => i.code + (i.requirement ? "(" + i.requirement + ")" : "")).join(", ")}`); }
  const res = resolveServiceRequirements({ requirements: parsed, requirementItems: simulatedItems, variants: [], addons: [] } as never, { variantId: null, addonIds: [], quantity: 1 });
  if (!res.ok) { staticProblems++; console.error(`  ${slug}: resolver refuses — ${res.error}`); }
}
const usedCodes = new Set(Object.values(PROPOSAL).flat().map((a) => a.itemCode));
const unused = CATALOGUE.filter((i) => !usedCodes.has(i.code)).map((i) => i.code);
log(`proposal ${PROPOSAL_VERSION}: ${CATALOGUE.length} catalogue items (${unused.length} unused${unused.length ? ": " + unused.join(", ") : ""}), ${Object.keys(PROPOSAL).length} services, ${Object.values(PROPOSAL).flat().length} assignments, static problems: ${staticProblems}`);
if (staticProblems) process.exit(1);

/* ── 2. database ─────────────────────────────────────────────────────────────── */
const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
if (db !== dbName) { console.error(`refusing: connected to ${db}, expected ${dbName}`); process.exit(2); }
log(`target=${target} database=${db} mode=${dryRun ? "DRY-RUN (no writes)" : "APPLY"}`);

let actorId: string | undefined;
if (!dryRun) {
  const actor = await prisma.user.findUnique({ where: actorIdArg ? { id: actorIdArg } : { email: actorEmail! }, select: { id: true, adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
  if (!actor?.adminProfile?.isActive || actor.adminProfile.role.name !== "SUPER_ADMIN") { console.error("refusing: --actor is not an active SUPER_ADMIN on this database"); process.exit(2); }
  actorId = actor.id;
}

type Superseded = { version: string; contentHash: string; catalogue: Array<{ code: string; kind: string; name: string; customerLabel?: string | null; description?: string | null }>; services: Record<string, unknown[]> };
const superseded: Superseded | null = supersedesPath ? JSON.parse((await import("node:fs")).readFileSync(supersedesPath, "utf8")) : null;
if (superseded) log(`supersedes ${superseded.version} (hash ${superseded.contentHash.slice(0, 16)}) — only services still holding exactly that content are replaced`);

// catalogue
const existingItems = await prisma.serviceRequirementItem.findMany({ where: { code: { in: CATALOGUE.map((i) => i.code) } } });
const existingByCode = new Map(existingItems.map((i) => [i.code, i]));
for (const item of CATALOGUE) {
  const cur = existingByCode.get(item.code);
  if (!cur) {
    itemRows.push({ code: item.code, action: dryRun ? "WOULD_CREATE" : "CREATE" });
    if (!dryRun) {
      const r = await requirementCatalogService.create({ code: item.code, kind: item.kind, name: item.name, customerLabel: item.customerLabel ?? null, description: item.description ?? null }, actorId);
      if ("error" in r) { console.error(`  item ${item.code}: ${r.error} ${r.message ?? ""}`); process.exit(1); }
    }
    continue;
  }
  if (cur.kind !== item.kind) { console.error(`  item ${item.code}: exists with kind ${cur.kind}, proposal says ${item.kind} — a kind never changes; pick another code`); process.exit(1); }
  const same = cur.name === item.name && (cur.customerLabel ?? null) === (item.customerLabel ?? null) && (cur.description ?? null) === (item.description ?? null) && cur.isActive;
  if (same) { itemRows.push({ code: item.code, action: "SKIP_IDENTICAL" }); continue; }
  // Supersede: the stored item still equals the previous artifact's item → nobody edited it since, so update it.
  const prevItem = superseded?.catalogue.find((i) => i.code === item.code);
  const unchangedSincePrevious = !!prevItem && cur.name === prevItem.name && (cur.customerLabel ?? null) === (prevItem.customerLabel ?? null) && (cur.description ?? null) === (prevItem.description ?? null) && cur.isActive;
  if (!overwrite && !unchangedSincePrevious) { itemRows.push({ code: item.code, action: "REFUSED_OWNER_EDIT" }); continue; }
  itemRows.push({ code: item.code, action: dryRun ? "WOULD_UPDATE" : "UPDATE" });
  if (!dryRun) {
    const r = await requirementCatalogService.update(cur.id, { name: item.name, customerLabel: item.customerLabel ?? null, description: item.description ?? null, isActive: true, expectedVersion: cur.version }, actorId);
    if ("error" in r) { console.error(`  item ${item.code}: ${r.error}`); process.exit(1); }
  }
}
const refusedItems = itemRows.filter((r) => r.action === "REFUSED_OWNER_EDIT");
if (refusedItems.length) log(`catalogue: ${refusedItems.length} item(s) differ from the proposal and were left as they are (--overwrite to replace): ${refusedItems.map((r) => r.code).join(", ")}`);

// services
const slugs = Object.keys(PROPOSAL).filter((s) => !only || only.includes(s));
const services = await prisma.service.findMany({ where: { slug: { in: slugs }, dataOrigin: null }, select: { id: true, slug: true, version: true, catalogConfig: true } });
const bySlug = new Map(services.map((s) => [s.slug, s]));
const canon = canonicalAssignments;
for (const slug of slugs) {
  const s = bySlug.get(slug);
  if (!s) { rows.push({ service: slug, action: "NOT_FOUND", detail: "no live (non-fixture) service with this slug" }); continue; }
  const cfg = await loadHydratedCatalog(s);
  const current = cfg?.requirements ?? [];
  const proposal = normalized[slug]!;
  const plan = planService({ current, target: proposal, overwrite, previous: superseded?.services[slug] });
  if (plan.action !== "APPLY" && plan.action !== "SUPERSEDE") { rows.push({ service: slug, action: plan.action, detail: plan.reason, version: [s.version, s.version] }); continue; }
  if (dryRun) { rows.push({ service: slug, action: plan.action === "SUPERSEDE" ? "WOULD_SUPERSEDE" : "WOULD_APPLY", detail: plan.reason, version: [s.version, s.version + 1] }); continue; }
  void canon;
  const base = parseCatalogConfig(s.catalogConfig) ?? {};
  const nextConfig = { ...base, requirements: proposal } as Record<string, unknown>;
  delete nextConfig.requirementItems;
  const r = await catalogService.update(s.id, { catalogConfig: nextConfig as never, expectedVersion: s.version, changeReason: `Phase 06 requirement content ${PROPOSAL_VERSION} · hash ${CONTENT_HASH.slice(0, 16)} · applied under owner authorisation 2026-09-22` }, actorId);
  if ("error" in r) { rows.push({ service: slug, action: r.error === "INVALID_CONFIG" ? "INVALID" : "ERROR", detail: `${r.error}: ${"message" in r ? r.message : ""} ${"issues" in r ? JSON.stringify((r as { issues?: unknown }).issues).slice(0, 300) : ""}` }); continue; }
  rows.push({ service: slug, action: plan.action, detail: plan.reason, version: [s.version, r.service.version] });
}
// Retire catalogue items the superseded artifact had and this content dropped — only once nothing uses them.
const retired: Array<{ code: string; action: string }> = [];
if (superseded) {
  const keep = new Set(CATALOGUE.map((i) => i.code));
  for (const code of superseded.catalogue.map((i) => i.code).filter((c) => !keep.has(c))) {
    const item = await prisma.serviceRequirementItem.findUnique({ where: { code } });
    if (!item) { retired.push({ code, action: "ABSENT" }); continue; }
    if (!item.isActive) { retired.push({ code, action: "ALREADY_ARCHIVED" }); continue; }
    const inUse = await prisma.serviceRequirement.count({ where: { itemId: item.id, isActive: true } });
    if (inUse) { retired.push({ code, action: `KEPT_IN_USE(${inUse})` }); continue; }
    if (dryRun) { retired.push({ code, action: "WOULD_ARCHIVE" }); continue; }
    const r = await requirementCatalogService.update(item.id, { isActive: false, expectedVersion: item.version }, actorId);
    retired.push({ code, action: "error" in r ? `ERROR ${r.error}` : "ARCHIVED" });
  }
  if (retired.length) log(`retired catalogue items: ${retired.map((r) => r.code + "=" + r.action).join(", ")}`);
}
await prisma.$disconnect();

/* ── 3. report ───────────────────────────────────────────────────────────────── */
const count = (k: Row["action"]) => rows.filter((r) => r.action === k).length;
console.log("");
console.log("| service | action | version | detail |");
console.log("|---|---|---|---|");
for (const r of rows) console.log(`| ${r.service} | ${r.action} | ${r.version ? r.version.join(" → ") : "-"} | ${r.detail} |`);
console.log("");
log(`items: ${itemRows.filter((r) => /CREATE/.test(r.action)).length} create · ${itemRows.filter((r) => /UPDATE/.test(r.action)).length} update · ${itemRows.filter((r) => r.action === "SKIP_IDENTICAL").length} identical · ${refusedItems.length} refused`);
log(`services: ${count("APPLY") + count("WOULD_APPLY") + count("SUPERSEDE") + count("WOULD_SUPERSEDE")} ${dryRun ? "would apply" : "applied"} (${count("SUPERSEDE") + count("WOULD_SUPERSEDE")} superseding) · ${count("SKIP_IDENTICAL")} identical · ${count("REFUSED_OWNER_EDIT")} refused (owner edit) · ${count("NOT_FOUND")} not found · ${count("INVALID") + count("ERROR")} failed`);
log(`open holds / decisions: ${OWNER_DECISIONS.length}`);
if (evidencePath) {
  writeFileSync(evidencePath, JSON.stringify({ proposal: PROPOSAL_VERSION, contentHash: CONTENT_HASH, target, database: db, mode: dryRun ? "dry-run" : "apply", at: new Date().toISOString(), actor: actorEmail || actorIdArg ? "(super admin, redacted)" : null, items: itemRows, services: rows, supersedes: superseded ? { version: superseded.version, contentHash: superseded.contentHash } : null, retired, ownerDecisions: OWNER_DECISIONS }, null, 2) + "\n");
  log(`evidence → ${evidencePath}`);
}
process.exit(count("INVALID") + count("ERROR") ? 1 : 0);

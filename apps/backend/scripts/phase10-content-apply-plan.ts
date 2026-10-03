/**
 * Phase 10 — plan (and, only when explicitly approved, apply) the execution / safety / quality content
 * DRAFT (scripts/data/phase-10-execution-safety-content-draft.ts) onto services.catalog_config.
 *
 * DRY-RUN BY DEFAULT. It reads the current catalog_config of each listed service and prints the exact
 * change that WOULD be written — only the `execution`, `safety` and `quality` keys; every other key is
 * carried over untouched (`quality` sub-keys the draft does not define, e.g. warrantyDays, are kept).
 *
 *   # plan (read-only)
 *   bun --env-file=.env.test scripts/phase10-content-apply-plan.ts --url <postgres url> [--services a,b] [--summary]
 *
 *   # apply — ONLY through catalogService.update (the canonical admin write: publish gate, optimistic
 *   # version, service_config_versions row, SERVICE_CONFIG_VERSIONED audit, syncServiceExecution)
 *   bun --env-file=.env.test scripts/phase10-content-apply-plan.ts --url <test url> --services a,b \
 *       --apply --approved-by "<owner name>" --owner-approval <approval.json> --actor-id <SUPER_ADMIN user id>
 *
 * Guards (each refuses the whole run):
 *   - the draft must pass the offline validator (scripts/phase10-content-validate.ts) with 0 violations;
 *   - --url is required and the connected database must be the one it names;
 *   - --apply requires --approved-by, --owner-approval and --actor-id (an active SUPER_ADMIN on that DB);
 *   - --apply on a database whose name does not contain "test" also requires --allow-live;
 *   - --map slug=serviceId (write a draft onto a different service, for fixtures) is test-DB only.
 * Per service: a status other than DRAFT_FOR_OWNER_REVIEW is REFUSED_STATUS; with --apply, a slug missing
 * from the approval file, or whose content hash differs from the approved hash, is refused; a merged
 * config that the real schema or validateExecutionPlan rejects ON THE TARGET (e.g. a safety link to a
 * requirement the target does not have) is INVALID_ON_TARGET. Identical content is SKIP_IDENTICAL.
 *
 * Approval file (JSON):
 *   { "approvedBy": "<name>", "approvedAt": "<ISO date>", "draftVersion": "<DRAFT_VERSION>",
 *     "services": [ { "slug": "bathroom-cleaning", "contentHash": "<sha256 printed by the plan>" } ] }
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serviceCatalogConfigSchema } from "../src/lib/service-catalog-config";
import { validateExecutionPlan } from "../src/lib/service-execution";
import { DRAFT, DRAFT_VERSION, type ServiceDraft } from "./data/phase-10-execution-safety-content-draft";
import { validateDraft } from "./phase10-content-validate";
import { isValidApproverName, normalizeApproverName } from "./lib/approver-name";

export const MANAGED_KEYS = ["execution", "safety", "quality"] as const;
type Cfg = Record<string, unknown>;

/** Stable JSON (sorted keys) so a hash never depends on property order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Cfg)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** The hash an owner approves: the draft version + the exact execution/safety/quality of one service. */
export function contentHash(slug: string, d: ServiceDraft = DRAFT[slug]!): string {
  return createHash("sha256").update(stable({ version: DRAFT_VERSION, slug, execution: d.execution ?? null, safety: d.safety ?? null, quality: d.quality ?? null })).digest("hex");
}

/** current catalog_config + the drafted keys. Only execution/safety/quality change; requirementItems (server-populated) is dropped. */
export function buildNextConfig(current: unknown, d: ServiceDraft): Cfg {
  const base: Cfg = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Cfg) } : {};
  delete base.requirementItems;
  const next: Cfg = { ...base };
  if (d.execution) next.execution = d.execution;
  if (d.safety) next.safety = d.safety;
  if (d.quality) next.quality = { ...((base.quality as Cfg | undefined) ?? {}), ...d.quality };
  return next;
}

/**
 * The managed keys as the database would hold them: the admin write stores the schema-NORMALISED config
 * (defaults filled in — `active`, `evidence: "NONE"`, `skipPolicy`, …), so a raw draft compared against a
 * stored config would never be "identical" and every re-plan would say WOULD_APPLY. Both sides are
 * normalised through the same schema; a config the schema rejects is compared raw (validateOnTarget reports it).
 */
export function normalizedManaged(cfg: unknown): Cfg {
  const raw = (cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {}) as Cfg;
  const r = serviceCatalogConfigSchema.safeParse(raw);
  const src = r.success ? (r.data as unknown as Cfg) : raw;
  return Object.fromEntries(MANAGED_KEYS.map((k) => [k, src[k] ?? null]));
}

/** The per-key change that would be written (managed keys only), compared as stored (normalised). */
export function diffManaged(current: unknown, next: Cfg): Array<{ key: string; before: unknown; after: unknown }> {
  const cur = normalizedManaged(current);
  const nxt = normalizedManaged(next);
  return MANAGED_KEYS.filter((k) => stable(cur[k]) !== stable(nxt[k])).map((k) => ({ key: k, before: cur[k], after: nxt[k] }));
}

/** Everything that is not a managed key must be byte-identical (requirementItems aside). */
export function untouchedKeysPreserved(current: unknown, next: Cfg): boolean {
  const cur = { ...((current && typeof current === "object" ? current : {}) as Cfg) };
  delete cur.requirementItems;
  const strip = (c: Cfg) => Object.fromEntries(Object.entries(c).filter(([k]) => !(MANAGED_KEYS as readonly string[]).includes(k)));
  return stable(strip(cur)) === stable(strip(next));
}

/** Validate the merged config against the TARGET's own requirements — the same rules the admin write applies. */
export function validateOnTarget(next: Cfg): string[] {
  const r = serviceCatalogConfigSchema.safeParse(next);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  return validateExecutionPlan(r.data as never).map((i) => `${i.code}: ${i.message}`);
}

export type Approval = { approvedBy: string; approvedAt?: string; draftVersion: string; services: Array<{ slug: string; contentHash: string }> };

/** Approval gate for one slug. */
export function approvalFor(slug: string, approval: Approval | null, approvedBy: string | undefined): { ok: true } | { ok: false; reason: string } {
  const d = DRAFT[slug];
  if (!d) return { ok: false, reason: "NO_DRAFT" };
  if (d.status !== "DRAFT_FOR_OWNER_REVIEW") return { ok: false, reason: `REFUSED_STATUS (${d.status})` };
  if (!approval) return { ok: false, reason: "REFUSED_NOT_APPROVED (no approval file)" };
  // A placeholder anywhere (the approval file or the command line) is its own refusal, so it can
  // never be mistaken for a typo — and nothing signed by a placeholder reaches catalogService.update.
  if (!isValidApproverName(approval.approvedBy) || !isValidApproverName(approvedBy)) return { ok: false, reason: "REFUSED_PLACEHOLDER_APPROVER" };
  if (normalizeApproverName(approval.approvedBy) !== normalizeApproverName(approvedBy)) return { ok: false, reason: "REFUSED_APPROVER_MISMATCH" };
  if (approval.draftVersion !== DRAFT_VERSION) return { ok: false, reason: `REFUSED_DRAFT_VERSION (${approval.draftVersion} ≠ ${DRAFT_VERSION})` };
  const entry = approval.services.find((s) => s.slug === slug);
  if (!entry) return { ok: false, reason: "REFUSED_NOT_APPROVED" };
  if (entry.contentHash !== contentHash(slug)) return { ok: false, reason: "REFUSED_HASH_MISMATCH (content changed since approval)" };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const has = (k: string) => args.includes(k);
  const log = (m: string) => console.log(`[phase10-apply] ${m}`);
  const die = (m: string, code = 2): never => { console.error(`[phase10-apply] refusing: ${m}`); process.exit(code); };

  const url = arg("--url");
  if (!url) die("--url <postgres url> is required (the plan reads the database it names, nothing else)");
  const dbName = decodeURIComponent(new URL(url!).pathname.replace(/^\//, ""));
  const isTestDb = /test/i.test(dbName);
  const apply = has("--apply");
  const approvedBy = arg("--approved-by");
  const approvalPath = arg("--owner-approval");
  const actorId = arg("--actor-id");
  const summary = has("--summary");
  const only = arg("--services")?.split(",").map((s) => s.trim()).filter(Boolean);
  const map = new Map((arg("--map") ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split("=") as [string, string]));

  if (apply && (!isValidApproverName(approvedBy) || !approvalPath || !actorId)) die("--apply requires a real --approved-by name, --owner-approval <file> and --actor-id <SUPER_ADMIN user id>");
  if (apply && !isTestDb && !has("--allow-live")) die(`--apply on "${dbName}" (not a test database) also requires --allow-live`);
  if (map.size && !isTestDb) die("--map is for fixture services on a test database only");
  for (const s of only ?? []) if (!DRAFT[s]) die(`unknown service slug "${s}"`);

  // 1. Offline validation first — nothing touches a database if the draft itself is wrong.
  const report = validateDraft();
  if (report.violations.length) die(`the draft has ${report.violations.length} validator violation(s) — run scripts/phase10-content-validate.ts`, 1);
  log(`draft ${DRAFT_VERSION}: validator 0 violations`);

  const approval: Approval | null = approvalPath ? JSON.parse(readFileSync(approvalPath, "utf8")) : null;

  // 2. Point the canonical client at --url BEFORE it is imported (static imports would hoist). On a test
  //    database, NODE_ENV=test makes load-env use .env.test (isolated Redis, no live secrets).
  process.env.DATABASE_URL = url!;
  if (isTestDb) process.env.NODE_ENV = "test";
  const { default: prisma } = await import("../src/lib/prisma");
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (db !== dbName) die(`connected to "${db}", but --url names "${dbName}"`);
  log(`database=${db} mode=${apply ? "APPLY (canonical admin write)" : "DRY-RUN (no writes)"}`);

  let actor: string | undefined;
  if (apply) {
    const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { id: true, adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
    if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") die("--actor-id is not an active SUPER_ADMIN on this database");
    actor = a!.id;
  }
  const { catalogService } = apply ? await import("../src/services/catalog.service") : { catalogService: null };

  type Row = { service: string; target: string; status: string; action: string; version: string; hash: string; detail: string };
  const rows: Row[] = [];
  const slugs = (only ?? Object.keys(DRAFT)).sort();
  for (const slug of slugs) {
    const d = DRAFT[slug]!;
    const hash = contentHash(slug);
    const mapped = map.get(slug);
    const svc = mapped
      ? await prisma.service.findUnique({ where: { id: mapped }, select: { id: true, slug: true, version: true, catalogConfig: true } })
      : await prisma.service.findFirst({ where: { slug, dataOrigin: null }, select: { id: true, slug: true, version: true, catalogConfig: true } });
    const row: Row = { service: slug, target: svc ? (mapped ? `${svc.id} (mapped)` : svc.id) : "-", status: d.status, action: "", version: "-", hash: hash.slice(0, 16), detail: "" };
    rows.push(row);
    if (!svc) { row.action = "NOT_FOUND"; row.detail = mapped ? `no service ${mapped}` : "no non-fixture service with this slug"; continue; }
    const next = buildNextConfig(svc.catalogConfig, d);
    const diff = diffManaged(svc.catalogConfig, next);
    if (!untouchedKeysPreserved(svc.catalogConfig, next)) { row.action = "INTERNAL_ERROR"; row.detail = "a non-managed key would change"; continue; }
    const problems = validateOnTarget(next);
    if (d.status !== "DRAFT_FOR_OWNER_REVIEW") { row.action = "REFUSED_STATUS"; row.detail = `${d.status}: ${d.openQuestions[0] ?? ""}`.slice(0, 160); }
    else if (problems.length) { row.action = "INVALID_ON_TARGET"; row.detail = problems.slice(0, 3).join("; "); }
    else if (!diff.length) { row.action = "SKIP_IDENTICAL"; row.version = `${svc.version}`; }
    else if (!apply) { row.action = "WOULD_APPLY"; row.version = `${svc.version} → ${svc.version + 1}`; row.detail = `changes: ${diff.map((x) => x.key).join(", ")}`; }
    else {
      const gate = approvalFor(slug, approval, approvedBy);
      if (!gate.ok) { row.action = gate.reason.split(" ")[0]!; row.detail = gate.reason; }
      else {
        const r = await catalogService!.update(svc.id, { catalogConfig: next as never, expectedVersion: svc.version, changeReason: `Phase 10 execution/safety/quality content ${DRAFT_VERSION} · ${slug} · hash ${hash.slice(0, 16)} · approved by ${approval!.approvedBy}${approval!.approvedAt ? ` (${approval!.approvedAt})` : ""}` }, actor);
        if ("error" in r && r.error) { row.action = "ERROR"; row.detail = `${r.error}: ${"message" in r ? r.message : ""}`; }
        else { row.action = "APPLIED"; row.version = `${svc.version} → ${(r as { service: { version: number } }).service.version}`; row.detail = `changed: ${diff.map((x) => x.key).join(", ")}`; }
      }
    }
    if (!summary && diff.length && row.action !== "NOT_FOUND") {
      console.log(`\n── ${slug} → ${row.target} (${d.status}, hash ${hash}) ──`);
      for (const x of diff) {
        console.log(`  ${x.key}:`);
        console.log(`    - ${JSON.stringify(x.before)}`);
        console.log(`    + ${JSON.stringify(x.after)}`);
      }
    }
  }
  if (apply) {
    // catalogService.update audits fire-and-forget; wait for them before the client goes away.
    const { AuditLogService } = await import("../src/services/audit-log.service");
    const left = await AuditLogService.drain();
    if (left) log(`WARNING: ${left} audit write(s) still pending at exit`);
  }
  await prisma.$disconnect();

  console.log("\n| service | target | draft status | action | version | content hash | detail |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.service} | ${r.target} | ${r.status} | ${r.action} | ${r.version} | ${r.hash} | ${r.detail} |`);
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  log(`${rows.length} services · ${apply ? `${count("APPLIED")} applied` : `${count("WOULD_APPLY")} would apply`} · ${count("SKIP_IDENTICAL")} identical · ${count("REFUSED_STATUS")} refused (status) · ${rows.filter((r) => r.action.startsWith("REFUSED_") && r.action !== "REFUSED_STATUS").length} refused (approval) · ${count("INVALID_ON_TARGET")} invalid on target · ${count("NOT_FOUND")} not found · ${count("ERROR") + count("INTERNAL_ERROR")} failed`);
  if (apply && (count("ERROR") || count("INTERNAL_ERROR"))) process.exit(1);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

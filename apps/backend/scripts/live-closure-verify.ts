/**
 * READ-ONLY live closure verifier — run after each owner step to prove state from the database and
 * the running backend, never from a report. Writes nothing (no INSERT/UPDATE/DDL is issued; the
 * backend calls are GETs and one login).
 *
 *   bun run scripts/live-closure-verify.ts --url "<db url>" [--base http://127.0.0.1:3000]
 *       [--baseline <capability-pool-baseline.json>]   written by `phase11-capability-backfill.ts --write-baseline` BEFORE step F
 *       [--booking <id>]                                certification booking for the strict comparison
 *       [--backend-env <env>]                           the flag environment the backend reads (default: APP_ENV || NODE_ENV from .env)
 *       [--actor <SUPER_ADMIN user id>]                 the actor every apply must carry (default: the runbook's actor)
 *
 * Every gate prints exactly one of:
 *   PASS     proven complete, against an exact expected set
 *   PENDING  not started (nothing of this step is present yet)
 *   FAIL     started but wrong or incomplete, or the proof would be vacuous
 *   BLOCKED  cannot close without a real-world fact the repository does not have
 * The process exits 0 only when every gate is PASS. There are no ">= N" thresholds: each gate
 * compares against the exact population it is about.
 */
import { readFileSync, readdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { DRAFT } from "./data/phase-10-execution-safety-content-draft";
import { buildNextConfig, contentHash, diffManaged } from "./phase10-content-apply-plan";
import { ATTESTATION_ACTION, classifyApprovalProvenance } from "./lib/approval-provenance";
import { PAUSE_REASON } from "./phase10-pause-unsupported-services";
import { HELD_SLUGS, heldWorkSteps } from "./phase10-apply-held-safety";
import { AGE_POLICY, ageDecision } from "./phase10-apply-age-policy";
import { disputePolicyDecision } from "./phase10-apply-published-dispute-policy";
import { comparePools, strictPools, type ParityProvider, type ParityService } from "./lib/capability-parity";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const url = arg("--url");
const BASE = arg("--base") ?? "http://127.0.0.1:3000";
const ACTOR = arg("--actor") ?? "cmq9h67pk0000tz8s6tvnpet5";
if (!url) { console.error("REFUSING: --url required"); process.exit(2); }
process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Verdict = "PASS" | "PENDING" | "FAIL" | "BLOCKED";
const results: Array<{ gate: string; verdict: Verdict }> = [];
function line(gate: string, verdict: Verdict, detail: string, notes: string[] = []) {
  results.push({ gate, verdict });
  console.log(`${verdict.padEnd(7)}  ${gate.padEnd(30)} ${detail}`);
  for (const n of notes) console.log(`         ${n}`);
}

function backendEnv(): string {
  const explicit = arg("--backend-env");
  if (explicit) return explicit;
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");
    return get("APP_ENV") || get("NODE_ENV") || "development";
  } catch {
    return "development";
  }
}

const STALE = ["HOMIGO-20260612-00073", "HOMIGO-20260615-00003", "HOMIGO-20260615-00012", "HOMIGO-20260824-00006"];
const TERMINAL = /^(CANCELLED_BY_USER|CANCELLED_BY_PROVIDER|COMPLETED|EXPIRED|REJECTED|CUSTOMER_NO_SHOW|PROVIDER_NO_SHOW)$/;

/** Objects the six Phase 10/11 migrations create — each must exist after step A. */
const REQUIRED_TABLES = [
  "booking_quality_verdicts", "booking_completions", "booking_completion_audit",
  "booking_cases", "booking_case_events", "booking_case_evidence", "booking_warranties",
  "provider_skills", "provider_certifications", "provider_equipment", "provider_insurance", "provider_languages",
  "provider_service_capabilities", "provider_capability_audit", "businesses", "business_providers", "skills",
  "customer_policy_decisions",
];
const REQUIRED_TRIGGERS = [
  "booking_quality_verdicts_no_update", "booking_completion_audit_no_update", "booking_completions_audit_trg", "booking_completions_immutable_trg",
  "booking_case_events_no_update", "booking_case_evidence_no_update", "booking_cases_guard_trg",
  "provider_capability_audit_no_update", "customer_policy_decisions_no_update",
];
const REQUIRED_CONSTRAINTS = [
  "booking_completions_case_id_fkey", "booking_quality_verdicts_supersedes_id_fkey", "bookings_follow_up_check", "bookings_kind_check",
  "payments_environment_check", "refund_requests_environment_check",
];
const REQUIRED_COLUMNS: Array<[string, string]> = [
  ["bookings", "booking_kind"], ["bookings", "parent_booking_id"], ["bookings", "case_id"], ["services", "business_id"],
  ["payments", "environment"], ["refund_requests", "environment"],
];

async function gateA(): Promise<boolean> {
  const repo = readdirSync(new URL("../prisma/migrations", import.meta.url)).filter((d) => /^\d{14}_/.test(d)).sort();
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  const pending = repo.filter((m) => !applied.has(m));
  // A row neither finished nor rolled back is what makes `prisma migrate deploy` abort (P3009).
  const unresolved = rows.filter((r) => !r.finished_at && !r.rolled_back_at && !applied.has(r.migration_name)).map((r) => r.migration_name);
  const notLocal = [...applied].filter((m) => !repo.includes(m));
  const notes = notLocal.length ? [`applied on this database but absent from prisma/migrations (deploy warns, does not abort): ${notLocal.join(", ")}`] : [];
  if (unresolved.length) line("A migrations", "FAIL", `unresolved failed migration row(s) — migrate deploy will abort: ${unresolved.join(", ")}`, notes);
  else if (pending.length) line("A migrations", "PENDING", `${pending.length} pending of ${repo.length}: ${pending.join(", ")}`, notes);
  else line("A migrations", "PASS", `all ${repo.length} repository migrations applied`, notes);

  const tables = await prisma.$queryRaw<Array<{ t: string; present: boolean }>>`
    SELECT t, to_regclass(t) IS NOT NULL AS present FROM unnest(${REQUIRED_TABLES}::text[]) AS t`;
  const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY(${REQUIRED_TRIGGERS})`;
  const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint WHERE conname = ANY(${REQUIRED_CONSTRAINTS})`;
  const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = ANY(${REQUIRED_COLUMNS.map((c) => c[1])})`;
  const missing = [
    ...tables.filter((t) => !t.present).map((t) => `table ${t.t}`),
    ...REQUIRED_TRIGGERS.filter((t) => !triggers.some((r) => r.tgname === t)).map((t) => `trigger ${t}`),
    ...REQUIRED_CONSTRAINTS.filter((c) => !constraints.some((r) => r.conname === c)).map((c) => `constraint ${c}`),
    ...REQUIRED_COLUMNS.filter(([t, c]) => !cols.some((r) => r.table_name === t && r.column_name === c)).map(([t, c]) => `column ${t}.${c}`),
  ];
  const total = REQUIRED_TABLES.length + REQUIRED_TRIGGERS.length + REQUIRED_CONSTRAINTS.length + REQUIRED_COLUMNS.length;
  const verdict: Verdict = missing.length === 0 ? "PASS" : pending.length === 0 ? "FAIL" : "PENDING";
  line("A schema objects", verdict, `${total - missing.length}/${total} present`, missing.length ? [`missing: ${missing.join(", ")}`] : []);
  return pending.length === 0 && missing.length === 0 && unresolved.length === 0;
}

async function gateB() {
  const bookings = await prisma.booking.findMany({ where: { bookingNumber: { in: STALE } }, select: { id: true, bookingNumber: true, status: true } });
  const found = new Set(bookings.map((b) => b.bookingNumber));
  const absent = STALE.filter((n) => !found.has(n));
  const open = bookings.filter((b) => !TERMINAL.test(b.status));
  const refunds = await prisma.refundRequest.findMany({
    where: { idempotencyKey: { in: bookings.map((b) => `cancel-refund:${b.id}`) } },
    select: { idempotencyKey: true, status: true, amount: true, gatewayRefundId: true },
  });
  const notes = [
    ...bookings.map((b) => {
      const r = refunds.find((x) => x.idempotencyKey === `cancel-refund:${b.id}`);
      return `${b.bookingNumber}: ${b.status}${r ? ` · refund ${r.status} ₹${r.amount}${r.gatewayRefundId ? ` ${r.gatewayRefundId}` : ""}` : ""}`;
    }),
    ...absent.map((n) => `${n}: NOT FOUND`),
  ];
  const stuck = refunds.filter((r) => /INDETERMINATE|PROCESSING|REQUESTED/.test(String(r.status)));
  if (absent.length) line("B stale bookings", "FAIL", `${absent.length} of the four not found`, notes);
  else if (stuck.length) line("B stale bookings", "FAIL", `${stuck.length} refund(s) not settled (${stuck.map((r) => r.status).join(",")}) — reconcile from the provider dashboard, do not re-run`, notes);
  else if (open.length === STALE.length) line("B stale bookings", "PENDING", "none of the four dispositioned", notes);
  else if (open.length) line("B stale bookings", "FAIL", `${open.length} of 4 still open — gate closes only when all four are terminal or the decision not to cancel is recorded`, notes);
  else line("B stale bookings", "PASS", "all four terminal; refunds settled or honestly FAILED", notes);
}

type Svc = { id: string; slug: string; version: number; name: string; description: string | null; catalogConfig: unknown };
type PausedSvc = { id: string; slug: string; isBookable: boolean; isCustomerVisible: boolean; lifecycleStatus: string };

async function versionActor(serviceId: string, version: number): Promise<string | null> {
  const v = await prisma.serviceConfigVersion.findUnique({ where: { serviceId_version: { serviceId, version } }, select: { createdBy: true } });
  return v?.createdBy ?? null;
}

async function gateCD(services: Svc[], paused: PausedSvc[]) {
  const bySlug = new Map(services.map((s) => [s.slug, s]));
  const pausedSlugs = new Set(paused.map((p) => p.slug));
  const drafted = Object.entries(DRAFT).filter(([, d]) => d.status === "DRAFT_FOR_OWNER_REVIEW").map(([s]) => s).sort();

  const check = async (slugs: string[], label: string, extra?: (slug: string) => string | null) => {
    const identical: string[] = [], differs: string[] = [], untouched: string[] = [], missing: string[] = [], bad: string[] = [], held: string[] = [];
    for (const slug of slugs) {
      const svc = bySlug.get(slug);
      // Owner decision 2026-09-29: a service without approved method facts is PAUSED (not visible, not
      // bookable) with the reason recorded. Release-safe; never counted as "content complete".
      if (!svc && pausedSlugs.has(slug)) { held.push(slug); continue; }
      if (!svc) { missing.push(slug); continue; }
      const cfg = (svc.catalogConfig ?? {}) as Record<string, unknown>;
      const diff = diffManaged(cfg, buildNextConfig(cfg, DRAFT[slug]!));
      const problem = extra?.(slug) ?? null;
      if (problem) { bad.push(`${slug}: ${problem}`); continue; }
      if (diff.length === 0) {
        const by = await versionActor(svc.id, svc.version);
        if (by !== ACTOR) bad.push(`${slug}: content identical but version ${svc.version} was written by ${by ?? "nobody (no version row)"}, not the closure actor`);
        else identical.push(slug);
      } else if (!cfg.execution && !cfg.safety && !cfg.quality) untouched.push(slug);
      else differs.push(`${slug} (${diff.map((d) => d.key).join(",")})`);
    }
    const notes = [
      ...(held.length ? [`paused pending approved method facts (not offered): ${held.join(", ")}`] : []),
      ...(missing.length ? [`not found as active business services: ${missing.join(", ")}`] : []),
      ...(differs.length ? [`carry content that differs from the approved draft: ${differs.join("; ")}`] : []),
      ...bad,
    ];
    const verdict: Verdict = identical.length + held.length === slugs.length ? "PASS" : untouched.length === slugs.length ? "PENDING" : "FAIL";
    line(label, verdict, `${identical.length}/${slugs.length} identical to the approved draft${held.length ? ` · ${held.length} paused (not offered)` : ""} · ${untouched.length} untouched`, notes);
  };

  await check(drafted, "C content (25 services)");
  await gateApprovalProvenance(drafted, bySlug);
  await check(HELD_SLUGS, "D held services (6)", (slug) => {
    const svc = bySlug.get(slug)!;
    const steps = (((svc.catalogConfig ?? {}) as { execution?: { steps?: Array<{ kind?: string; id?: string }> } }).execution?.steps ?? []);
    const work = steps.filter((s) => s.kind === "WORK").map((s) => s.id);
    if (work.length) return `carries WORK step(s) ${work.join(",")} — a held service may not have a method step`;
    if (heldWorkSteps(DRAFT[slug]!).length) return "the held draft itself carries a WORK step";
    return null;
  });

  const undrafted = services.filter((s) => !DRAFT[s.slug]);
  if (undrafted.length) {
    line("C2 services without a draft", "BLOCKED", `${undrafted.length} active business service(s) have no execution/safety/quality content and no draft: ${undrafted.map((s) => s.slug).join(", ")}`,
      ["no content may be invented for them; the owner supplies the method facts or pauses the service (see certification §30)"]);
  } else line("C2 services without a draft", "PASS", "every active business service is covered by the draft", paused.length ? [`content BLOCKED on owner facts, therefore paused: ${paused.map((p) => p.slug).join(", ")}`] : []);

  // The paused set records content that does NOT exist; this gate proves only that none of it is offered.
  const offered = paused.filter((p) => p.isBookable || p.isCustomerVisible || p.lifecycleStatus !== "PAUSED");
  if (!paused.length) line("P paused pending facts", "PASS", "no service is paused for missing method facts");
  else line("P paused pending facts", offered.length ? "FAIL" : "PASS", `${paused.length} service(s) paused with the reason "${PAUSE_REASON}" · ${offered.length} still offered`, [paused.map((p) => p.slug).join(", ")]);
}

/** E2 — the published 48-hour dispute / free-rework promise on every active business service. */
/**
 * Who approved the content that is live — from the durable audit rows (activity_logs), never from an
 * approval file (a rehearsal file carries the same hashes; a file can be written after the fact).
 * PASS only when every live approved content names a real approver at apply time or carries an owner
 * attestation for its exact version and content hash. The historical rows are never edited.
 */
async function gateApprovalProvenance(slugs: string[], bySlug: Map<string, Svc>) {
  const rows = await prisma.activityLog.findMany({
    where: { action: "ADMIN_ACTION", OR: [{ description: { contains: "Phase 10 execution/safety/quality content" } }, { description: { contains: ATTESTATION_ACTION } }] },
    select: { description: true },
    orderBy: { createdAt: "desc" }, // newest first: the latest apply / attestation of a content decides
  });
  const found = { APPROVED: [] as string[], ATTESTED: [] as string[], PLACEHOLDER: [] as string[], UNRECORDED: [] as string[] };
  const placeholderNames = new Map<string, number>();
  let live = 0;
  for (const slug of slugs) {
    const svc = bySlug.get(slug);
    if (!svc) continue;
    const cfg = (svc.catalogConfig ?? {}) as Record<string, unknown>;
    if (diffManaged(cfg, buildNextConfig(cfg, DRAFT[slug]!)).length) continue; // not the approved content — gate C reports it
    live++;
    const p = classifyApprovalProvenance(rows.filter((r) => r.description?.includes(svc.id)), { serviceId: svc.id, version: svc.version, contentHash: contentHash(slug) });
    if (p.kind === "UNRECORDED") found.UNRECORDED.push(slug);
    else found[p.kind].push(slug);
    if (p.kind === "PLACEHOLDER") placeholderNames.set(p.approver, (placeholderNames.get(p.approver) ?? 0) + 1);
  }
  if (live === 0) { line("C approval provenance", "PENDING", "no approved content is live yet"); return; }
  const proven = found.APPROVED.length + found.ATTESTED.length;
  if (proven === live) {
    line("C approval provenance", "PASS", `${live}/${live} live contents name a real approver in the audit log (${found.APPROVED.length} at apply · ${found.ATTESTED.length} by owner attestation)`);
    return;
  }
  line("C approval provenance", "BLOCKED", `${proven}/${live} live contents name a real approver · ${found.PLACEHOLDER.length} applied under a placeholder · ${found.UNRECORDED.length} with no recorded approver`, [
    ...[...placeholderNames].map(([name, n]) => `${n} applied from an approval signed "${name}" (activity_logs, kept as history)`),
    ...(found.UNRECORDED.length ? [`no approver recorded: ${found.UNRECORDED.join(", ")}`] : []),
    'the owner attests (appends, changes no content): bun run scripts/phase10-attest-approval.ts --url "$DB_URL" --approved-by "$OWNER_NAME" --apply --actor-id "$ACTOR" --allow-live',
  ]);
}

async function gateE2(services: Svc[]) {
  let configured = 0;
  const kept: string[] = [];
  const missing: string[] = [];
  for (const s of services) {
    const d = disputePolicyDecision(s.catalogConfig);
    if (d.decision === "IDENTICAL") configured++;
    else if (d.decision === "KEEP_EXISTING") { configured++; kept.push(`${s.slug} (${d.conflicts.join(",")})`); }
    else missing.push(s.slug);
  }
  const notes = [...(kept.length ? [`owner-set policy kept: ${kept.join("; ")}`] : []), ...(missing.length && configured ? [`no dispute policy: ${missing.join(", ")}`] : [])];
  const verdict: Verdict = configured === services.length ? "PASS" : configured === 0 ? "PENDING" : "FAIL";
  line("E2 dispute policy", verdict, `${configured}/${services.length} active business services carry a complaint window and rework warranty (published 48-hour promise)`, notes);
}

async function gateE(services: Svc[]) {
  let explicit = 0;
  const decide: string[] = [], missing: string[] = [], wrongActor: string[] = [];
  for (const s of services) {
    const d = ageDecision(s.catalogConfig, { name: s.name, description: s.description });
    if (d.decision === "IDENTICAL" || d.decision === "KEEP_EXISTING") explicit++;
    else if (d.decision === "OWNER_DECISION_REQUIRED") decide.push(`${s.slug} (${d.evidence[0]?.path}: ${JSON.stringify(d.evidence[0]?.text)})`);
    else missing.push(s.slug);
  }
  const notes = [...(decide.length ? [`owner decision required (catalogue mentions an age/audience): ${decide.join("; ")}`] : []), ...(missing.length && explicit ? [`no policy: ${missing.join(", ")}`] : []), ...wrongActor];
  const verdict: Verdict = explicit === services.length ? "PASS" : explicit === 0 ? "PENDING" : "FAIL";
  line("E age policy", verdict, `${explicit}/${services.length} active business services carry an explicit policy (${JSON.stringify(AGE_POLICY)} where no age evidence)`, notes);
}

async function loadParityInputs() {
  const { PARTNER_OPERATIONAL_WHERE } = await import("../src/lib/service-domain");
  const { resolveServiceMatchTokens, providerOffersService } = await import("../src/lib/service-match");
  const { DISPATCHABLE_PROVIDER_WHERE } = await import("../src/lib/partner-four-axis");
  const services = await prisma.service.findMany({ where: PARTNER_OPERATIONAL_WHERE, select: { id: true, slug: true } });
  const providers = await prisma.provider.findMany({ where: { ...DISPATCHABLE_PROVIDER_WHERE }, select: { id: true, serviceCategories: true, user: { select: { dataOrigin: true } } } });
  const rows = await prisma.$queryRaw<Array<{ provider_id: string; service_id: string; status: string; data_origin: string | null }>>`
    SELECT provider_id, service_id, status, data_origin::text AS data_origin FROM provider_service_capabilities`;
  const byProvider = new Map<string, ParityProvider["rows"]>();
  for (const r of rows) byProvider.set(r.provider_id, [...(byProvider.get(r.provider_id) ?? []), { serviceId: r.service_id, status: r.status, origin: r.data_origin }]);
  const pp: ParityProvider[] = providers.map((p) => ({ id: p.id, serviceCategories: p.serviceCategories ?? [], origin: p.user?.dataOrigin ?? null, rows: byProvider.get(p.id) ?? [] }));
  const ps: ParityService[] = [];
  for (const s of services) {
    const tokens = await resolveServiceMatchTokens(s.id);
    ps.push({ id: s.id, slug: s.slug, offers: tokens ? (c) => providerOffersService(c, tokens) : () => false });
  }
  return { pp, ps, rows };
}

async function gateF(paused: PausedSvc[] = []): Promise<boolean> {
  const present = await prisma.$queryRaw<Array<{ p: boolean }>>`SELECT to_regclass('provider_service_capabilities') IS NOT NULL AS p`;
  if (!present[0]?.p) { line("F capability backfill", "PENDING", "capability table absent"); return false; }
  const baselinePath = arg("--baseline");
  if (!baselinePath) {
    line("F capability backfill", "FAIL", "no --baseline given: without the pool recorded BEFORE the apply, parity cannot be proven (phase11-capability-backfill.ts --write-baseline)");
    return false;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { kind: string; database: string; recordedAt: string; existingRows: number; plannedInserts: number; providers: number; services: number; pools: Record<string, string[]> };
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  if (baseline.kind !== "capability-pool-baseline" || baseline.database !== db || !baseline.recordedAt) { line("F capability backfill", "FAIL", `baseline file is not a capability-pool baseline for "${db}"`); return false; }
  const since = new Date(baseline.recordedAt);
  // Rows written after the baseline was recorded are the backfill's (and nothing else's) — each is checked.
  const fresh = await prisma.$queryRaw<Array<{ n: bigint; not_legacy: bigint; not_actor: bigint; not_active: bigint; origin_mismatch: bigint }>>`
    SELECT count(*) AS n,
           count(*) FILTER (WHERE c.source <> 'LEGACY') AS not_legacy,
           count(*) FILTER (WHERE c.verified_by IS DISTINCT FROM ${ACTOR}) AS not_actor,
           count(*) FILTER (WHERE c.status <> 'ACTIVE') AS not_active,
           count(*) FILTER (WHERE c.data_origin IS DISTINCT FROM u.data_origin) AS origin_mismatch
    FROM provider_service_capabilities c JOIN providers p ON p.id = c.provider_id JOIN users u ON u.id = p.user_id
    WHERE c.created_at > ${since}`;
  const f = fresh[0]!;
  const inserted = Number(f.n);
  const { pp, ps, rows } = await loadParityInputs();
  if (inserted === 0 && rows.length === baseline.existingRows) {
    line("F capability backfill", baseline.plannedInserts ? "PENDING" : "PASS", `0 of ${baseline.plannedInserts} planned rows inserted since the baseline (${baseline.recordedAt})`);
    return baseline.plannedInserts === 0;
  }
  const isBusiness = (o: string | null) => o === null || o === "REAL";
  // Services PAUSED for missing method facts (owner decision 2026-09-29) are no longer operational: their
  // baseline pools leave the comparison, and only theirs. Any other shrink, growth or set change still fails.
  const pausedIds = new Set(paused.map((p) => p.id));
  const pausedPairs = Object.entries(baseline.pools).filter(([sid]) => pausedIds.has(sid)).reduce((n, [, ids]) => n + ids.length, 0);
  const basePools = Object.fromEntries(Object.entries(baseline.pools).filter(([sid]) => !pausedIds.has(sid)));
  const baseServices = baseline.services - Object.keys(baseline.pools).filter((sid) => pausedIds.has(sid)).length;
  const cmp = comparePools(basePools, strictPools(pp, ps, isBusiness));
  const dups = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM (SELECT 1 FROM provider_service_capabilities GROUP BY provider_id, service_id HAVING count(*) > 1) d`;
  const orphans = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM provider_service_capabilities c
    LEFT JOIN providers p ON p.id = c.provider_id LEFT JOIN services s ON s.id = c.service_id
    WHERE p.id IS NULL OR s.id IS NULL`;
  const pair = (x: { providerId: string; serviceId: string }) => `${x.providerId}@${x.serviceId}`;
  const expectRows = baseline.existingRows + baseline.plannedInserts;
  const problems = [
    ...(rows.length !== expectRows ? [`rows ${rows.length} ≠ expected ${expectRows} (${baseline.existingRows} existing + ${baseline.plannedInserts} planned)`] : []),
    ...(inserted !== baseline.plannedInserts ? [`rows written since the baseline ${inserted} ≠ planned ${baseline.plannedInserts}`] : []),
    ...(Number(f.not_legacy) ? [`${Number(f.not_legacy)} new row(s) not source LEGACY`] : []),
    ...(Number(f.not_actor) ? [`${Number(f.not_actor)} new row(s) not verified by the closure actor`] : []),
    ...(Number(f.not_active) ? [`${Number(f.not_active)} new row(s) not ACTIVE`] : []),
    ...(Number(f.origin_mismatch) ? [`${Number(f.origin_mismatch)} new row(s) whose provenance differs from their provider`] : []),
    ...(ps.length !== baseServices ? [`operational services ${ps.length} ≠ baseline ${baseServices}${pausedIds.size ? ` (${baseline.services} minus ${baseline.services - baseServices} paused)` : ""}`] : []),
    ...(pp.length !== baseline.providers ? [`dispatchable providers ${pp.length} ≠ baseline ${baseline.providers}`] : []),
    ...(cmp.shrink.length ? [`pool SHRINK ${cmp.shrink.length}: ${cmp.shrink.slice(0, 5).map(pair).join(", ")}`] : []),
    ...(cmp.growth.length ? [`pool GROWTH ${cmp.growth.length}: ${cmp.growth.slice(0, 5).map(pair).join(", ")}`] : []),
    ...(cmp.missingServices.length || cmp.extraServices.length ? [`service set changed: -${cmp.missingServices.length} +${cmp.extraServices.length}`] : []),
    ...(Number(dups[0]!.n) ? [`duplicate provider/service pairs ${Number(dups[0]!.n)}`] : []),
    ...(Number(orphans[0]!.n) ? [`rows pointing at a missing provider/service ${Number(orphans[0]!.n)}`] : []),
  ];
  const pausedNote = pausedIds.size ? [`${pausedIds.size} service(s) paused pending method facts left the comparison with their ${pausedPairs} baseline pair(s): ${paused.map((p) => p.slug).join(", ")}`] : [];
  line("F capability backfill", problems.length ? "FAIL" : "PASS", problems.length ? `${problems.length} problem(s)` : `${inserted} rows · ${ps.length} services · ${pp.length} providers · strict pool == baseline pool exactly (shrink 0, growth 0) · dup 0 · orphan 0`, [...problems, ...pausedNote]);
  return problems.length === 0;
}

async function gateG(fPassed: boolean): Promise<{ flagOk: boolean }> {
  const env = backendEnv();
  const flags = await prisma.platformFeatureFlag.findMany({ where: { key: "matching.strict_service_capability" } });
  if (flags.length === 0) { line("G strict flag", "PENDING", `no flag row (backend reads environment "${env}")`); return { flagOk: false }; }
  const f = flags[0]!;
  const history = await prisma.platformFeatureFlagHistory.findFirst({ where: { flagKey: f.key, enabled: true }, orderBy: { createdAt: "desc" } });
  const problems = [
    ...(f.environment !== env ? [`environment "${f.environment}" but the backend reads "${env}" — the flag is invisible to it`] : []),
    ...(!f.enabled ? ["enabled = false"] : []),
    ...(f.rolloutPct !== 100 ? [`rollout ${f.rolloutPct}% — strict would be partial`] : []),
    ...(f.isKillSwitch ? ["marked as a kill switch"] : []),
    ...(!f.updatedBy ? ["no updated_by (not written through the admin route)"] : []),
    ...(!history ? ["no history row for the enabling change"] : !history.reason ? ["history row has no reason"] : []),
    ...(!fPassed ? ["step F is not PASS — strict must not be on before exact parity is proven"] : []),
  ];
  line("G strict flag", problems.length ? "FAIL" : "PASS", `env=${f.environment} enabled=${f.enabled} rollout=${f.rolloutPct} updatedBy=${f.updatedBy ?? "-"}${history ? ` changedBy=${history.changedBy} reason=${JSON.stringify(history.reason)}` : ""}`, problems);
  return { flagOk: problems.length === 0 };
}

async function runtime(flagOk: boolean) {
  let tok: string | undefined;
  try {
    const seeder = readFileSync(new URL("./ensure-demo-users.ts", import.meta.url), "utf8");
    const pw = seeder.match(/DEMO_PASSWORD\s*=\s*"([^"]+)"/)?.[1] ?? "";
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@homigo.demo", password: pw, setAuthCookies: false }) });
    tok = ((await login.json()) as { data?: { accessToken?: string } })?.data?.accessToken;
  } catch (e) {
    for (const g of ["R cases route", "R policy route", "R quality route", "G strict dry run", "G runtime strict parity"]) line(g, "FAIL", `backend not reachable at ${BASE}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!tok) { for (const g of ["R cases route", "R policy route", "R quality route", "G strict dry run", "G runtime strict parity"]) line(g, "FAIL", "admin login returned no token"); return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are read defensively, field by field
  const get = async (p: string): Promise<{ status: number; j: any }> => { const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

  const cases = await get("/api/admin/cases?limit=1");
  line("R cases route", cases.status === 200 ? "PASS" : cases.status === 503 ? "PENDING" : "FAIL", `GET /api/admin/cases → ${cases.status}`);
  const pol = await get("/api/admin/customer-policy/decisions?limit=1");
  line("R policy route", pol.j?.data?.deployed === true ? "PASS" : pol.j?.data?.deployed === false ? "PENDING" : "FAIL", `deployed=${pol.j?.data?.deployed}`);

  const completed = await prisma.booking.findFirst({ where: { status: "COMPLETED", dataOrigin: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (completed) {
    const q = await get(`/api/admin/bookings/${completed.id}/quality`);
    line("R quality route", q.j?.data?.enforced === true ? "PASS" : q.j?.data?.enforced === false ? "PENDING" : "FAIL", `enforced=${q.j?.data?.enforced}`);
  } else line("R quality route", "FAIL", "no completed business booking to read");

  // Strict parity at runtime: the SAME bookings, the SAME moment, strict vs a LEGACY preview.
  // Compared per candidate on the full list of gate reasons (not only who matched): the capability
  // gate is evaluated for every candidate even when presence or location rejects it, so a strict-only
  // SERVICE_CAPABILITY_MISSING shows up here whether or not anyone is online.
  //   "G strict dry run"        ?mode=STRICT preview vs ?mode=LEGACY_FALLBACK — safe before the flag exists
  //   "G runtime strict parity" the flag's own mode (must be STRICT)  vs ?mode=LEGACY_FALLBACK
  const explicit = arg("--booking");
  const bookings = explicit
    ? [{ id: explicit }]
    : await prisma.booking.findMany({
        where: { status: { in: ["PENDING", "ACCEPTED"] }, dataOrigin: null, scheduledDate: { gte: new Date() }, user: { dataOrigin: null }, service: { isActive: true } },
        orderBy: { scheduledDate: "asc" }, take: 5, select: { id: true },
      }).then(async (upcoming) => upcoming.length >= 3 ? upcoming : [
        ...upcoming,
        // The evaluation is read-only, so a recent business booking of an offered service is a fair input too.
        ...(await prisma.booking.findMany({
          where: { dataOrigin: null, user: { dataOrigin: null }, service: { isActive: true }, id: { notIn: upcoming.map((u) => u.id) } },
          orderBy: { createdAt: "desc" }, take: 5 - upcoming.length, select: { id: true },
        })),
      ]);
  if (bookings.length === 0) {
    for (const g of ["G strict dry run", "G runtime strict parity"]) line(g, "FAIL", "no upcoming business booking to certify on — pass --booking <id>");
    return;
  }
  type Diag = { serviceCapabilityMode?: string; capabilityModePreviewed?: boolean; candidateCount?: number; matches?: Array<{ providerId: string }>; rejections?: Array<{ providerId: string; reasons: string[] }> };
  const fingerprint = (d: Diag) => {
    const out: Record<string, string> = {};
    for (const m of d.matches ?? []) out[m.providerId] = "MATCHED";
    for (const r of d.rejections ?? []) out[r.providerId] = [...r.reasons].sort().join(",");
    return out;
  };
  const compare = async (gate: string, query: string, requireFlagStrict: boolean) => {
    const notes: string[] = [];
    let candidates = 0, mismatches = 0, notStrict = 0, noPreview = 0;
    for (const { id } of bookings) {
      // includeOffline=1: every provider of the population that offers the service is EVALUATED, online or
      // not (presence refuses the offline ones in both modes alike), so the comparison has candidates even
      // when nobody is online. Read-only on the backend; dispatch stays online-only.
      const x = await get(`/api/admin/bookings/${id}/matching-diagnostics${query ? `${query}&` : "?"}includeOffline=1`);
      const legacy = await get(`/api/admin/bookings/${id}/matching-diagnostics?mode=LEGACY_FALLBACK&includeOffline=1`);
      const a: Diag = x.j?.data ?? {}, b: Diag = legacy.j?.data ?? {};
      if (legacy.status === 400 || x.status === 400 || b.capabilityModePreviewed !== true || (b as { offlineIncluded?: boolean }).offlineIncluded !== true) { noPreview++; continue; }
      if (a.serviceCapabilityMode !== "STRICT") notStrict++;
      const fa = fingerprint(a), fb = fingerprint(b);
      const diff = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((p) => fa[p] !== fb[p]);
      candidates += new Set([...Object.keys(fa), ...Object.keys(fb)]).size;
      if (diff.length) mismatches++;
      notes.push(`booking ${id}: ${a.serviceCapabilityMode}${a.capabilityModePreviewed ? " (preview)" : " (flag)"} matched ${(a.matches ?? []).length}/${a.candidateCount} · legacy matched ${(b.matches ?? []).length}/${b.candidateCount}${diff.length ? ` · ${diff.length} candidate(s) differ, e.g. ${diff[0]}: strict=[${fa[diff[0]!] ?? "-"}] legacy=[${fb[diff[0]!] ?? "-"}]` : " · identical per candidate"}`);
    }
    if (noPreview) { line(gate, "FAIL", "the backend does not support the read-only ?mode= / ?includeOffline= preview (restart it on the current code)", notes); return; }
    if (notStrict) {
      line(gate, requireFlagStrict && flagOk ? "FAIL" : "PENDING", `backend matches in LEGACY_FALLBACK for ${notStrict} of ${bookings.length} booking(s)${requireFlagStrict && flagOk ? " although the flag row is correct — cache or environment mismatch" : ""}`, notes);
      return;
    }
    if (candidates === 0) { line(gate, "FAIL", "0 candidates across the sampled bookings, offline partners included — the comparison would be vacuous; pass --booking for a service business providers offer", notes); return; }
    line(gate, mismatches ? "FAIL" : "PASS", mismatches ? `STRICT and legacy disagree on ${mismatches} booking(s)${requireFlagStrict ? " — turn the flag off through the admin route and diagnose" : " — do not enable the flag"}` : `STRICT reproduces the legacy decision for every candidate on ${bookings.length} booking(s) (${candidates} candidate evaluations, offline partners included)`, notes);
  };
  await compare("G strict dry run", "?mode=STRICT", false);
  await compare("G runtime strict parity", "", true);
}

async function main() {
  const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  console.log(`\n[live-closure-verify] ${db} @ ${new Date().toISOString()} · backend ${BASE} (flag env "${backendEnv()}") · actor ${ACTOR}\n${"=".repeat(96)}`);
  await gateA();
  await gateB();
  const services = await prisma.service.findMany({ where: { isActive: true, dataOrigin: null }, select: { id: true, slug: true, version: true, name: true, description: true, catalogConfig: true }, orderBy: { slug: "asc" } });
  console.log(`         population: ${services.length} active business services`);
  const paused = await prisma.service.findMany({ where: { dataOrigin: null, lifecycleStatus: "PAUSED", operationsNotes: { contains: PAUSE_REASON } }, select: { id: true, slug: true, isBookable: true, isCustomerVisible: true, lifecycleStatus: true }, orderBy: { slug: "asc" } });
  await gateCD(services, paused);
  await gateE(services);
  await gateE2(services);
  const fOk = await gateF(paused);
  const { flagOk } = await gateG(fOk);
  await runtime(flagOk);
  const tally = { PASS: 0, PENDING: 0, FAIL: 0, BLOCKED: 0 };
  for (const r of results) tally[r.verdict]++;
  console.log(`${"=".repeat(96)}\n${results.length} gates: ${tally.PASS} PASS · ${tally.PENDING} PENDING · ${tally.FAIL} FAIL · ${tally.BLOCKED} BLOCKED${tally.PASS === results.length ? " — ALL PASS" : ""}`);
  if (tally.PASS !== results.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

/**
 * Phase 10 — pause every active business service that has no approved execution / safety / quality
 * METHOD facts, instead of offering behaviour Homeeigo cannot describe. Owner decision, 2026-09-29.
 *
 * Candidates (nothing else can be paused by this tool):
 *   - NO_CONTENT               active business services with no draft at all (spa, personal-hygiene-bathing-care)
 *   - OWNER_APPROVAL_REQUIRED  held drafts whose WORK method needs a regulated/specialist procedure or a
 *                              commercial decision nobody has made (ac-service, electrician, home-painting,
 *                              pest-control, plumbing)
 *   - SAFETY_HOLD              held drafts with no safe operational definition (fasade-cleaning, work at height)
 * A service whose draft is DRAFT_FOR_OWNER_REVIEW (complete approved content) is refused.
 *
 * The pause is the canonical admin lifecycle write (`catalogService.transition(id, "PAUSED")`: not
 * visible, not bookable, audited SERVICE_LIFECYCLE_CHANGED); the slug, configuration, versions and every
 * booking are kept. The reason goes into the admin-only `operationsNotes` and into an explicit
 * SERVICE_PAUSED_PENDING_METHOD_FACTS audit row. Existing bookings are not touched.
 *
 *   bun run scripts/phase10-pause-unsupported-services.ts --url "$DB_URL"                       # report
 *   bun run scripts/phase10-pause-unsupported-services.ts --url "$DB_URL" --apply --actor-id <SUPER_ADMIN> [--allow-live]
 *   [--services a,b]   only these slugs      [--map slug=serviceId,…]  fixtures, test DB only
 */
import { PrismaClient } from "@prisma/client";
import { DRAFT } from "./data/phase-10-execution-safety-content-draft";

export const PAUSE_REASON = "Paused pending approved execution/safety/quality method facts.";
export const PAUSE_AUDIT_ACTION = "SERVICE_PAUSED_PENDING_METHOD_FACTS";
const OPEN = ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "EXPIRED", "REJECTED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"];

/** Why a slug may be paused by this tool, or null when its approved content is complete (never paused here). */
export function pauseCategory(slug: string): "NO_CONTENT" | "OWNER_APPROVAL_REQUIRED" | "SAFETY_HOLD" | null {
  const d = DRAFT[slug];
  if (!d) return "NO_CONTENT";
  if (d.status === "DRAFT_FOR_OWNER_REVIEW") return null;
  return d.status;
}

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m: string): never => { console.error(`[pause-unsupported] refusing: ${m}`); process.exit(2); };

async function main() {
  const url = arg("--url");
  const actorId = arg("--actor-id");
  const APPLY = argv.includes("--apply");
  if (!url) die("--url <postgres url> is required");
  if (APPLY && !actorId) die("--apply needs --actor-id <SUPER_ADMIN user id>");
  process.env.DATABASE_URL = url!;
  const prisma = new PrismaClient({ datasources: { db: { url: url! } } });
  try {
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    const isTest = /test/i.test(db);
    if (APPLY && !isTest && !argv.includes("--allow-live")) die(`"${db}" is live; --apply needs --allow-live`);
    if (isTest) process.env.NODE_ENV = "test";
    const map = new Map((arg("--map") ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split("=") as [string, string]));
    if (map.size && !isTest) die("--map is for test databases only");
    if (APPLY) {
      const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
      if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") die("--actor-id is not an active SUPER_ADMIN on this database");
    }

    // Default population: every held draft + every active business service with no draft.
    const active = await prisma.service.findMany({ where: { isActive: true, dataOrigin: null }, select: { slug: true } });
    const defaults = [...new Set([...Object.keys(DRAFT).filter((s) => pauseCategory(s) !== null), ...active.map((s) => s.slug).filter((s) => !DRAFT[s])])].sort();
    const slugs = arg("--services")?.split(",").map((s) => s.trim()).filter(Boolean) ?? defaults;
    const complete = slugs.filter((s) => pauseCategory(s) === null);
    if (complete.length) die(`${complete.join(", ")} carr${complete.length === 1 ? "ies" : "y"} complete approved content — this tool pauses only services without method facts`);

    console.log(`\n[pause-unsupported] ${APPLY ? "APPLY" : "REPORT"} on "${db}" · reason "${PAUSE_REASON}"\n${"=".repeat(78)}`);
    const { catalogService } = APPLY ? await import("../src/services/catalog.service") : { catalogService: null };
    const { AuditLogService } = APPLY ? await import("../src/services/audit-log.service") : { AuditLogService: null };
    let failed = 0;
    for (const slug of slugs) {
      const category = pauseCategory(slug)!;
      const mapped = map.get(slug);
      const s = await prisma.service.findFirst({ where: mapped ? { id: mapped } : { slug, dataOrigin: null }, select: { id: true, lifecycleStatus: true, isActive: true, operationsNotes: true } });
      if (!s) { console.log(`${slug}: NOT_FOUND`); continue; }
      const open = await prisma.booking.count({ where: { serviceId: s.id, status: { notIn: OPEN as never } } });
      const upcoming = await prisma.booking.count({ where: { serviceId: s.id, status: { notIn: OPEN as never }, scheduledDate: { gt: new Date() } } });
      const questions = DRAFT[slug]?.openQuestions.length ?? 0;
      const facts = `${category}${questions ? ` · ${questions} open owner question(s)` : ""} · lifecycle ${s.lifecycleStatus} · open bookings ${open} (upcoming ${upcoming}, not touched)`;
      const noted = (s.operationsNotes ?? "").includes(PAUSE_REASON);
      if (s.lifecycleStatus === "PAUSED" && noted) { console.log(`${slug}: SKIP_ALREADY_PAUSED · ${facts}`); continue; }
      if (!APPLY) { console.log(`${slug}: WOULD_PAUSE · ${facts}`); continue; }
      if (s.lifecycleStatus !== "PAUSED") {
        const t = await catalogService!.transition(s.id, "PAUSED", actorId);
        if ("error" in t && t.error) { failed++; console.log(`${slug}: ERROR ${t.error}`); continue; }
      }
      if (!noted) {
        const stamp = new Date().toISOString().slice(0, 10);
        const notes = `[${stamp}] ${PAUSE_REASON} (${category})${s.operationsNotes ? `\n${s.operationsNotes}` : ""}`.slice(0, 2000);
        const u = await catalogService!.update(s.id, { operationsNotes: notes } as never, actorId!);
        if ("error" in u && u.error) { failed++; console.log(`${slug}: PAUSED but the reason was not recorded (${u.error})`); continue; }
      }
      await AuditLogService!.record("ADMIN_ACTION", "success", {
        userId: actorId,
        reason: PAUSE_REASON,
        details: { action: PAUSE_AUDIT_ACTION, serviceId: s.id, slug, category, reason: PAUSE_REASON, openOwnerQuestions: questions, openBookings: open, upcomingBookings: upcoming },
      });
      console.log(`${slug}: PAUSED · ${facts}`);
    }
    console.log(`${"=".repeat(78)}\n[pause-unsupported] ${APPLY ? "done" : "report only"}${failed ? ` · ${failed} FAILED` : ""}`);
    if (failed) process.exitCode = 1;
    if (AuditLogService) {
      const left = await AuditLogService.drain();
      if (left) { console.error(`WARNING: ${left} audit write(s) still pending at exit`); process.exitCode = 1; }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });

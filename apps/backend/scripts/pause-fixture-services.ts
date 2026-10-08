/**
 * Take the ACTIVE services that are labelled as test fixtures (`data_origin = INFERRED_FIXTURE`)
 * out of the catalogue, so customers and partners see only real services. Owner decision,
 * 2026-10-08: "remove them completely".
 *
 * Nothing else can be touched by this tool: a service with any other `data_origin` (including
 * none) is never a candidate, whatever is passed on the command line.
 *
 * Two modes, both through the canonical admin lifecycle write (`catalogService.transition`, which
 * audits SERVICE_LIFECYCLE_CHANGED):
 *   --pause     ACTIVE → PAUSED. Not visible, not bookable; reversible from the admin console.
 *   --archive   ACTIVE → PAUSED → DEPRECATED → ARCHIVED, the catalogue's terminal state: gone from
 *               every customer- and partner-facing list for good. The row, its slug, versions and
 *               every booking are KEPT — deleting a service's rows would also delete bookings with
 *               payment and earning history, which the financial-history guard refuses, and would
 *               erase audit. "Removed" here means removed from the catalogue, not from the ledger.
 * Existing bookings are not touched. The reason goes into the admin-only `operationsNotes` and
 * into an explicit audit row.
 *
 *   bun run scripts/pause-fixture-services.ts --url "$DB_URL" [--archive]                              # report
 *   bun run scripts/pause-fixture-services.ts --url "$DB_URL" --archive --apply --actor-id <SUPER_ADMIN> [--allow-live]
 *   [--actor-email <email>]   resolve the SUPER_ADMIN by email instead of id
 *   [--services a,b]          only these slugs (still must be ACTIVE fixtures)
 */
import { PrismaClient } from "@prisma/client";

export const PAUSE_REASON = "Paused: test fixture, not a real service.";
export const ARCHIVE_REASON = "Removed from the catalogue: test fixture, not a real service.";
export const PAUSE_AUDIT_ACTION = "SERVICE_PAUSED_FIXTURE";
export const ARCHIVE_AUDIT_ACTION = "SERVICE_ARCHIVED_FIXTURE";
/** The catalogue's own path from ACTIVE to its terminal state (lib/service-domain LIFECYCLE_TRANSITIONS). */
export const ARCHIVE_CHAIN = ["PAUSED", "DEPRECATED", "ARCHIVED"] as const;
const CLOSED = ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "EXPIRED", "REJECTED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"];

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m: string): never => { console.error(`[fixture-services] refusing: ${m}`); process.exit(2); };

async function main() {
  const url = arg("--url");
  const APPLY = argv.includes("--apply");
  const ARCHIVE = argv.includes("--archive");
  if (!url) die("--url <postgres url> is required");
  if (APPLY && !arg("--actor-id") && !arg("--actor-email")) die("--apply needs --actor-id <SUPER_ADMIN user id> or --actor-email <email>");
  process.env.DATABASE_URL = url!;
  const prisma = new PrismaClient({ datasources: { db: { url: url! } } });
  try {
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    const isTest = /test/i.test(db);
    if (APPLY && !isTest && !argv.includes("--allow-live")) die(`"${db}" is live; --apply needs --allow-live`);
    if (isTest) process.env.NODE_ENV = "test";

    let actorId = arg("--actor-id");
    if (APPLY) {
      if (!actorId) {
        const { userPiiService } = await import("../src/services/user-pii.service");
        const u = await userPiiService.findByEmail(arg("--actor-email")!.toLowerCase().trim());
        if (!u) die("--actor-email matches no user on this database");
        actorId = u!.id;
      }
      const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
      if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") die("the actor is not an active SUPER_ADMIN on this database");
    }

    const only = arg("--services")?.split(",").map((s) => s.trim()).filter(Boolean);
    const candidates = await prisma.service.findMany({
      where: { lifecycleStatus: "ACTIVE", dataOrigin: "INFERRED_FIXTURE", ...(only ? { slug: { in: only } } : {}) },
      select: { id: true, slug: true, name: true, lifecycleStatus: true, operationsNotes: true },
      orderBy: { slug: "asc" },
    });
    if (only) {
      const missing = only.filter((s) => !candidates.some((c) => c.slug === s));
      if (missing.length) die(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not an ACTIVE fixture-labelled service on "${db}"`);
    }

    const reason = ARCHIVE ? ARCHIVE_REASON : PAUSE_REASON;
    const verb = ARCHIVE ? "ARCHIVE" : "PAUSE";
    console.log(`\n[fixture-services] ${APPLY ? "APPLY" : "REPORT"} ${verb} on "${db}" · ${candidates.length} ACTIVE fixture service(s) · reason "${reason}"\n${"=".repeat(78)}`);
    const { catalogService } = APPLY ? await import("../src/services/catalog.service") : { catalogService: null };
    const { AuditLogService } = APPLY ? await import("../src/services/audit-log.service") : { AuditLogService: null };
    let failed = 0;
    let done = 0;
    for (const s of candidates) {
      const open = await prisma.booking.count({ where: { serviceId: s.id, status: { notIn: CLOSED as never } } });
      const facts = `open bookings ${open} (not touched)`;
      if (!APPLY) { console.log(`${s.slug}: WOULD_${verb} · ${facts}`); continue; }
      let stuck: string | null = null;
      for (const target of ARCHIVE ? ARCHIVE_CHAIN : (["PAUSED"] as const)) {
        const t = await catalogService!.transition(s.id, target, actorId);
        if ("error" in t && t.error) { stuck = `${target}: ${t.error}`; break; }
      }
      if (stuck) { failed++; console.log(`${s.slug}: ERROR at ${stuck}`); continue; }
      const stamp = new Date().toISOString().slice(0, 10);
      const notes = `[${stamp}] ${reason}${s.operationsNotes ? `\n${s.operationsNotes}` : ""}`.slice(0, 2000);
      const u = await catalogService!.update(s.id, { operationsNotes: notes } as never, actorId!);
      if ("error" in u && u.error) { failed++; console.log(`${s.slug}: ${verb}D but the reason was not recorded (${u.error})`); continue; }
      await AuditLogService!.record("ADMIN_ACTION", "success", {
        userId: actorId,
        reason,
        details: { action: ARCHIVE ? ARCHIVE_AUDIT_ACTION : PAUSE_AUDIT_ACTION, serviceId: s.id, slug: s.slug, reason, openBookings: open },
      });
      done++;
      console.log(`${s.slug}: ${verb}D · ${facts}`);
    }
    console.log(`${"=".repeat(78)}\n[fixture-services] ${APPLY ? `done · ${done} ${verb.toLowerCase()}d` : "report only"}${failed ? ` · ${failed} FAILED` : ""}`);
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

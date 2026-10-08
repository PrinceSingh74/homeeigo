/**
 * Pause the ACTIVE services that are labelled as test fixtures (`data_origin = INFERRED_FIXTURE`),
 * so the public catalogue shows only real services. Owner decision, 2026-10-08.
 *
 * Nothing else can be paused by this tool: a service with any other `data_origin` (including none)
 * is never a candidate, whatever is passed on the command line.
 *
 * The pause is the canonical admin lifecycle write (`catalogService.transition(id, "PAUSED")`: not
 * visible, not bookable, audited SERVICE_LIFECYCLE_CHANGED). The slug, configuration, versions and
 * every booking are kept; existing bookings are not touched. The reason goes into the admin-only
 * `operationsNotes` and into an explicit SERVICE_PAUSED_FIXTURE audit row. To undo one, transition it
 * back to ACTIVE from the admin console.
 *
 *   bun run scripts/pause-fixture-services.ts --url "$DB_URL"                                   # report
 *   bun run scripts/pause-fixture-services.ts --url "$DB_URL" --apply --actor-id <SUPER_ADMIN> [--allow-live]
 *   [--services a,b]   only these slugs (still must be ACTIVE fixtures)
 */
import { PrismaClient } from "@prisma/client";

export const PAUSE_REASON = "Paused: test fixture, not a real service.";
export const PAUSE_AUDIT_ACTION = "SERVICE_PAUSED_FIXTURE";
const CLOSED = ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "EXPIRED", "REJECTED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"];

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m: string): never => { console.error(`[pause-fixtures] refusing: ${m}`); process.exit(2); };

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
    if (APPLY) {
      const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
      if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") die("--actor-id is not an active SUPER_ADMIN on this database");
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

    console.log(`\n[pause-fixtures] ${APPLY ? "APPLY" : "REPORT"} on "${db}" · ${candidates.length} ACTIVE fixture service(s) · reason "${PAUSE_REASON}"\n${"=".repeat(78)}`);
    const { catalogService } = APPLY ? await import("../src/services/catalog.service") : { catalogService: null };
    const { AuditLogService } = APPLY ? await import("../src/services/audit-log.service") : { AuditLogService: null };
    let failed = 0;
    let paused = 0;
    for (const s of candidates) {
      const open = await prisma.booking.count({ where: { serviceId: s.id, status: { notIn: CLOSED as never } } });
      const facts = `open bookings ${open} (not touched)`;
      if (!APPLY) { console.log(`${s.slug}: WOULD_PAUSE · ${facts}`); continue; }
      const t = await catalogService!.transition(s.id, "PAUSED", actorId);
      if ("error" in t && t.error) { failed++; console.log(`${s.slug}: ERROR ${t.error}`); continue; }
      const stamp = new Date().toISOString().slice(0, 10);
      const notes = `[${stamp}] ${PAUSE_REASON}${s.operationsNotes ? `\n${s.operationsNotes}` : ""}`.slice(0, 2000);
      const u = await catalogService!.update(s.id, { operationsNotes: notes } as never, actorId!);
      if ("error" in u && u.error) { failed++; console.log(`${s.slug}: PAUSED but the reason was not recorded (${u.error})`); continue; }
      await AuditLogService!.record("ADMIN_ACTION", "success", {
        userId: actorId,
        reason: PAUSE_REASON,
        details: { action: PAUSE_AUDIT_ACTION, serviceId: s.id, slug: s.slug, reason: PAUSE_REASON, openBookings: open },
      });
      paused++;
      console.log(`${s.slug}: PAUSED · ${facts}`);
    }
    console.log(`${"=".repeat(78)}\n[pause-fixtures] ${APPLY ? `done · ${paused} paused` : "report only"}${failed ? ` · ${failed} FAILED` : ""}`);
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

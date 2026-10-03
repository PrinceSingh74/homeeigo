/**
 * Phase 11 — capability backfill: migrate the EXISTING legacy authority (providers.service_categories
 * String[]) into typed provider_service_capabilities rows, so strict mode reproduces today's pool
 * deterministically. This never grants a capability the legacy rule does not already grant — it is a
 * representation change, not a qualification claim (rows are source LEGACY; skills/certs/equipment/
 * insurance/languages are NOT touched: unknown facts stay unknown).
 *
 *   bun run scripts/phase11-capability-backfill.ts --url "<url>"                    # report + parity
 *   bun run scripts/phase11-capability-backfill.ts --url "<url>" --apply --actor-id <SUPER_ADMIN> [--allow-live]
 *
 * Parity gate: for every ACTIVE business-visible service it compares the LEGACY-eligible provider set
 * with the TYPED-eligible set (existing rows + what this run would insert). --apply refuses unless
 * post-apply parity is exact, so flipping matching.strict_service_capability cannot shrink the pool.
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const urlIdx = process.argv.indexOf("--url");
const url = urlIdx >= 0 ? process.argv[urlIdx + 1] : undefined;
const actorIdx = process.argv.indexOf("--actor-id");
const actorId = actorIdx >= 0 ? process.argv[actorIdx + 1] : undefined;
if (!url) { console.error("REFUSING: --url required"); process.exit(2); }
if (APPLY && !actorId) { console.error("REFUSING: --apply needs --actor-id <SUPER_ADMIN>"); process.exit(2); }
process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  if (APPLY && !/test/i.test(db) && !process.argv.includes("--allow-live")) {
    console.error(`REFUSING: "${db}" is live; --apply needs --allow-live`);
    process.exit(2);
  }
  const [t] = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('provider_service_capabilities') IS NOT NULL AS present`;
  if (!t?.present) { console.error("REFUSING: capability tables not deployed on this database"); process.exit(2); }
  console.log(`\n[capability-backfill] ${APPLY ? "APPLY" : "REPORT"} on "${db}"\n${"=".repeat(78)}`);

  if (APPLY) {
    const admin = await prisma.adminUser.findUnique({ where: { userId: actorId! }, select: { isActive: true } });
    if (!admin?.isActive) { console.error(`REFUSING: --actor-id ${actorId} is not an active admin on "${db}"`); process.exit(2); }
  }

  const { PARTNER_OPERATIONAL_WHERE } = await import("../src/lib/service-domain");
  const { resolveServiceMatchTokens } = await import("../src/lib/service-match");
  const { providerOffersService } = await import("../src/lib/service-match");
  const { DISPATCHABLE_PROVIDER_WHERE } = await import("../src/lib/partner-four-axis");

  const services = await prisma.service.findMany({ where: PARTNER_OPERATIONAL_WHERE, select: { id: true, slug: true, name: true } });
  const providers = await prisma.provider.findMany({
    where: { ...DISPATCHABLE_PROVIDER_WHERE },
    select: { id: true, serviceCategories: true, user: { select: { dataOrigin: true } } },
  });
  const { isBusinessRow } = await import("../src/lib/analytics-scope");
  const { computeParity, comparePools, effectivePools, strictPools } = await import("./lib/capability-parity");
  const isBusiness = (o: string | null) => isBusinessRow(o as never);

  type TypedRow = { provider_id: string; service_id: string; status: string; data_origin: string | null };
  const readTyped = (db: { $queryRaw: typeof prisma.$queryRaw }) => db.$queryRaw<TypedRow[]>`
    SELECT provider_id, service_id, status, data_origin::text AS data_origin FROM provider_service_capabilities`;
  const typed = await readTyped(prisma);
  const dispatchable = new Set(providers.map((p) => p.id));
  const parityProviders = (rows: TypedRow[]) => {
    const byProvider = new Map<string, Array<{ serviceId: string; status: string; origin: string | null }>>();
    for (const r of rows) {
      const list = byProvider.get(r.provider_id) ?? [];
      list.push({ serviceId: r.service_id, status: r.status, origin: r.data_origin });
      byProvider.set(r.provider_id, list);
    }
    return providers.map((p) => ({ id: p.id, serviceCategories: p.serviceCategories ?? [], origin: p.user?.dataOrigin ?? null, rows: byProvider.get(p.id) ?? [] }));
  };

  const parityServices: Array<{ id: string; slug: string; offers: (c: string[]) => boolean }> = [];
  for (const s of services) {
    const tokens = await resolveServiceMatchTokens(s.id);
    parityServices.push({ id: s.id, slug: s.slug, offers: tokens ? (c) => providerOffersService(c, tokens) : () => false });
  }

  // The pool to preserve is today's EFFECTIVE pool (LEGACY_FALLBACK semantics), both directions.
  const baseline = effectivePools(parityProviders(typed), parityServices, isBusiness);
  const plan = computeParity(parityProviders(typed), parityServices, isBusiness);
  const toInsert = plan.toInsert;
  const withProviders = plan.perService.filter((p) => p.before.length > 0);

  console.log(`services (partner-operational): ${services.length} · dispatchable providers: ${providers.length}`);
  console.log(`existing typed rows: ${typed.length} (ACTIVE ${typed.filter((r) => r.status === "ACTIVE").length}; on non-dispatchable providers ${typed.filter((r) => !dispatchable.has(r.provider_id)).length}) · rows to insert: ${toInsert.length}`);
  console.log(`providers already governed by typed rows (never widened from the legacy string): ${providers.filter((p) => typed.some((r) => r.provider_id === p.id)).length} · legacy pairs NOT granted for them: ${plan.legacyNotGranted.length}`);
  if (plan.invisibleRows.length) console.log(`typed rows in another population than their provider (invisible to the gate): ${plan.invisibleRows.length}`);
  console.log(`parity (today's effective pool vs strict after insert): ${withProviders.length} services have a pool · shrink ${plan.shrink.length} · growth ${plan.growth.length} → ${plan.exact ? "EXACT" : "NOT EXACT"}`);
  for (const p of withProviders.slice(0, 12)) console.log(`  ${p.slug}: today=${p.before.length} strictAfter=${p.after.length}${p.shrink.length || p.growth.length ? `  ← shrink ${p.shrink.length} growth ${p.growth.length}` : ""}`);
  if (!plan.exact) { console.error(`\nREFUSING${APPLY ? "" : " (report)"}: the strict pool would differ from today's pool (shrink ${plan.shrink.length}, growth ${plan.growth.length}).`); if (APPLY) process.exit(3); }

  const baselineIdx = process.argv.indexOf("--write-baseline");
  if (baselineIdx >= 0) {
    const { writeFileSync } = await import("node:fs");
    const file = process.argv[baselineIdx + 1]!;
    writeFileSync(file, JSON.stringify({ kind: "capability-pool-baseline", database: db, recordedAt: new Date().toISOString(), services: services.length, providers: providers.length, existingRows: typed.length, plannedInserts: toInsert.length, pools: baseline }, null, 2));
    console.log(`baseline written: ${file} (${Object.keys(baseline).length} services)`);
  }

  if (!APPLY) { console.log(`\n[capability-backfill] REPORT ONLY — nothing written.`); return; }

  const { setBookingAuditContext } = await import("../src/lib/booking-audit-context");
  // One set-based INSERT: a per-row loop inside one interactive transaction blew Prisma's tx
  // window on the test database (P2028) — 688 audit-triggered inserts are fine as ONE statement.
  let inserted = 0;
  {
    const pids = toInsert.map((r) => r.providerId);
    const sids = toInsert.map((r) => r.serviceId);
    const origins = toInsert.map((r) => r.origin);
    inserted = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "admin", actorId: actorId!, reason: "Phase 11 capability backfill: legacy String[] → typed rows (source LEGACY; parity-gated)" });
      const res = await tx.$executeRaw`
        INSERT INTO provider_service_capabilities (provider_id, service_id, status, source, verified_by, verified_at, data_origin)
        SELECT p, s, 'ACTIVE', 'LEGACY', ${actorId}, now(), o::"DataOrigin"
        FROM unnest(${pids}::text[], ${sids}::text[], ${origins}::text[]) AS t(p, s, o)
        ON CONFLICT (provider_id, service_id) DO NOTHING`;
      // Parity is re-read from the database INSIDE the transaction: a pool that differs from the
      // baseline in either direction throws, so the insert never commits.
      const cmp = comparePools(baseline, strictPools(parityProviders(await readTyped(tx as never)), parityServices, isBusiness));
      if (Number(res) !== toInsert.length || !cmp.exact) {
        throw new Error(`PARITY_NOT_EXACT: inserted ${Number(res)} of ${toInsert.length} planned; shrink ${cmp.shrink.length}, growth ${cmp.growth.length} — rolled back, nothing written`);
      }
      return Number(res);
    }, { timeout: 120_000 });
  }
  console.log(`\n[capability-backfill] APPLIED — ${inserted} row(s) inserted (source LEGACY, verifier ${actorId}).`);
  console.log(`post-apply parity: EXACT — the strict pool equals today's effective pool for all ${Object.keys(baseline).length} services (shrink 0, growth 0)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

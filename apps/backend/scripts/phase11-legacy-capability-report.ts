/**
 * Phase 11 — legacy capability report. READ ONLY.
 *
 * For every dispatchable provider, prints the legacy free-text capability the partner wrote at
 * onboarding (`serviceCategories`, `primarySkill`, `secondarySkills`, `certifications`) and which
 * catalogue services each `serviceCategories` token resolves to under the legacy matching rule
 * (`src/lib/service-match.ts`), plus whether the provider already has typed Phase 11 rows.
 *
 * It exists so the owner can decide the backfill. It NEVER writes: backfilling would promote
 * self-declared strings into verified capability, which is an owner decision, not a script's.
 *
 *   bun run scripts/phase11-legacy-capability-report.ts --url "<postgres url>" [--json]
 *
 * `--url` is mandatory: a script that inherits DATABASE_URL eventually reports on the wrong database.
 */
import { PrismaClient } from "@prisma/client";
import { PARTNER_OPERATIONAL_WHERE, isPartnerOperationalService } from "../src/lib/service-domain";
import { PARTNER_SLUG_TO_CATEGORIES } from "../src/lib/service-match";

const i = process.argv.indexOf("--url");
const url = i >= 0 ? process.argv[i + 1] : undefined;
if (!url) {
  console.error("REFUSING: --url is required. This script never reads DATABASE_URL from the environment.");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

// Read-only by construction: only findMany / $queryRaw SELECTs below. No $executeRaw, no writes.
const prisma = new PrismaClient({ datasources: { db: { url } } });

type Svc = { id: string; slug: string; name: string; category: string; isActive: boolean; isBookable: boolean; lifecycleStatus: string; configStatus: string; dataOrigin: string | null };

/** The inverse of service-match's resolution: which operational services does ONE legacy token reach? */
function resolveToken(token: string, services: Svc[]): { via: string; services: Svc[] } {
  const byId = services.filter((s) => s.id === token);
  if (byId.length) return { via: "service id", services: byId };
  const bySlug = services.filter((s) => s.slug === token);
  if (bySlug.length) return { via: "service slug", services: bySlug };
  const byCategory = services.filter((s) => s.category === token);
  if (byCategory.length) return { via: "category word", services: byCategory };
  const cats = PARTNER_SLUG_TO_CATEGORIES[token];
  if (cats) {
    const viaSlug = services.filter((s) => cats.includes(s.category));
    return { via: `partner registration slug → categories ${cats.join("|")}`, services: viaSlug };
  }
  return { via: "UNRESOLVED", services: [] };
}

async function main() {
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>("SELECT current_database()");
  const [{ present }] = await prisma.$queryRawUnsafe<{ present: boolean }[]>("SELECT to_regclass('provider_service_capabilities') IS NOT NULL AS present");
  console.error(`[phase11-legacy-report] target database: ${db}; phase 11 tables ${present ? "PRESENT" : "ABSENT"}; mode: report only (no writes)`);

  const services = (await prisma.service.findMany({
    where: PARTNER_OPERATIONAL_WHERE,
    select: { id: true, slug: true, name: true, category: true, isActive: true, isBookable: true, lifecycleStatus: true, configStatus: true, dataOrigin: true },
  })).filter((s) => isPartnerOperationalService(s)) as Svc[];

  const providers = await prisma.provider.findMany({
    where: { isActive: true, isApproved: true },
    select: {
      id: true, lifecycleState: true, isVerified: true, isOnline: true,
      serviceCategories: true, primarySkill: true, secondarySkills: true, certifications: true,
      user: { select: { dataOrigin: true, role: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const typed = new Map<string, { services: number; skills: number; certs: number }>();
  if (present) {
    const rows = await prisma.$queryRawUnsafe<{ provider_id: string; services: number; skills: number; certs: number }[]>(`
      SELECT p.id AS provider_id,
        (SELECT count(*)::int FROM provider_service_capabilities c WHERE c.provider_id = p.id) AS services,
        (SELECT count(*)::int FROM provider_skills c WHERE c.provider_id = p.id) AS skills,
        (SELECT count(*)::int FROM provider_certifications c WHERE c.provider_id = p.id) AS certs
      FROM providers p`);
    for (const r of rows) typed.set(r.provider_id, { services: r.services, skills: r.skills, certs: r.certs });
  }

  const report = providers.map((p) => ({
    providerId: p.id,
    dataOrigin: p.user?.dataOrigin ?? null,
    lifecycleState: p.lifecycleState,
    isVerified: p.isVerified,
    legacy: {
      serviceCategories: p.serviceCategories,
      primarySkill: p.primarySkill,
      secondarySkills: p.secondarySkills,
      certifications: p.certifications,
    },
    resolution: p.serviceCategories.map((token) => {
      const r = resolveToken(token, services);
      return { token, via: r.via, services: r.services.map((s) => ({ id: s.id, slug: s.slug, category: s.category })) };
    }),
    typedRows: typed.get(p.id) ?? null,
  }));

  if (asJson) {
    console.log(JSON.stringify({ database: db, phase11TablesPresent: present, operationalServices: services.length, providers: report }, null, 2));
    return;
  }

  console.log(`\nOperational services: ${services.length}. Dispatchable providers (active+approved): ${report.length}.\n`);
  let unresolvedTokens = 0;
  for (const p of report) {
    console.log(`Provider ${p.providerId}  origin=${p.dataOrigin ?? "UNKNOWN"}  lifecycle=${p.lifecycleState}  verified=${p.isVerified}`);
    console.log(`  primarySkill=${p.legacy.primarySkill ?? "-"}  secondarySkills=[${p.legacy.secondarySkills.join(", ")}]  certifications=[${p.legacy.certifications.join(", ")}]`);
    if (p.resolution.length === 0) console.log("  serviceCategories: (none) → matches NO service under the legacy rule");
    for (const r of p.resolution) {
      if (r.via === "UNRESOLVED") unresolvedTokens++;
      const list = r.services.length ? r.services.map((s) => s.slug).join(", ") : "(nothing)";
      console.log(`  "${r.token}" via ${r.via} → ${r.services.length} service(s): ${list}`);
    }
    console.log(`  typed phase-11 rows: ${p.typedRows ? `services=${p.typedRows.services} skills=${p.typedRows.skills} certifications=${p.typedRows.certs}` : "n/a (tables absent)"}`);
  }
  console.log(`\nUnresolved legacy tokens: ${unresolvedTokens}. Nothing was written. Backfill is OWNER_APPROVAL_REQUIRED.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

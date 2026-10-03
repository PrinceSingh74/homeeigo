/**
 * Requirements readiness report (Phase 06) — READ-ONLY. For every service: which materials, equipment
 * and customer preconditions are configured, whether that configuration passes the publish gate, and
 * which business inputs the owner still has to supply.
 *
 *   bun --env-file=.env run scripts/requirements-readiness-report.ts            # markdown
 *   bun --env-file=.env run scripts/requirements-readiness-report.ts --json     # machine-readable
 *   ... --fail-on-invalid   # exit 1 if any service carries requirement configuration the gate refuses (CI gate)
 *
 * Never writes. Never infers a value: an empty kind is OWNER_INPUT_REQUIRED unless the final content artifact
 * explicitly declares it NO_SPECIAL_REQUIREMENTS — "this service needs nothing" is a business statement,
 * never an inference. A missing requirement is not a booking blocker.
 */
import prisma from "../src/lib/prisma";
import { loadHydratedCatalog } from "../src/lib/service-catalog-store";
import { isCommercialOrigin, isServiceCustomerVisible } from "../src/lib/service-domain";
import { REQUIREMENT_KINDS, blockingRequirementCodes, resolveServiceRequirements, validateServiceRequirements, type RequirementKind } from "../src/lib/service-requirements";
import { CONTENT as FINAL_CONTENT } from "./data/phase-06-requirement-content-final";

/**
 * NOT_CONFIGURED (OWNER_INPUT_REQUIRED) ≠ NO_SPECIAL_REQUIREMENTS: the second is an explicit business
 * declaration ("nothing beyond the ordinary service environment"), recorded per kind in the final
 * content artifact (scripts/data/phase-06-requirement-content-final.ts → noSpecial). Rows alone cannot
 * tell the two apart, so the report reads the declaration.
 */
type KindState = "CONFIGURED" | "INVALID" | "NO_SPECIAL_REQUIREMENTS" | "SAFETY_HOLD" | "OWNER_INPUT_REQUIRED";
type Row = {
  serviceCode: string;
  name: string;
  category: string | null;
  scope: "FIXTURE" | "UNAVAILABLE" | "LIVE";
  version: number;
  materials: KindState;
  equipment: KindState;
  customerPreconditions: KindState;
  assignments: number;
  activeAssignments: number;
  blockingBeforeBooking: string[];
  /** Legacy free-text policy fields (pre-Phase 06). Shown so the owner can migrate them — never auto-converted. */
  legacy: { materialPolicy: string | null; equipmentPolicy: string | null; preparationLines: number };
  issues: string[];
};

const json = process.argv.includes("--json");
const failOnInvalid = process.argv.includes("--fail-on-invalid");
const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "?";

const tables = await prisma.$queryRawUnsafe<{ n: number }[]>(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('service_requirement_items','service_requirements')`,
);
const tablesPresent = tables[0]?.n === 2;
const catalogueItems = tablesPresent
  ? await prisma.$queryRawUnsafe<{ kind: string; active: boolean; n: number }[]>(
      `SELECT kind, is_active AS active, count(*)::int AS n FROM service_requirement_items GROUP BY kind, is_active ORDER BY kind`,
    )
  : [];

const services = await prisma.service.findMany({
  orderBy: [{ category: "asc" }, { slug: "asc" }],
  include: { taxonomyCategory: { select: { slug: true } } },
});

const rows: Row[] = [];
for (const s of services) {
  const cfg = await loadHydratedCatalog(s);
  const reqs = cfg?.requirements ?? [];
  const active = reqs.filter((r) => r.active);
  const issues = validateServiceRequirements(cfg);
  const kindOf = (code: string): RequirementKind | null => cfg?.requirementItems?.[code]?.kind ?? null;
  const state = (k: RequirementKind): KindState => {
    const mine = active.filter((r) => kindOf(r.itemCode) === k);
    if (!mine.length) return FINAL_CONTENT[s.slug]?.noSpecial?.[k] ? "NO_SPECIAL_REQUIREMENTS" : FINAL_CONTENT[s.slug]?.unconfigured?.[k] ? "SAFETY_HOLD" : "OWNER_INPUT_REQUIRED";
    return issues.some((i) => i.requirement && mine.some((r) => r.id === i.requirement)) ? "INVALID" : "CONFIGURED";
  };
  // Blocking prerequisites of the unconditional selection (no variant/add-on) — what every booking must confirm.
  const base = issues.length ? null : resolveServiceRequirements(cfg, { variantId: null, addonIds: [], quantity: 1 });
  const visible = isServiceCustomerVisible(s, cfg);
  rows.push({
    serviceCode: s.serviceCode,
    name: s.displayName ?? s.name,
    category: s.taxonomyCategory?.slug ?? null,
    scope: !isCommercialOrigin(s.dataOrigin) ? "FIXTURE" : !visible || cfg?.comingSoon ? "UNAVAILABLE" : "LIVE",
    version: s.version,
    materials: state("MATERIAL"),
    equipment: state("EQUIPMENT"),
    customerPreconditions: state("CUSTOMER_PRECONDITION"),
    assignments: reqs.length,
    activeAssignments: active.length,
    blockingBeforeBooking: base?.ok ? blockingRequirementCodes(base.items) : [],
    legacy: {
      materialPolicy: cfg?.materialPolicy ?? null,
      equipmentPolicy: cfg?.equipmentPolicy ?? null,
      preparationLines: (cfg?.preparation ?? []).filter((p) => p.trim()).length,
    },
    issues: issues.map((i) => i.code),
  });
}
await prisma.$disconnect();

const live = rows.filter((r) => r.scope !== "FIXTURE");
const invalid = rows.filter((r) => r.issues.length > 0);
const count = (k: keyof Pick<Row, "materials" | "equipment" | "customerPreconditions">) =>
  live.reduce<Record<string, number>>((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
const summary = {
  database: db,
  generatedAt: new Date().toISOString(),
  requirementTablesPresent: tablesPresent,
  catalogueItems: Object.fromEntries(REQUIREMENT_KINDS.map((k) => [k, catalogueItems.filter((c) => c.kind === k).reduce((a, c) => a + (c.active ? c.n : 0), 0)])),
  services: rows.length,
  nonFixtureServices: live.length,
  materials: count("materials"),
  equipment: count("equipment"),
  customerPreconditions: count("customerPreconditions"),
  servicesWithInvalidRequirementConfig: invalid.length,
};

if (json) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log(`# Requirements readiness — ${summary.database} — ${summary.generatedAt}\n`);
  console.log(`Tables present: **${tablesPresent ? "yes" : "NO (migration 20260922100000_service_requirements not applied)"}** · catalogue items (active): ${JSON.stringify(summary.catalogueItems)}`);
  console.log(`Materials: ${JSON.stringify(summary.materials)} · Equipment: ${JSON.stringify(summary.equipment)} · Preconditions: ${JSON.stringify(summary.customerPreconditions)} · invalid: **${invalid.length}**\n`);
  console.log("| code | name | scope | v | materials | equipment | preconditions | blocking | legacy material/equipment | issues |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of live) {
    console.log(
      `| ${r.serviceCode} | ${r.name} | ${r.scope} | ${r.version} | ${r.materials} | ${r.equipment} | ${r.customerPreconditions} | ${r.blockingBeforeBooking.join(", ") || "-"} | ${r.legacy.materialPolicy ?? "-"} / ${r.legacy.equipmentPolicy ?? "-"} | ${r.issues.join("; ") || "-"} |`,
    );
  }
  console.log(`\nFixture/test rows (never customer-facing): ${rows.length - live.length}`);
}
if (failOnInvalid && invalid.length > 0) {
  console.error(`FAIL: ${invalid.length} service(s) carry requirement configuration the publish gate refuses: ${invalid.map((r) => r.serviceCode).join(", ")}`);
  process.exit(1);
}

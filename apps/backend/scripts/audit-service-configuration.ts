/**
 * Read-only service configuration audit. Prints markdown to stdout.
 * Does not mutate production data. Uses whatever DATABASE_URL is loaded.
 *
 *   bun --env-file=.env.test run scripts/audit-service-configuration.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import { parseCatalogConfig, catalogConfigGaps } from "../src/lib/service-catalog-config";
import { deriveConfigStatus, inferCapabilityProfile } from "../src/lib/service-domain";

function yn(v: boolean) {
  return v ? "yes" : "no";
}

async function main() {
  const rows = await prisma.service.findMany({ orderBy: [{ category: "asc" }, { slug: "asc" }] });
  const lines = [
    "# Service configuration audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Rows: ${rows.length}`,
    "",
    "Statuses are derived. Blank policy/content cells mean **not specified** — not invented.",
    "",
    "| service | category | status | pricing | duration | quantity | variants | addons | materials | equipment | provider req | coverage | availability | booking rules | safety | quality | payment | media | SEO | config status |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of rows) {
    const cfg = parseCatalogConfig(s.catalogConfig);
    const gaps = catalogConfigGaps(s, cfg);
    const configStatus = deriveConfigStatus(
      { ...s, capabilityProfile: s.capabilityProfile ?? inferCapabilityProfile(s.category) },
      cfg,
    );
    lines.push(
      `| ${s.slug} | ${s.category} | ${s.lifecycleStatus} | ${s.pricingModel}/${s.basePrice} | ${s.estimatedDuration}m | ${cfg?.quantity?.type ?? "—"} | ${cfg?.variants?.length ?? 0} | ${cfg?.addons?.length ?? "shared"} | ${cfg?.materialPolicy ?? "NOT_SPECIFIED"} | ${cfg?.equipmentPolicy ?? "NOT_SPECIFIED"} | ${cfg?.providerRequirements?.requiredSkills?.join(",") || "—"} | ${(s.availableCities ?? []).length} cities | ${cfg?.availability ? "configured" : "runtime"} | ${cfg?.bookingRules ? "configured" : "—"} | ${(cfg?.safetyNotes?.length ?? 0) > 0 || cfg?.safety ? "yes" : "—"} | ${cfg?.quality?.notApplicable ? "N/A" : cfg?.quality ? "configured" : "—"} | ${cfg?.payment ? "policy" : "engine"} | ${yn(Boolean(s.thumbnail || s.images?.length))} | ${yn(Boolean(s.seoTitle))} | ${gaps.length ? "CONFIGURATION_REQUIRED" : configStatus} |`,
    );
  }
  const md = lines.join("\n") + "\n";
  const out = join(import.meta.dir, "../../docs/service-configuration-audit.md");
  writeFileSync(out, md);
  process.stdout.write(md);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
